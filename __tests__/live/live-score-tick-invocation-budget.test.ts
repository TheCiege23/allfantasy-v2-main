/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The poll budget counts from the start of the invocation: the heavy first tick is charged to it,
 * the loop gets what is left, and a heavy pass only starts when its own budget still fits.
 */

const h = vi.hoisted(() => ({
  clock: 0,
  daily: vi.fn(),
  cup: vi.fn(),
  points: vi.fn(),
  loopOpts: null as { budgetMs?: number; isActive?: () => Promise<boolean> } | null,
  /* When set, the loop runs one more tick this many ms into the invocation. */
  loopTickAt: null as number | null,
  meta: null as Record<string, unknown> | null,
}))

vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/playoffs/nbaCupLiveTick', () => ({ refreshNbaCupLive: () => h.cup() }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (_m: unknown, fn: () => Promise<unknown>, map: (r: unknown) => { metadata: Record<string, unknown> }) => {
    const r = await fn()
    h.meta = map(r).metadata
    return r
  },
}))
vi.mock('@/server/services/liveScoring/liveScoreRunner', () => ({
  runLiveScoringForActiveSeasons: async () => ({ ticked: 1, polled: 1, summaries: [] }),
}))
vi.mock('@/lib/live/rollingInsightsLiveProvider', () => ({ RollingInsightsLiveProvider: class {} }))
vi.mock('@/lib/live/gamedayPoller', () => ({
  anyGameInProgress: async () => false,
  runPollLoop: async (_tick: () => Promise<void>, opts: { budgetMs?: number }) => {
    h.loopOpts = opts
    if (h.loopTickAt != null) {
      h.clock = 1_000_000 + h.loopTickAt
      await _tick()
    }
    return { ticks: 0, stoppedBecause: 'budget', elapsedMs: 0 }
  },
  createCadenceGate: () => () => true,
  LIVE_POLL_INTERVAL_MS: 10_000,
  PBP_POLL_INTERVAL_MS: 35_000,
  POLL_BUDGET_MS: 105_000,
}))
vi.mock('@/lib/live/playByPlayFeed', () => ({ refreshPlayByPlayFeed: async () => null }))
vi.mock('@/lib/live/liveSleeperPointsSync', () => ({
  refreshLiveSleeperPoints: (...a: unknown[]) => h.points(...a),
  LIVE_POINTS_INTERVAL_MS: 120_000,
}))
vi.mock('@/lib/live/grokTdClipPilot', () => ({ runGrokTdClipPilot: async () => null }))
vi.mock('@/lib/live/dailySportLiveTick', async (orig) => {
  const actual = await orig<typeof import('@/lib/live/dailySportLiveTick')>()
  return { ...actual, runDailySportLiveTick: (...a: unknown[]) => h.daily(...a) }
})

import { GET } from '@/app/api/cron/live-score-tick/route'

const req = () => new Request('https://example.test/api/cron/live-score-tick') as never

beforeEach(() => {
  vi.clearAllMocks()
  h.clock = 1_000_000
  h.loopOpts = null
  h.loopTickAt = null
  h.meta = null
  delete process.env.DAILY_SPORT_LIVE_SCORING
  vi.spyOn(Date, 'now').mockImplementation(() => h.clock)
  h.points.mockResolvedValue(null)
  h.daily.mockResolvedValue({ enabled: ['NBA'], sports: {}, seasonsRescored: 0, matchupsRecalculated: 0, rescoreErrors: 0 })
  h.cup.mockResolvedValue({ activeGames: 0, providerFailures: 0 })
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('live-score-tick — invocation budget', () => {
  it('keeps polling for a live Cup game independently of the NFL slate', async () => {
    h.cup.mockResolvedValue({ activeGames: 1, providerFailures: 0 })
    await GET(req())
    expect(await h.loopOpts?.isActive?.()).toBe(true)
    expect(h.meta?.nbaCupLive).toMatchObject({ activeGames: 1, providerFailures: 0 })
  })
  it('reports a failed Cup pass without interrupting other live scoring', async () => {
    h.cup.mockRejectedValue(new Error('test provider failure'))
    expect((await GET(req())).status).toBe(200)
    expect(h.meta?.nbaCupLive).toMatchObject({ providerFailures: 1, skipped: 'sync-failed' })
  })
  it('charges the first tick to the budget: the loop gets only what is left', async () => {
    h.points.mockImplementation(async () => {
      h.clock += 25_000
      return null
    })
    h.daily.mockImplementation(async () => {
      h.clock += 20_000
      return { enabled: ['NBA'], sports: {}, seasonsRescored: 0, matchupsRecalculated: 0, rescoreErrors: 0 }
    })
    await GET(req())
    expect(h.points).toHaveBeenCalledTimes(1)
    expect(h.daily).toHaveBeenCalledTimes(1)
    expect(h.loopOpts?.budgetMs).toBe(105_000 - 45_000)
    expect(h.meta?.invocationElapsedMs).toBe(45_000)
  })

  it('skips the daily pass when less than its own budget remains after the points pass', async () => {
    h.points.mockImplementation(async () => {
      h.clock += 80_000
      return null
    })
    await GET(req())
    expect(h.points).toHaveBeenCalledTimes(1)
    expect(h.daily).not.toHaveBeenCalled()
    expect(h.loopOpts?.budgetMs).toBe(25_000)
  })

  it('a late tick starts neither heavy pass once their reserve is gone', async () => {
    h.loopTickAt = 80_000
    await GET(req())
    expect(h.points).toHaveBeenCalledTimes(1)
    expect(h.daily).toHaveBeenCalledTimes(1)
  })

  it('a mid-loop tick still runs the heavy passes while they fit', async () => {
    h.loopTickAt = 40_000
    await GET(req())
    expect(h.points).toHaveBeenCalledTimes(2)
    expect(h.daily).toHaveBeenCalledTimes(2)
  })

  it('never hands the loop a negative budget', async () => {
    h.points.mockImplementation(async () => {
      h.clock += 110_000
      return null
    })
    await GET(req())
    expect(h.loopOpts?.budgetMs).toBe(0)
  })
})
