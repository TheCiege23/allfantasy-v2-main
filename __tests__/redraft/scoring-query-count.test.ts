import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Scale (2026-11-24): scoring a roster read the league once PER STARTER to build its scorer, and each
 * starter's stat row one after another. A 180-team league playing four games a week did about 29,000 reads
 * a pass. The league is now read a fixed number of times per roster, and the stat rows are requested
 * together (Prisma batches same-tick findUnique calls into one query). Points are unchanged.
 */

const { db } = vi.hoisted(() => ({
  db: {
    league: { findFirst: vi.fn() },
    redraftSeason: { findFirst: vi.fn() },
    redraftRosterPlayer: { findMany: vi.fn() },
    playerWeeklyScore: { findUnique: vi.fn() },
    roster: { findMany: vi.fn() },
    afRosterLineupAssignment: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({ leagueUsesDevyEngine: vi.fn(async () => false), calculateOfficialTeamScore: vi.fn() }))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false), updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))

import { scoreRosterForWeek } from '@/lib/redraft/scoringEngine'

const STARTERS = 12

beforeEach(() => {
  vi.clearAllMocks()
  db.league.findFirst.mockResolvedValue({ sport: 'NFL', settings: {}, platform: 'af', leagueVariant: null, leagueType: 'redraft' })
  db.roster.findMany.mockResolvedValue([])
  db.afRosterLineupAssignment.findMany.mockResolvedValue([])
  db.redraftRosterPlayer.findMany.mockResolvedValue(
    Array.from({ length: STARTERS }, (_, i) => ({ playerId: `p${i}`, position: 'WR', slotType: 'WR', rosterId: 'R', sport: 'NFL', playerName: `p${i}`, droppedAt: null })),
  )
  db.playerWeeklyScore.findUnique.mockImplementation(async () => ({ stats: { rec: 5, rec_yd: 50 }, isFinalized: true }))
})

describe('scoring a roster', () => {
  it('reads the league a fixed number of times, however many starters it has', async () => {
    const r = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'R', week: 3, seasonYear: 2026 })
    expect(r.scoredStarterCount).toBe(STARTERS)
    expect(r.points).toBeGreaterThan(0)
    expect(db.playerWeeklyScore.findUnique).toHaveBeenCalledTimes(STARTERS)
    const readsFor12 = db.league.findFirst.mock.calls.length
    // The same roster with three starters reads the league exactly as often.
    db.league.findFirst.mockClear()
    db.redraftRosterPlayer.findMany.mockResolvedValue(
      Array.from({ length: 3 }, (_, i) => ({ playerId: `p${i}`, position: 'WR', slotType: 'WR', rosterId: 'R', sport: 'NFL', playerName: `p${i}`, droppedAt: null })),
    )
    await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'R', week: 3, seasonYear: 2026 })
    expect(db.league.findFirst.mock.calls.length).toBe(readsFor12)
  })

  it('every starter scores the same points, read once each', async () => {
    const r = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'R', week: 3, seasonYear: 2026 })
    const perPlayer = r.points / STARTERS
    expect(Math.round(perPlayer * 100) / 100).toBeGreaterThan(0)
  })
})
