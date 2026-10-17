// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { prisma } from '@/lib/prisma'
import { closeExpiredExileRosters, finalizeExileRosterResults, getExileWaivers, mutateExileRoster } from '@/lib/survivor/exileRosterService'
import { scoreExileWeek } from '@/lib/survivor/exileEngine'
import { readExileRoster } from '@/lib/survivor/exileRosterRules'

const RUN = process.env.RUN_SURVIVOR_EXILE_DB_IT === '1'
const prefix = `exile-it-${randomUUID().slice(0, 8)}`
const leagues: string[] = []
const players: string[] = []
const games: string[] = []
const userId = `${prefix}-owner`
let safeTarget = false
const require = createRequire(import.meta.url)

describe.runIf(RUN)('Exile persisted roster isolation and weekly release', () => {
  beforeAll(async () => {
    expect(require('../scripts/db-target-identity.cjs').identifyTarget(process.env.DATABASE_URL).kind).toBe('safe')
    safeTarget = true
    await prisma.appUser.create({ data: { id: userId, email: `${prefix}@example.invalid`, username: prefix, displayName: 'Exile integration' } })
  })
  afterAll(async () => {
    if (!safeTarget) return
    for (const leagueId of leagues) {
      await prisma.exileWeeklyEntry.deleteMany({ where: { leagueId } })
      await prisma.exileIsland.deleteMany({ where: { leagueId } })
      await prisma.survivorAuditEntry.deleteMany({ where: { leagueId } })
      await prisma.survivorPlayer.deleteMany({ where: { leagueId } })
      await prisma.survivorGameState.deleteMany({ where: { leagueId } })
      await prisma.league.delete({ where: { id: leagueId } })
    }
    await prisma.playerWeeklyScore.deleteMany({ where: { playerId: { in: players } } })
    await prisma.player.deleteMany({ where: { id: { in: players } } })
    await prisma.gameSchedule.deleteMany({ where: { id: { in: games } } })
    await prisma.appUser.deleteMany({ where: { id: userId } })
    await prisma.$disconnect()
  })

  for (const [sport, anchor, teammate, start] of [
    ['NBA', 'PG', 'SG', '2026-10-20'], ['NHL', 'G', 'C', '2026-09-29'], ['NFL', 'QB', 'WR', '2026-10-20'],
  ] as const) {
    it(`${sport}: serializes anchor claims, blocks cross-team additions, and freezes a score snapshot at reset`, async () => {
      const leagueId = `${prefix}-${sport}`
      const team = `T${sport}`
      const now = new Date(`${start}T16:00:00Z`)
      const kickoff = new Date(`${start}T23:00:00Z`)
      const week = sport === 'NFL' ? 7 : 1
      await prisma.league.create({ data: { id: leagueId, userId, platform: 'allfantasy', platformLeagueId: leagueId, name: 'Exile fixture', sport, season: 2026, leagueSize: 16, survivorMode: true, leagueVariant: 'survivor', settings: { starter_slots: { [anchor]: 1, [teammate]: 1, BN: 1 } } } })
      leagues.push(leagueId)
      await prisma.survivorGameState.create({ data: { leagueId, phase: 'pre_merge', currentWeek: week } })
      await prisma.exileIsland.create({ data: { leagueId, isActive: true, currentWeek: week } })
      await prisma.survivorPlayer.createMany({ data: ['a', 'b', 'main'].map(suffix => ({ leagueId, userId: `${prefix}-${sport}-${suffix}`, displayName: suffix, playerState: suffix === 'main' ? 'active' : 'exile' })) })
      const ids = ['anchor', 'mate', 'other', 'foreign'].map(suffix => `${leagueId}-${suffix}`)
      await prisma.player.createMany({ data: ids.map((id, i) => ({ id, name: id, sport: i === 3 ? 'MLB' : sport, league: sport, position: i === 0 ? anchor : teammate, team: i === 2 ? 'OTHER' : team })) })
      players.push(...ids)
      const gameId = `${leagueId}-game`
      await prisma.gameSchedule.create({ data: { id: gameId, season: 2026, weekOrRound: week, externalId: gameId, sportType: sport, homeTeam: team, awayTeam: 'OTHER', startTime: kickoff, status: 'scheduled' } })
      games.push(gameId)
      const attempts = await Promise.allSettled(['a', 'b'].map(suffix => mutateExileRoster({ leagueId, userId: `${prefix}-${sport}-${suffix}`, week, playerId: ids[0], action: 'claim' }, now)))
      expect(attempts.filter(a => a.status === 'fulfilled')).toHaveLength(1)
      expect(attempts.filter(a => a.status === 'rejected')).toHaveLength(1)
      const winner = `${prefix}-${sport}-${attempts[0].status === 'fulfilled' ? 'a' : 'b'}`
      expect((await getExileWaivers(leagueId, winner, '', now)).roster.players).toHaveLength(1)
      await expect(mutateExileRoster({ leagueId, userId: winner, week, playerId: ids[2], action: 'claim' }, now)).rejects.toThrow('different team')
      await expect(mutateExileRoster({ leagueId, userId: winner, week, playerId: ids[3], action: 'claim' }, now)).rejects.toThrow('active player')
      await expect(mutateExileRoster({ leagueId, userId: `${prefix}-${sport}-main`, week, playerId: ids[0], action: 'claim' }, now)).rejects.toThrow('exiled')
      await mutateExileRoster({ leagueId, userId: winner, week, playerId: ids[1], action: 'claim' }, now)
      await expect(mutateExileRoster({ leagueId, userId: winner, week, playerId: ids[0], action: 'drop' }, new Date(kickoff.getTime() + 1))).rejects.toThrow('locked')
      const after = new Date(now.getTime() + 7 * 86400000)
      expect(await closeExpiredExileRosters(leagueId, after)).toBe(1)
      expect(await closeExpiredExileRosters(leagueId, after)).toBe(0)
      const entry = await prisma.exileWeeklyEntry.findFirstOrThrow({ where: { leagueId, userId: winner, week } })
      expect(readExileRoster(entry.submittedLineup)?.players.map(p => p.id)).toEqual(ids.slice(0, 2))
      expect(readExileRoster(entry.submittedLineup)?.closedAt).toBeTruthy()
      expect(await finalizeExileRosterResults(leagueId, week)).toBe(false)
      expect(await prisma.survivorAuditEntry.count({ where: { leagueId, week, action: 'exile_results_finalized' } })).toBe(0)
      await prisma.playerWeeklyScore.createMany({ data: ids.slice(0, 2).map(playerId => ({ playerId, sport, season: 2026, week, stats: sport === 'NFL' ? { pass_yd: 0 } : sport === 'NBA' ? { pts: 0 } : { goals: 0 }, fantasyPts: 0, isFinalized: true })) })
      expect(await finalizeExileRosterResults(leagueId, week)).toBe(true)
      expect(await finalizeExileRosterResults(leagueId, week)).toBe(true)
      expect(await prisma.survivorAuditEntry.count({ where: { leagueId, week, action: 'exile_results_finalized' } })).toBe(1)
      expect(await scoreExileWeek(leagueId, week)).toBe(true)
      expect(await scoreExileWeek(leagueId, week)).toBe(true)
      expect((await prisma.survivorPlayer.findUniqueOrThrow({ where: { leagueId_userId: { leagueId, userId: winner } } })).tokenBalance).toBe(1)
    }, 60000)
  }
})
