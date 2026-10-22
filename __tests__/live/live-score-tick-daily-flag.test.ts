/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The wiring of the NBA/NHL/MLB tick into `live-score-tick`: NBA on by default; an enabled sport can
 * never take NFL scoring down with it.
 */

const h = vi.hoisted(() => ({ daily: vi.fn(), runner: vi.fn(), meta: null as Record<string, unknown> | null }))

vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (_m: unknown, fn: () => Promise<unknown>, map: (r: unknown) => { metadata: Record<string, unknown> }) => {
    const r = await fn()
    h.meta = map(r).metadata
    return r
  },
}))
vi.mock('@/server/services/liveScoring/liveScoreRunner', () => ({
  runLiveScoringForActiveSeasons: (...a: unknown[]) => h.runner(...a),
}))
vi.mock('@/lib/live/rollingInsightsLiveProvider', () => ({ RollingInsightsLiveProvider: class {} }))
vi.mock('@/lib/live/gamedayPoller', () => ({
  runPollLoop: async () => ({ ticks: 1, stoppedBecause: 'no-active-games', elapsedMs: 0 }),
  createCadenceGate: () => () => true,
  LIVE_POLL_INTERVAL_MS: 10_000,
  PBP_POLL_INTERVAL_MS: 35_000,
  POLL_BUDGET_MS: 105_000,
}))
vi.mock('@/lib/live/playByPlayFeed', () => ({ refreshPlayByPlayFeed: async () => null }))
vi.mock('@/lib/live/liveSleeperPointsSync', () => ({ refreshLiveSleeperPoints: async () => null, LIVE_POINTS_INTERVAL_MS: 120_000 }))
vi.mock('@/lib/live/grokTdClipPilot', () => ({ runGrokTdClipPilot: async () => null }))
vi.mock('@/lib/live/dailySportLiveTick', async (orig) => {
  const actual = await orig<typeof import('@/lib/live/dailySportLiveTick')>()
  return { ...actual, runDailySportLiveTick: (...a: unknown[]) => h.daily(...a) }
})

import { GET } from '@/app/api/cron/live-score-tick/route'

const req = () => new Request('https://example.test/api/cron/live-score-tick') as never

beforeEach(() => {
  vi.clearAllMocks()
  h.meta = null
  delete process.env.DAILY_SPORT_LIVE_SCORING
  h.runner.mockResolvedValue({ ticked: 1, polled: 1, summaries: [] })
  h.daily.mockResolvedValue({ enabled: ['NBA'], sports: { NBA: { status: 'written', dates: ['2026-10-20'], linesWritten: 9 } }, seasonsRescored: 1, matchupsRecalculated: 3, rescoreErrors: 0 })
})
afterEach(() => {
  delete process.env.DAILY_SPORT_LIVE_SCORING
})

describe('live-score-tick — daily-sport flag', () => {
  it('explicit off: the daily tick is never called, and telemetry says it is off', async () => {
    process.env.DAILY_SPORT_LIVE_SCORING = 'off'
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(h.daily).not.toHaveBeenCalled()
    expect(h.meta?.dailyLiveEnabled).toEqual([])
    expect(h.meta?.dailyLive).toBeNull()
  })

  it('NBA is enabled when no flag is configured', async () => {
    await GET(req())
    expect(h.daily.mock.calls[0][0].sports).toEqual(['NBA'])
    expect(h.meta?.dailyLiveEnabled).toEqual(['NBA'])
  })

  it('flag on: runs for the enabled sports, with a budget stop, and reports the outcome', async () => {
    process.env.DAILY_SPORT_LIVE_SCORING = 'NBA,NHL'
    await GET(req())
    expect(h.daily).toHaveBeenCalledTimes(1)
    const arg = h.daily.mock.calls[0]![0] as { sports: string[]; shouldStop: () => boolean }
    expect(arg.sports).toEqual(['NBA', 'NHL'])
    expect(arg.shouldStop()).toBe(false)
    expect((h.meta?.dailyLive as { matchupsRecalculated: number }).matchupsRecalculated).toBe(3)
  })

  it('a throwing daily tick does not fail NFL scoring', async () => {
    process.env.DAILY_SPORT_LIVE_SCORING = '1'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.daily.mockRejectedValue(new Error('boom'))
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(h.runner).toHaveBeenCalled()
  })
})
