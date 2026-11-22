import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  devy: vi.fn(async () => false),
  c2c: vi.fn(async () => false),
  prisma: {
    redraftSeason: { findUnique: vi.fn() },
    redraftMatchup: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    redraftRosterPlayer: { findMany: vi.fn() },
    roster: { findMany: vi.fn(async () => []) },
    afRosterLineupAssignment: { findMany: vi.fn(async () => []) },
    playerWeeklyScore: { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    sportsDataCache: { findUnique: vi.fn(), upsert: vi.fn() },
    leagueAuditLog: { create: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({ leagueUsesDevyEngine: m.devy, calculateOfficialTeamScore: vi.fn() }))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: m.c2c, updateC2CMatchupScores: vi.fn() }))

import { checkStatCorrectionsForSeason } from '@/lib/stat-corrections/statCorrectionDetector'

/**
 * Extended scoring corrections in the detector: AF Commissioner leagues that switched it on re-check
 * two finished weeks for 14 days and apply what they find; everyone else is unchanged.
 */
const NOW = Date.parse('2026-10-23T12:00:00Z')
const SEALED = NOW - 2 * 24 * 60 * 60 * 1000
const snapshot = { redraftScoring: { scoredAt: new Date(SEALED).toISOString() } }

// Rushing yards only, on the default NFL scoring: 100 yards is 10 points plus the 3-point 100-yard
// bonus; the corrected 85 is 8.5 and loses the bonus. The real league scorer runs, not a stand-in.
const RB_STORED = { rush_yds: 100 }
const RB_FRESH = { rush_yds: 85 }

function seed(over: { platform?: string; sport?: string; settings?: Record<string, unknown>; bestBallMode?: boolean } = {}) {
  m.prisma.redraftSeason.findUnique.mockResolvedValue({
    id: 'S',
    leagueId: 'L',
    season: 2026,
    sport: over.sport ?? 'NFL',
    league: { platform: over.platform ?? 'allfantasy', sport: over.sport ?? 'NFL', settings: over.settings ?? {}, bestBallMode: over.bestBallMode ?? false, leagueVariant: null, leagueType: null },
  })
  m.prisma.redraftMatchup.findFirst.mockResolvedValue({ week: 7 })
  m.prisma.redraftMatchup.findMany.mockResolvedValue([
    { id: 'm1', status: 'final', homeRosterId: 'A', awayRosterId: 'B', homeScore: 100, awayScore: 99, lineupSnapshots: snapshot },
  ])
  m.prisma.redraftRosterPlayer.findMany.mockResolvedValue([
    { rosterId: 'A', playerId: 'rb1', playerName: 'Run Back', position: 'RB', slotType: 'RB', sport: 'NFL' },
    { rosterId: 'A', playerId: 'bench1', playerName: 'Bench Guy', position: 'WR', slotType: 'BN', sport: 'NFL' },
    { rosterId: 'B', playerId: 'nfl:def:KC', playerName: 'Chiefs', position: 'DEF', slotType: 'DEF', sport: 'NFL' },
  ])
  m.prisma.playerWeeklyScore.findMany.mockResolvedValue([{ playerId: 'rb1', stats: RB_STORED }])
  m.prisma.sportsDataCache.findUnique.mockResolvedValue(null)
}

const fetchStats = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  m.devy.mockResolvedValue(false)
  m.c2c.mockResolvedValue(false)
  fetchStats.mockResolvedValue(new Map([['rb1', RB_FRESH]]))
  seed()
})


const DAY = 24 * 60 * 60 * 1000
const extendedSettings = { stat_corrections_extended: true }
const applyCorrections = vi.fn(async () => ({ applied: 1 }))

function seedExtended(sealedDaysAgo = 2) {
  seed({ settings: extendedSettings })
  const snap = { redraftScoring: { scoredAt: new Date(NOW - sealedDaysAgo * DAY).toISOString() } }
  m.prisma.redraftMatchup.findMany.mockImplementation(async (args: { distinct?: unknown }) =>
    args?.distinct
      ? [{ week: 7 }, { week: 6 }]
      : [{ id: 'm1', status: 'final', homeRosterId: 'A', awayRosterId: 'B', homeScore: 100, awayScore: 99, lineupSnapshots: snap }],
  )
}
const runExt = (hasPlan: boolean, now = NOW) =>
  checkStatCorrectionsForSeason('S', { now, fetchStats, ownerHasPlan: async () => hasPlan, applyCorrections: applyCorrections as never })

describe('extended scoring corrections', () => {
  it('switched on with AF Commissioner: re-checks the last two finished weeks and applies the correction', async () => {
    seedExtended()
    expect(await runExt(true)).toBe('changes_logged')
    expect(fetchStats.mock.calls.map((c) => c[0].week)).toEqual([7, 6])
    expect(applyCorrections).toHaveBeenCalledTimes(2)
    expect(applyCorrections.mock.calls[0]![0]).toMatchObject({ leagueId: 'L', week: 7 })
    expect(applyCorrections.mock.calls[0]![0].review.matchups[0]).toMatchObject({ matchupId: 'm1' })
  })

  it('reaches 14 days after the seal, where a free league stops at six', async () => {
    seedExtended(10)
    expect(await runExt(true)).toBe('changes_logged')
    seedExtended(10)
    expect(await runExt(false)).toBe('outside_window')
  })

  it('switched on without the plan, or switched off: detection only, latest week only, nothing applied', async () => {
    seedExtended()
    await runExt(false)
    seed()
    await checkStatCorrectionsForSeason('S', { now: NOW, fetchStats, ownerHasPlan: async () => true, applyCorrections: applyCorrections as never })
    expect(applyCorrections).not.toHaveBeenCalled()
    expect(fetchStats.mock.calls.every((c) => c[0].week === 7)).toBe(true)
  })
})
