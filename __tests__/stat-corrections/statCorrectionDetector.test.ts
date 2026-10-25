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

import {
  checkStatCorrectionsForSeason,
  STAT_CORRECTION_ACTION,
  STAT_CORRECTION_RECHECK_MS,
  STAT_CORRECTION_WINDOW_MS,
  statCorrectionCacheKey,
} from '@/lib/stat-corrections/statCorrectionDetector'

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

const run = (now = NOW) => checkStatCorrectionsForSeason('S', { now, fetchStats })

describe('checkStatCorrectionsForSeason', () => {
  it('logs a correction once, stores the review, and never writes a score, matchup or stat row', async () => {
    expect(await run()).toBe('changes_logged')

    expect(fetchStats).toHaveBeenCalledWith({ season: 2026, week: 7, playerIds: ['rb1'] })
    const cached = m.prisma.sportsDataCache.upsert.mock.calls[0][0]
    expect(cached.where).toEqual({ cacheKey: statCorrectionCacheKey('S', 7) })
    const review = cached.create.data.review
    expect(review.changes).toEqual([expect.objectContaining({ playerId: 'rb1', before: 13, after: 8.5, delta: -4.5 })])
    expect(review.matchups[0]).toMatchObject({ home: { before: 100, after: 95.5 }, resultFlipped: true })

    const log = m.prisma.leagueAuditLog.create.mock.calls[0][0].data
    expect(log).toMatchObject({ leagueId: 'L', userId: null, actionType: STAT_CORRECTION_ACTION, metadata: { season: 2026, week: 7, flipped: 1 } })

    expect(m.prisma.playerWeeklyScore.upsert).not.toHaveBeenCalled()
    expect(m.prisma.playerWeeklyScore.update).not.toHaveBeenCalled()
    expect(m.prisma.redraftMatchup.update).not.toHaveBeenCalled()
  })

  it('does not log the same set of corrections twice', async () => {
    await run()
    const stored = m.prisma.sportsDataCache.upsert.mock.calls[0][0].create.data
    m.prisma.sportsDataCache.findUnique.mockResolvedValue({ data: stored })
    vi.clearAllMocks()
    fetchStats.mockResolvedValue(new Map([['rb1', RB_FRESH]]))
    expect(await run(NOW + STAT_CORRECTION_RECHECK_MS + 1)).toBe('changes_seen')
    expect(m.prisma.leagueAuditLog.create).not.toHaveBeenCalled()
    expect(m.prisma.sportsDataCache.upsert).toHaveBeenCalledTimes(1)
  })

  it('measures from the sealed score after an Apply, so a re-check never counts a correction twice', async () => {
    const applied = { id: 'a', matchupId: 'm1', rosterId: 'A', week: 7, points: -4.5, reason: 'Stat correction', byUserId: 'c', at: 'now', source: 'stat_correction' }
    const own = { ...applied, id: 'b', points: -2, source: undefined, reason: 'penalty' }
    seed({ settings: { commissioner_score_adjustments: [applied, own] } })
    // Stored score now carries both: 100 sealed, -4.5 applied correction, -2 commissioner penalty.
    m.prisma.redraftMatchup.findMany.mockResolvedValue([
      { id: 'm1', status: 'final', homeRosterId: 'A', awayRosterId: 'B', homeScore: 93.5, awayScore: 99, lineupSnapshots: snapshot },
    ])
    await run()
    const review = m.prisma.sportsDataCache.upsert.mock.calls[0][0].create.data.review
    // The penalty stays in both sides of the comparison; only the applied correction is taken out.
    expect(review.matchups[0].home).toEqual({ rosterId: 'A', before: 98, after: 93.5 })
  })

  it('asks the provider at most once an hour per week', async () => {
    m.prisma.sportsDataCache.findUnique.mockResolvedValue({
      data: { seasonId: 'S', leagueId: 'L', season: 2026, week: 7, sealedAt: new Date(SEALED).toISOString(), checkedAt: new Date(NOW - 60_000).toISOString(), review: { changes: [], matchups: [], unchecked: 0, fingerprint: '' } },
    })
    expect(await run()).toBe('throttled')
    expect(fetchStats).not.toHaveBeenCalled()
  })

  it('reports no change, and logs nothing, when the fresh stats agree', async () => {
    fetchStats.mockResolvedValue(new Map([['rb1', RB_STORED]]))
    expect(await run()).toBe('no_change')
    expect(m.prisma.leagueAuditLog.create).not.toHaveBeenCalled()
  })

  it('treats an empty pull as an outage and keeps the last review rather than clearing it', async () => {
    fetchStats.mockResolvedValue(new Map())
    expect(await run()).toBe('provider_empty')
    expect(m.prisma.sportsDataCache.upsert).not.toHaveBeenCalled()
    expect(m.prisma.leagueAuditLog.create).not.toHaveBeenCalled()
  })

  it('stops re-checking once the window after the seal has passed', async () => {
    expect(await run(SEALED + STAT_CORRECTION_WINDOW_MS + 1)).toBe('outside_window')
    expect(fetchStats).not.toHaveBeenCalled()
  })

  it('waits for a week to be sealed: one matchup still active means no review', async () => {
    m.prisma.redraftMatchup.findMany.mockResolvedValue([
      { id: 'm1', status: 'final', homeRosterId: 'A', awayRosterId: 'B', homeScore: 1, awayScore: 0, lineupSnapshots: snapshot },
      { id: 'm2', status: 'active', homeRosterId: 'C', awayRosterId: 'D', homeScore: 1, awayScore: 0, lineupSnapshots: snapshot },
    ])
    expect(await run()).toBe('no_sealed_week')
  })

  it.each([
    ['an imported league', { platform: 'sleeper' }],
    ['a non-NFL league', { sport: 'NBA' }],
    ['a best ball league', { bestBallMode: true }],
    ['a category league', { settings: { scoring_mode: 'h2h_category' } }],
  ])('does not cover %s', async (_label, over) => {
    seed(over)
    expect(await run()).toBe('not_supported')
    expect(fetchStats).not.toHaveBeenCalled()
  })

  it('does not cover devy or C2C scoring', async () => {
    m.devy.mockResolvedValueOnce(true)
    expect(await run()).toBe('not_supported')
    m.c2c.mockResolvedValueOnce(true)
    expect(await run()).toBe('not_supported')
    expect(fetchStats).not.toHaveBeenCalled()
  })
})
