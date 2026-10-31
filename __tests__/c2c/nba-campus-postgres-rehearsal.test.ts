// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

const game = { gameId: 'ri-pilot', day: '2026-11-01', startTime: '2026-11-01T18:00:00Z', status: 'completed', seasonType: 'regular', eventName: null, replacedBy: null, homeTeamId: '1', awayTeamId: '2' }
vi.mock('@/lib/sports-data/riScheduleCache', async (load) => ({ ...(await load<typeof import('@/lib/sports-data/riScheduleCache')>()), readRiScheduleWindow: async () => [game] }))
vi.mock('@/lib/redraft/ncaabCampusTeamBridge', () => ({ bridgeNcaabCampusTeams: async () => ({ resolved: new Map([['10', '1']]), unresolved: [] }) }))

import { prisma } from '@/lib/prisma'
import { buildNbaCampusWeekSnapshot } from '@/lib/c2c/nbaCampusWeekSnapshot'
import { nbaCampusWeekCacheKey, persistNbaCampusWeekSnapshot } from '@/lib/c2c/storeNbaCampusWeekSnapshot'
import { nbaCampusGameMappingKey } from '@/lib/c2c/refreshNbaCampusWeek'
import { nbaCampusPointsForMatchup } from '@/lib/c2c/nbaCampusMatchupScoring'

