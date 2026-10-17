import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 THE SCHEDULED SCORE-SYNC SKIPPED A NOT-READY ZOMBIE WEEK WITH A BARE `return`.
 *
 * A zombie week resolves only when every matchup is final, and NBA's week finalizer has never sealed a
 * real slate. If it refuses, the league's week never becomes ready — and the sync said nothing about it,
 * every five minutes, while reporting `success`. Separately, a league activated with `totalWeeks` reached
 * the first playoff week (no matchups) and waited there forever, never `complete`.
 *
 * One real tick through the real route: each not-ready league is now reported with its reason, and a
 * league past its last scheduled week is closed.
 */

const m = vi.hoisted(() => ({
  zombieLeagues: vi.fn(),
  zombieUpdateMany: vi.fn(),
  readiness: vi.fn(),
  resolve: vi.fn(),
}))

vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))
vi.mock('@/lib/adminAuth', () => ({ requireAdminOrBearer: vi.fn() }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (_meta: unknown, fn: () => Promise<unknown>, summarize: (r: unknown) => unknown) => {
    const r = await fn()
    return { result: r, summary: summarize(r) }
  },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: vi.fn(async () => []) },
    zombieLeague: { findMany: m.zombieLeagues, updateMany: m.zombieUpdateMany },
    c2CLeague: { findMany: vi.fn(async () => []) },
    redraftSeason: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    redraftMatchup: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/c2c/scoringEngine', () => ({ updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/survivor/gameStateMachine', () => ({ syncWeeklyScores: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorSitOutEngine', () => ({
  runNbaTribeSitOutDeadlineBatch: vi.fn(async () => ({ considered: 0, failed: 0, outcomes: {} })),
}))
vi.mock('@/lib/zombie/matchupCompletion', () => ({ getZombieWeekReadiness: m.readiness }))
vi.mock('@/lib/zombie/weeklyResolutionEngine', () => ({ runWeeklyResolution: m.resolve }))
vi.mock('@/lib/zombie/ZombieLeagueConfig', () => ({ getZombieLeagueConfig: vi.fn(async () => null) }))
vi.mock('@/lib/zombie/zombieAutomation', () => ({
  runZombieHousekeeping: vi.fn(async () => ({ leaguesChecked: 0, announcementsPosted: 0, errors: [] })),
}))
vi.mock('@/lib/redraft/playerWeeklyScoreService', () => ({ syncPlayerWeeklyScoresForRedraftSeason: vi.fn() }))
vi.mock('@/lib/redraft/scoringEngine', () => ({ recalculateMatchupsForSeasonWeek: vi.fn() }))
vi.mock('@/lib/redraft/standingsEngine', () => ({ updateStandings: vi.fn() }))
vi.mock('@/lib/season-week', () => ({ resolveSeasonWeekForRedraftSeason: vi.fn() }))
vi.mock('@/lib/redraft/weekFinalizer', () => ({
  finalizeCompletedWeeksForSeason: vi.fn(async () => ({ results: [], finalized: 0, refusals: {} })),
}))
vi.mock('@/lib/redraft/scoreSyncBatch', () => ({ rotatingBatch: <T,>(xs: T[]) => xs, SCORE_SYNC_BATCH: 50 }))
vi.mock('@/lib/bestball/nativeTournament', () => ({ runNativeTournamentWeek: vi.fn() }))
vi.mock('@/lib/guillotine/nativeGuillotineWeek', () => ({ runNativeGuillotineWeek: vi.fn() }))
vi.mock('@/lib/playoff-runtime/playoffRoundScoring', () => ({ scoreActivePlayoffRound: vi.fn() }))

import { GET } from '@/app/api/redraft/score-sync/route'

type Body = {
  result: { zombieWeeksWaiting: unknown[]; zombieSeasonsClosed: number }
  summary: { status: string; metadata: Record<string, unknown> }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.zombieLeagues.mockResolvedValue([
    { id: 'z-ready', leagueId: 'L-ready', currentWeek: 3, season: 2026 },
    { id: 'z-midweek', leagueId: 'L-midweek', currentWeek: 3, season: 2026 },
    { id: 'z-past-end', leagueId: 'L-past-end', currentWeek: 20, season: 2026 },
    { id: 'z-unscheduled', leagueId: 'L-unscheduled', currentWeek: 1, season: 2026 },
  ])
  m.readiness.mockImplementation(async (leagueId: string) => {
    if (leagueId === 'L-ready') return { ready: true }
    if (leagueId === 'L-midweek') return { ready: false, reason: 'MATCHUPS_NOT_FINAL', pending: 4 }
    if (leagueId === 'L-past-end') return { ready: false, reason: 'NO_SCHEDULED_MATCHUPS', lastScheduledWeek: 19 }
    return { ready: false, reason: 'NO_SCHEDULED_MATCHUPS', lastScheduledWeek: null }
  })
  m.zombieUpdateMany.mockResolvedValue({ count: 1 })
  m.resolve.mockResolvedValue({ resolution: null })
})

describe('score-sync — zombie weeks that do not resolve', () => {
  it('resolves only the ready league', async () => {
    await GET(new Request('http://localhost/api/redraft/score-sync'))
    expect(m.resolve.mock.calls.map((c) => [c[0], c[1]])).toEqual([['z-ready', 3]])
  })

  it('reports every waiting league with its reason instead of skipping it silently', async () => {
    const body = (await (await GET(new Request('http://localhost/api/redraft/score-sync'))).json()) as Body

    expect(body.result.zombieWeeksWaiting).toEqual([
      { leagueId: 'L-midweek', week: 3, ready: false, reason: 'MATCHUPS_NOT_FINAL', pending: 4 },
      { leagueId: 'L-unscheduled', week: 1, ready: false, reason: 'NO_SCHEDULED_MATCHUPS', lastScheduledWeek: null },
    ])
    expect(body.summary.metadata.zombieWeeksWaiting).toBe(2)
    expect(body.summary.metadata.zombieWeeksWaitingSample).toHaveLength(2)
    // Waiting is normal while games are in progress; it is reported, not escalated.
    expect(body.summary.status).toBe('success')
  })

  it('closes a league that is past its last scheduled week (the NBA week-20 stall)', async () => {
    const body = (await (await GET(new Request('http://localhost/api/redraft/score-sync'))).json()) as Body

    expect(m.zombieUpdateMany).toHaveBeenCalledTimes(1)
    expect(m.zombieUpdateMany).toHaveBeenCalledWith({
      where: { id: 'z-past-end', status: 'active' },
      data: { status: 'complete', currentWeek: 19, totalWeeks: 19 },
    })
    expect(body.result.zombieSeasonsClosed).toBe(1)
    expect(body.summary.metadata.zombieSeasonsClosed).toBe(1)
  })

  it('[control] never closes a league that has simply not been scheduled yet', async () => {
    await GET(new Request('http://localhost/api/redraft/score-sync'))
    const closedIds = m.zombieUpdateMany.mock.calls.map((c) => (c[0] as { where: { id: string } }).where.id)
    expect(closedIds).not.toContain('z-unscheduled')
    expect(closedIds).not.toContain('z-midweek')
  })
})
