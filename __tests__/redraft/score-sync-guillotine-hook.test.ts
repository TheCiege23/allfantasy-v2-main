import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The scheduled score-sync is what chops native guillotine leagues. It must hand each season its
 * calendar week, and one league's failure must not end the sweep or read as a healthy run.
 */

const m = vi.hoisted(() => ({
  guillotine: vi.fn(),
  seasons: vi.fn(),
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
    zombieLeague: { findMany: vi.fn(async () => []) },
    c2CLeague: { findMany: vi.fn(async () => []) },
    redraftSeason: { findMany: m.seasons, findFirst: vi.fn(async () => null) },
    redraftMatchup: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/c2c/scoringEngine', () => ({ updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/survivor/gameStateMachine', () => ({ syncWeeklyScores: vi.fn() }))
vi.mock('@/lib/zombie/matchupCompletion', () => ({ checkAllMatchupsComplete: vi.fn() }))
vi.mock('@/lib/zombie/weeklyResolutionEngine', () => ({ runWeeklyResolution: vi.fn() }))
vi.mock('@/lib/zombie/ZombieLeagueConfig', () => ({ getZombieLeagueConfig: vi.fn() }))
vi.mock('@/lib/redraft/playerWeeklyScoreService', () => ({
  syncPlayerWeeklyScoresForRedraftSeason: vi.fn(async ({ seasonId, week }: { seasonId: string; week: number }) => ({ seasonId, week })),
}))
vi.mock('@/lib/redraft/scoringEngine', () => ({ recalculateMatchupsForSeasonWeek: vi.fn(async () => ({ updated: 0 })) }))
vi.mock('@/lib/redraft/standingsEngine', () => ({ updateStandings: vi.fn() }))
vi.mock('@/lib/season-week', () => ({
  resolveSeasonWeekForRedraftSeason: vi.fn(async () => ({ ok: true, phase: 'regular', fantasyWeek: 4 })),
}))
vi.mock('@/lib/redraft/weekFinalizer', () => ({
  finalizeCompletedWeeksForSeason: vi.fn(async () => ({ results: [], finalized: 0, refusals: {} })),
}))
vi.mock('@/lib/redraft/scoreSyncBatch', () => ({ rotatingBatch: <T,>(xs: T[]) => xs, SCORE_SYNC_BATCH: 50 }))
vi.mock('@/lib/guillotine/nativeGuillotineWeek', () => ({ runNativeGuillotineWeek: m.guillotine }))

import { GET } from '@/app/api/redraft/score-sync/route'

beforeEach(() => {
  vi.clearAllMocks()
  m.seasons.mockResolvedValue([
    { id: 's-broken', leagueId: 'L1', sport: 'NFL' },
    { id: 's-guillotine', leagueId: 'L2', sport: 'NFL' },
    { id: 's-plain', leagueId: 'L3', sport: 'NFL' },
  ])
  m.guillotine.mockImplementation(async ({ seasonId }: { seasonId: string }) => {
    if (seasonId === 's-broken') throw new Error('db blip')
    if (seasonId === 's-guillotine') return { seasonId, outcome: 'chopped', week: 3 }
    return { seasonId, outcome: 'not_guillotine' }
  })
})

describe('score-sync — native guillotine', () => {
  it('runs the chop pass for every season with its calendar week, and survives one failing', async () => {
    const res = await GET(new Request('http://localhost/api/redraft/score-sync'))
    const body = (await res.json()) as { result: { redraft: Record<string, unknown> }; summary: { status: string } }

    expect(m.guillotine.mock.calls.map((c) => c[0])).toEqual([
      { seasonId: 's-broken', currentFantasyWeek: 4 },
      { seasonId: 's-guillotine', currentFantasyWeek: 4 },
      { seasonId: 's-plain', currentFantasyWeek: 4 },
    ])
    expect(body.result.redraft).toMatchObject({
      guillotineChops: 1,
      guillotineFailed: 1,
      guillotineOutcomes: { chopped: 1 },
    })
    // A failed chop pass is a degraded run, never a clean one.
    expect(body.summary.status).toBe('partial')
  })
})