const pilot = process.env.NBA_CAMPUS_POSTGRES_PILOT === '1' ? describe : describe.skip
pilot('NBA campus snapshot and correction on isolated Postgres', () => {
  it('scores the saved weekly lineup, withholds a missing box, and applies an official correction', async () => {
    const target = new URL(process.env.DATABASE_URL!)
    expect(target.hostname).toBe('ep-billowing-shadow-ado0fgzv-pooler.c-2.us-east-1.aws.neon.tech')
    expect(target.pathname).toBe('/neondb')
    const id = `campus-pilot-${randomUUID()}`
    const ownerId = `${id}-owner`, homeId = `${id}-home`, awayId = `${id}-away`
    const homeRoster = `${id}-home-roster`, awayRoster = `${id}-away-roster`
    const espnId = String(BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`))
    const playerId = `espn:ncaab:${espnId}`, eventId = String(BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`))
    const boxKey = `espn:ncaab:box:${eventId}`, mappingKey = nbaCampusGameMappingKey(2026, 2)
    const savedAt = new Date('2026-10-31T12:00:00Z'), now = new Date('2026-11-05T12:00:00Z')
    const playerData = { lineup_sections: { devy: [playerId], campus: [playerId] } }
    const evidence = [{ id: playerId, espnId, teamId: '10', name: 'Synthetic College Player', school: 'Synthetic School', position: 'G', jersey: null, observedAt: savedAt }]
    const built = buildNbaCampusWeekSnapshot({ playerData, season: 2026, week: 2, now: savedAt, evidence })
    expect(built.snapshot).not.toBeNull()
    // These global cache names are remapped to test-only keys; no copied production cache is modified.
    const localMappingKey = `${id}-mapping`, localBoxKey = `${id}-box`
    const rewrite = (key: string) => key === mappingKey ? localMappingKey : key === boxKey ? localBoxKey : key
    const db = {
      roster: prisma.roster,
      afRosterLineupAssignment: prisma.afRosterLineupAssignment,
      teamProviderIdentity: prisma.teamProviderIdentity,
      sportsDataCache: {
        findMany: async (args: any) => {
          const keys: string[] = args.where.cacheKey.in
          const rows = await prisma.sportsDataCache.findMany({ ...args, where: { ...args.where, cacheKey: { in: keys.map(rewrite) } } })
          const restored = rows.map(row => ({ ...row, cacheKey: row.cacheKey === localMappingKey ? mappingKey : row.cacheKey === localBoxKey ? boxKey : row.cacheKey }))
          return keys.includes('NCAAB:rischedule:2026:meta')
            ? [...restored.filter(row => row.cacheKey !== 'NCAAB:rischedule:2026:meta'), { cacheKey: 'NCAAB:rischedule:2026:meta', data: { firstDay: '2026-11-01', lastDay: '2027-03-07' } }]
            : restored
        },
      },
    }
    const input = { leagueId: id, season: 2026, week: 2, homeRosterId: homeId, awayRosterId: awayId, now, scorer: (s: Record<string, number>) => (s.pts ?? 0) + (s.reb ?? 0) }
    const box = (points: number) => ({ eventId, status: 'final', complete: true, rejected: 0, players: [{ espnId, teamId: '10', didNotPlay: false, stats: { pts: points, reb: 5, ast: 0, to: 0, stl: 0, blk: 0, threes: 0 } }] })
    try {
      await prisma.appUser.create({ data: { id: ownerId, email: `${id}@example.invalid`, username: id } })
      await prisma.league.create({ data: { id, userId: ownerId, platform: 'manual', platformLeagueId: id, leagueType: 'dynasty', leagueVariant: 'c2c', sport: 'NBA', isDynasty: true, settings: {} } })
      const season = await prisma.redraftSeason.create({ data: { leagueId: id, sport: 'NBA', season: 2026, status: 'active', totalWeeks: 18, playoffStartWeek: 19 } })
      await prisma.redraftRoster.createMany({ data: [{ id: homeId, leagueId: id, seasonId: season.id, ownerId: homeId, ownerName: 'Home' }, { id: awayId, leagueId: id, seasonId: season.id, ownerId: awayId, ownerName: 'Away' }] })
      await prisma.roster.createMany({ data: [{ id: homeRoster, leagueId: id, platformUserId: homeId, redraftRosterId: homeId, playerData }, { id: awayRoster, leagueId: id, platformUserId: awayId, redraftRosterId: awayId, playerData: {} }] })
      await prisma.$transaction(async tx => {
        await tx.afRosterLineupAssignment.create({ data: { leagueId: id, rosterId: homeRoster, season: 2026, week: 2, section: 'campus', playerId } })
        await persistNbaCampusWeekSnapshot(tx, { leagueId: id, rosterId: homeRoster, snapshot: built.snapshot!, now: savedAt })
        await persistNbaCampusWeekSnapshot(tx, { leagueId: id, rosterId: awayRoster, snapshot: { season: 2026, week: 2, savedAt: savedAt.toISOString(), players: [] }, now: savedAt })
      })
      await prisma.sportsDataCache.create({ data: { cacheKey: localMappingKey, expiresAt: new Date('2028-01-01'), data: { season: 2026, week: 2, mappings: [{ gameId: game.gameId, eventId, day: game.day, homeTeamId: '1', awayTeamId: '2' }] } } })
      expect((await nbaCampusPointsForMatchup(db as never, input))?.home).toMatchObject({ missingPlayerIds: [playerId], allFinal: false })
      await prisma.sportsDataCache.create({ data: { cacheKey: localBoxKey, expiresAt: new Date('2028-01-01'), data: box(20) } })
      expect((await nbaCampusPointsForMatchup(db as never, input))?.home).toEqual({ points: 25, missingPlayerIds: [], allFinal: true })
      await prisma.sportsDataCache.update({ where: { cacheKey: localBoxKey }, data: { data: box(22) } })
      expect((await nbaCampusPointsForMatchup(db as never, input))?.home).toEqual({ points: 27, missingPlayerIds: [], allFinal: true })
    } finally {
      await prisma.sportsDataCache.deleteMany({ where: { cacheKey: { in: [localMappingKey, localBoxKey, nbaCampusWeekCacheKey(id, homeRoster, 2026, 2), nbaCampusWeekCacheKey(id, awayRoster, 2026, 2)] } } })
      await prisma.league.deleteMany({ where: { id } })
      await prisma.appUser.deleteMany({ where: { id: ownerId } })
    }
  }, 90000)
})
