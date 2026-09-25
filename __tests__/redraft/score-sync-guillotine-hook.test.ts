import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The scheduled score-sync is what chops native guillotine leagues. It must hand each season its
 * calendar week, and one league's failure must not end the sweep or read as a healthy run.
 */

const m = vi.hoisted(() => ({
  guillotine: vi.fn(),
  seasons: vi.fn(),
  housekeeping: vi.fn(),
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
vi.mock('@/lib/zombie/zombieAutomation', () => ({ runZombieHousekeeping: m.housekeeping }))

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
  m.housekeeping.mockResolvedValue({ leaguesChecked: 0, announcementsPosted: 0, errors: [] })
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

describe('score-sync — zombie housekeeping', () => {
  /*
   * Its own route (`/api/zombie/automation`) is on no schedule and the cron list is full, so the
   * five-minute score-sync runs it: bashing-decision expiry, the announcement queue, scheduled weekly
   * updates, animation delivery.
   */
  beforeEach(() => {
    m.seasons.mockResolvedValue([])
  })

  it('runs once on every scheduled tick', async () => {
    const res = await GET(new Request('http://localhost/api/redraft/score-sync'))
    const body = (await res.json()) as { result: Record<string, unknown>; summary: { status: string } }
    expect(m.housekeeping).toHaveBeenCalledTimes(1)
    expect(body.result).toMatchObject({ zombieHousekeepingErrors: [] })
    expect(body.summary.status).toBe('success')
  })

  it('a housekeeping failure makes the run partial, and says what failed', async () => {
    m.housekeeping.mockResolvedValue({ leaguesChecked: 1, announcementsPosted: 0, errors: ['z1 weekly-update: db blip'] })
    const res = await GET(new Request('http://localhost/api/redraft/score-sync'))
    const body = (await res.json()) as { summary: { status: string; metadata: Record<string, unknown> } }
    expect(body.summary.status).toBe('partial')
    expect(body.summary.metadata).toMatchObject({ zombieHousekeepingErrors: ['z1 weekly-update: db blip'] })
  })

  it('a housekeeping crash costs the housekeeping, never the sweep', async () => {
    m.housekeeping.mockRejectedValue(new Error('boom'))
    const res = await GET(new Request('http://localhost/api/redraft/score-sync'))
    const body = (await res.json()) as { summary: { status: string } }
    expect(res.status).toBe(200)
    expect(body.summary.status).toBe('partial')
  })
})
