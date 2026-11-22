// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({ athletes: [] as any[] }))
vi.mock('@/lib/devy/ncaabRosterPool', () => ({ currentNcaabRosterEvidence: async () => ({ athletes: fake.athletes, ambiguous: [] }) }))
vi.mock('@/lib/sports-data/riScheduleCache', async load => ({ ...(await load<typeof import('@/lib/sports-data/riScheduleCache')>()), readRiScheduleWindow: async () => [{ gameId: 'synthetic', day: '2026-11-01', startTime: '2026-11-01T18:00:00Z', status: 'final', homeTeamId: '1', awayTeamId: '2' }] }))

import { prisma } from '@/lib/prisma'
import { seedNbaCampusCarryover } from '@/lib/c2c/seedNbaCampusCarryover'
import { nbaCampusWeekCacheKey } from '@/lib/c2c/storeNbaCampusWeekSnapshot'

const pilot = process.env.NBA_CAMPUS_POSTGRES_PILOT === '1' ? describe : describe.skip
pilot('NBA campus carryover on isolated Postgres', () => {
  it('recovers a missed lineup only from pre-week roster evidence', async () => {
    const target = new URL(process.env.DATABASE_URL!)
    expect(target.hostname).toBe('ep-billowing-shadow-ado0fgzv-pooler.c-2.us-east-1.aws.neon.tech')
    expect(target.pathname).toBe('/neondb')
    const id = `campus-carryover-${randomUUID()}`, owner = `${id}-owner`, rr = `${id}-redraft`, roster = `${id}-roster`
    const player = `espn:ncaab:${String(BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`))}`
    const now = new Date('2026-11-02T12:00:00Z'), beforeWeek = new Date('2026-10-26T00:00:00Z')
    const key = nbaCampusWeekCacheKey(id, roster, 2026, 2)
    fake.athletes = [{ id: player, espnId: player.split(':').at(-1), teamId: '10', name: 'Synthetic Player', school: 'School', position: 'G', jersey: null, observedAt: beforeWeek }]
    try {
      await prisma.appUser.create({ data: { id: owner, email: `${id}@example.invalid`, username: id } })
      await prisma.league.create({ data: { id, userId: owner, platform: 'manual', platformLeagueId: id, leagueType: 'dynasty', leagueVariant: 'c2c', sport: 'NBA', isDynasty: true, settings: {} } })
      const season = await prisma.redraftSeason.create({ data: { leagueId: id, sport: 'NBA', season: 2026, status: 'active', currentWeek: 2, totalWeeks: 18, playoffStartWeek: 19 } })
      await prisma.redraftRoster.create({ data: { id: rr, leagueId: id, seasonId: season.id, ownerId: owner, ownerName: 'Home' } })
      await prisma.roster.create({ data: { id: roster, leagueId: id, platformUserId: owner, redraftRosterId: rr, updatedAt: beforeWeek, playerData: { lineup_sections: { devy: [player], campus: [player] } } } })
      const db = {
        redraftSeason: { findMany: (args: any) => prisma.redraftSeason.findMany({ ...args, where: { ...args.where, leagueId: id } }) },
        roster: prisma.roster,
        sportsDataCache: { findUnique: (args: any) => args.where.cacheKey === 'NCAAB:rischedule:2026:meta' ? Promise.resolve({ data: { firstDay: '2026-11-01', lastDay: '2027-03-07', syncedAt: '2026-11-02T11:00:00Z' }, expiresAt: new Date('2028-01-01') }) : prisma.sportsDataCache.findUnique(args) },
        $transaction: prisma.$transaction.bind(prisma),
      }
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(now)
      expect(await seedNbaCampusCarryover(db as never, { now, deadlineAt: Date.now() + 30000, maxRosters: 5 })).toMatchObject({ considered: 1, seeded: 1, held: 0 })
      expect(await prisma.afRosterLineupAssignment.findMany({ where: { leagueId: id, rosterId: roster, season: 2026, week: 2 } })).toMatchObject([{ section: 'campus', playerId: player }])
      const saved = await prisma.sportsDataCache.findUniqueOrThrow({ where: { cacheKey: key } })
      expect(saved.data).toMatchObject({ season: 2026, week: 2, players: [{ id: player, selectedAt: '2026-10-27T00:00:00.000Z' }] })
      expect(await seedNbaCampusCarryover(db as never, { now, deadlineAt: Date.now() + 30000, maxRosters: 5 })).toMatchObject({ seeded: 0 })
      await prisma.afRosterLineupAssignment.deleteMany({ where: { leagueId: id, rosterId: roster, season: 2026, week: 2 } })
      await prisma.sportsDataCache.delete({ where: { cacheKey: key } })
      await prisma.roster.update({ where: { id: roster }, data: { updatedAt: new Date('2026-10-28T00:00:00Z') } })
      expect(await seedNbaCampusCarryover(db as never, { now, deadlineAt: Date.now() + 30000, maxRosters: 5 })).toMatchObject({ considered: 1, seeded: 0, held: 1 })
      expect(await prisma.sportsDataCache.findUnique({ where: { cacheKey: key } })).toBeNull()
      expect(await prisma.afRosterLineupAssignment.count({ where: { leagueId: id, rosterId: roster, season: 2026, week: 2 } })).toBe(0)
    } finally {
      vi.useRealTimers()
      fake.athletes = []
      await prisma.sportsDataCache.deleteMany({ where: { cacheKey: key } })
      await prisma.league.deleteMany({ where: { id } })
      await prisma.appUser.deleteMany({ where: { id: owner } })
    }
  }, 90000)
})
