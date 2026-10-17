/**
 * Contract tests for the cross-job sync-run reaper and GET /api/cron/reap-sync-runs.
 *
 * Context: `withSyncJobRun` already reaps abandoned `running` rows, but only for the job that is
 * firing, at the moment it fires. A job that never fires again keeps its `running` row forever —
 * and `computeJobHealth` checks `runningTooLong` BEFORE its freshness branches, so the deadest
 * job on the board reports amber "appears stuck" instead of escalating to red. This sweep is what
 * closes that gap, so the tests below pin the two properties that make it different from its
 * per-job sibling:
 *
 *   1. it does NOT scope by jobName — that omission IS the feature, and scoping it would silently
 *      reduce this back to the per-job reaper while every other assertion still passed;
 *   2. it distinguishes "nothing was stale" from "could not look", because `reaped: 0` reads
 *      identically for both and a blind sweep must not pass for a clean one.
 *
 * NOTE: follows the repo's working route-test pattern (see cron-draft-tick-route.test.ts) —
 * `vi.hoisted` mocks and a plain `Request`. Importing `next/server` at module top level hangs the
 * vitest worker in this repo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  reapAllAbandonedRuns: vi.fn(),
  recordSyncJobRun: vi.fn(),
  purgeExpiredCache: vi.fn(),
  refreshPrivateRelayRanges: vi.fn(),
  runTradeAgentPass: vi.fn(),
}))

const RELAY_FRESH = { status: 'fresh', fetchedAt: '2026-09-05T02:00:00.000Z' }

const learningPass = vi.fn()
const LEARNING_IDLE = {
  examined: 0, valued: 0, refused: 0, locked: false, remaining: 0,
  aggregated: false, aggregateSkipped: 'nothing new was valued', error: null,
}

const calibrationPass = vi.fn()
const relationshipPass = vi.fn()
const draftMaintenancePass = vi.fn()
const CALIBRATION_RAN = {
  ran: true, season: 2026, feedbackAdjusted: false, driftSeverity: 'ok', outcomesLogged: 0, errors: [],
}

const PURGED = {
  available: true,
  deleted: 1200,
  batches: 3,
  capped: false,
  cutoff: '2026-09-05T12:00:00.000Z',
  fallbackCutoff: '2026-08-29T12:00:00.000Z',
}

vi.mock('@/lib/prisma', () => ({
  prisma: { syncJobRun: { updateMany: mocks.updateMany } },
}))

const CRON_SECRET = 'test-cron-secret'

function request(secret?: string) {
  return new Request('http://localhost/api/cron/reap-sync-runs', {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  }) as never
}

describe('reapAllAbandonedRuns', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('sweeps EVERY job name — the query must not be scoped by jobName', async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 4 })
    const { reapAllAbandonedRuns } = await import('@/lib/production-health/syncJobRunTelemetry')

    const result = await reapAllAbandonedRuns()

    expect(result).toMatchObject({ available: true, reaped: 4 })
    const where = mocks.updateMany.mock.calls[0]![0]!.where as Record<string, unknown>
    // The load-bearing assertion. Re-scoping this to a single job would reproduce the per-job
    // reaper and leave the never-fires-again case exactly as broken as before, while every other
    // assertion in this file still passed.
    expect(Object.keys(where)).not.toContain('jobName')
    expect(where.status).toBe('running')
  })

  it('only reaps rows older than the cutoff, and marks them failed', async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 1 })
    const { reapAllAbandonedRuns } = await import('@/lib/production-health/syncJobRunTelemetry')

    const now = Date.parse('2026-09-05T12:00:00.000Z')
    const abandonedAfterMs = 30 * 60_000
    const result = await reapAllAbandonedRuns({ now, abandonedAfterMs })

    const call = mocks.updateMany.mock.calls[0]![0]!
    const startedAt = (call.where as { startedAt: { lt: Date } }).startedAt
    expect(startedAt.lt.toISOString()).toBe('2026-09-05T11:30:00.000Z')
    expect(result.cutoff).toBe('2026-09-05T11:30:00.000Z')
    expect((call.data as { status: string }).status).toBe('failed')
    // A fabricated duration is worse than null — the real one is unknowable.
    expect(Object.keys(call.data as object)).not.toContain('durationMs')
  })

  it('reports UNAVAILABLE rather than a clean zero when the model is missing', async () => {
    vi.doMock('@/lib/prisma', () => ({ prisma: {} }))
    const { reapAllAbandonedRuns } = await import('@/lib/production-health/syncJobRunTelemetry')

    expect(await reapAllAbandonedRuns()).toMatchObject({ available: false, reaped: 0 })
  })

  it('reports UNAVAILABLE rather than a clean zero when the query throws', async () => {
    mocks.updateMany.mockRejectedValueOnce(new Error('connection lost'))
    const { reapAllAbandonedRuns } = await import('@/lib/production-health/syncJobRunTelemetry')

    expect(await reapAllAbandonedRuns()).toMatchObject({ available: false, reaped: 0 })
  })
})

describe('GET /api/cron/reap-sync-runs', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    vi.doMock('@/lib/production-health/syncJobRunTelemetry', () => ({
      reapAllAbandonedRuns: mocks.reapAllAbandonedRuns,
      recordSyncJobRun: mocks.recordSyncJobRun,
    }))
    vi.doMock('@/lib/enrichment-cache', () => ({ purgeExpiredCache: mocks.purgeExpiredCache }))
    // The Private Relay refresh fetches a multi-megabyte feed from Apple; never from a unit test.
    vi.doMock('@/lib/geo/privateRelayIngest', () => ({ refreshPrivateRelayRanges: mocks.refreshPrivateRelayRanges }))
    mocks.purgeExpiredCache.mockResolvedValue(PURGED)
    mocks.refreshPrivateRelayRanges.mockResolvedValue(RELAY_FRESH)
    // The nightly trade agent rides this route; mocked so these tests do not depend on the clock.
    vi.doMock('@/lib/decision-os/trade/tradeAgentPass', () => ({ runTradeAgentPass: mocks.runTradeAgentPass }))
    mocks.runTradeAgentPass.mockResolvedValue({ ran: false, reason: 'outside the nightly window' })
    // The trade-learning writer rides here too (2026-09-30); mocked so these tests touch no trades.
    vi.doMock('@/lib/comprehensive-trade-learning', () => ({ runComprehensiveBackgroundAnalysis: learningPass }))
    learningPass.mockReset().mockResolvedValue(LEARNING_IDLE)
    // The calibration cycle rides after the writer (2026-09-30); mocked so nothing reads TradeFeedback.
    vi.doMock('@/lib/trade-engine/calibrationPass', () => ({ runTradeCalibrationPass: calibrationPass }))
    calibrationPass.mockReset().mockResolvedValue(CALIBRATION_RAN)
    // The rivalry + drama writer rides last (2026-10-01); mocked so nothing reads matchup facts.
    vi.doMock('@/lib/relationship-insights/relationshipRefreshPass', () => ({ runRelationshipRefreshPass: relationshipPass }))
    relationshipPass.mockReset().mockResolvedValue({ ran: false, reason: 'outside the nightly window' })
    vi.doMock('@/lib/draft-archive/ingestion/maintenance',()=>({maintainDraftResults:draftMaintenancePass}))
    draftMaintenancePass.mockReset().mockResolvedValue({inventory:0,selected:0,examined:0,ready:0,partial:0,unavailable:0,failed:0,elapsedMs:0})
  })

  it('runs bounded draft maintenance after the earlier passes and returns aggregate coverage', async () => {
    mocks.reapAllAbandonedRuns.mockResolvedValueOnce({available:true,reaped:0,cutoff:'2026-09-05T11:30:00.000Z'})
    const order:string[]=[]
    relationshipPass.mockImplementationOnce(async()=>{order.push('relationships');return {ran:false,reason:'outside the nightly window'}})
    draftMaintenancePass.mockImplementationOnce(async()=>{order.push('drafts');return {inventory:1538,selected:2,examined:2,ready:1,partial:0,unavailable:0,failed:1,elapsedMs:50}})
    const {GET}=await import('@/app/api/cron/reap-sync-runs/route')
    const response=await GET(request(CRON_SECRET))
    expect(order).toEqual(['relationships','drafts'])
    expect(draftMaintenancePass.mock.calls[0][0]).toBeLessThanOrEqual(180000)
    expect(await response.json()).toMatchObject({ok:true,draftMaintenance:{examined:2,failed:1}})
  })

  it('does not start draft provider reads before cron authorization', async () => {
    const {GET}=await import('@/app/api/cron/reap-sync-runs/route')
    const response=await GET(request())
    expect(response.status).toBe(401)
    expect(draftMaintenancePass).not.toHaveBeenCalled()
  })

  it('isolates a failed draft pass and hides private source details', async () => {
    mocks.reapAllAbandonedRuns.mockResolvedValueOnce({available:true,reaped:0,cutoff:'2026-09-05T11:30:00.000Z'})
    draftMaintenancePass.mockRejectedValueOnce(new Error('private-user-id'))
    const {GET}=await import('@/app/api/cron/reap-sync-runs/route')
    const response=await GET(request(CRON_SECRET))
    expect(response.status).toBe(200)
    const result=await response.json()
    expect(result).toMatchObject({ok:true,draftMaintenance:{ran:false,reason:'draft maintenance failed'}})
    expect(JSON.stringify(result)).not.toContain('private-user-id')
  })

  it('runs the rivalry + drama refresh LAST, on only the budget everything before it left', async () => {
    mocks.reapAllAbandonedRuns.mockResolvedValueOnce({ available: true, reaped: 0, cutoff: '2026-09-05T11:30:00.000Z' })
    const order: string[] = []
    learningPass.mockImplementationOnce(async () => (order.push('learning'), { ...LEARNING_IDLE, valued: 2 }))
    calibrationPass.mockImplementationOnce(async () => (order.push('calibration'), CALIBRATION_RAN))
    relationshipPass.mockImplementationOnce(async () => (order.push('relationships'), { ran: true, refreshed: 3 }))
    const { GET } = await import('@/app/api/cron/reap-sync-runs/route')

    const res = await GET(request(CRON_SECRET))

    expect(order).toEqual(['learning', 'calibration', 'relationships'])
    const budgetMs = relationshipPass.mock.calls[0]![0].budgetMs
    expect(budgetMs).toBeGreaterThan(0)
    expect(budgetMs).toBeLessThanOrEqual(240_000)
    expect(await res.json()).toMatchObject({ ok: true, relationshipRefresh: { ran: true, refreshed: 3 } })
  })

  it('a failing rivalry + drama refresh never fails the reap', async () => {
    mocks.reapAllAbandonedRuns.mockResolvedValueOnce({ available: true, reaped: 1, cutoff: '2026-09-05T11:30:00.000Z' })
    relationshipPass.mockRejectedValueOnce(new Error('dw_matchup_facts unavailable'))
    const { GET } = await import('@/app/api/cron/reap-sync-runs/route')

    const res = await GET(request(CRON_SECRET))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      reaped: 1,
      relationshipRefresh: { ran: false, reason: 'dw_matchup_facts unavailable' },
    })
  })

  it('runs the calibration pass only after a learning pass that valued something, with its own telemetry row', async () => {
    mocks.reapAllAbandonedRuns.mockResolvedValueOnce({ available: true, reaped: 0, cutoff: '2026-09-05T11:30:00.000Z' })
    const order: string[] = []
    learningPass.mockImplementationOnce(async () => (order.push('learning'), { ...LEARNING_IDLE, valued: 3 }))
    calibrationPass.mockImplementationOnce(async () => (order.push('calibration'), { ...CALIBRATION_RAN, outcomesLogged: 3, errors: ['drift: boom'] }))
    const { GET } = await import('@/app/api/cron/reap-sync-runs/route')

    const res = await GET(request(CRON_SECRET))

    expect(order).toEqual(['learning', 'calibration'])
    const budgetMs = calibrationPass.mock.calls[0]![0].budgetMs
    expect(budgetMs).toBeGreaterThan(10_000)
    expect(budgetMs).toBeLessThanOrEqual(240_000)
    expect(mocks.recordSyncJobRun).toHaveBeenCalledWith(
      expect.objectContaining({ jobName: 'cron-trade-calibration' }),
      // rowsWritten is the COLUMN the health readers see; rowsUpdated only reaches metadata.
      expect.objectContaining({ rowsWritten: 3, rowsUpdated: 3, warnings: ['drift: boom'] }),
      expect.any(Number),
    )
    expect(await res.json()).toMatchObject({ ok: true, tradeCalibration: { ran: true, outcomesLogged: 3 } })
  })

  it('skips the calibration pass when the learning pass valued nothing and did not aggregate', async () => {
    mocks.reapAllAbandonedRuns.mockResolvedValueOnce({ available: true, reaped: 0, cutoff: '2026-09-05T11:30:00.000Z' })
    const { GET } = await import('@/app/api/cron/reap-sync-runs/route')

    const res = await GET(request(CRON_SECRET))

    expect(calibrationPass).not.toHaveBeenCalled()
    expect(mocks.recordSyncJobRun).not.toHaveBeenCalledWith(
      expect.objectContaining({ jobName: 'cron-trade-calibration' }),
      expect.anything(),
      expect.anything(),
    )
    expect(await res.json()).toMatchObject({ ok: true, tradeCalibration: { ran: false } })
  })

  it('runs the calibration pass after a re-aggregation even when nothing new was valued', async () => {
    mocks.reapAllAbandonedRuns.mockResolvedValueOnce({ available: true, reaped: 0, cutoff: '2026-09-05T11:30:00.000Z' })
    learningPass.mockResolvedValueOnce({ ...LEARNING_IDLE, aggregated: true, aggregateSkipped: null })
    const { GET } = await import('@/app/api/cron/reap-sync-runs/route')

    await GET(request(CRON_SECRET))

    expect(calibrationPass).toHaveBeenCalledTimes(1)
  })

  it('a failing calibration pass never fails the reap', async () => {
    mocks.reapAllAbandonedRuns.mockResolvedValueOnce({ available: true, reaped: 2, cutoff: '2026-09-05T11:30:00.000Z' })
    learningPass.mockResolvedValueOnce({ ...LEARNING_IDLE, valued: 1 })
    calibrationPass.mockRejectedValueOnce(new Error('feedback table missing'))
    const { GET } = await import('@/app/api/cron/reap-sync-runs/route')

    const res = await GET(request(CRON_SECRET))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, reaped: 2, tradeCalibration: { ran: false, reason: 'feedback table missing' } })
  })

  it('runs the trade-learning pass AFTER the agent, on the budget the agent left, with its own telemetry row', async () => {
    mocks.reapAllAbandonedRuns.mockResolvedValueOnce({ available: true, reaped: 0, cutoff: '2026-09-05T11:30:00.000Z' })
    const order: string[] = []
    mocks.runTradeAgentPass.mockImplementationOnce(async () => (order.push('agent'), { ran: false, reason: 'x' }))
    learningPass.mockImplementationOnce(async () => (order.push('learning'), { ...LEARNING_IDLE, valued: 4, refused: 1 }))
    const { GET } = await import('@/app/api/cron/reap-sync-runs/route')

    const res = await GET(request(CRON_SECRET))

    expect(order).toEqual(['agent', 'learning'])
    const budgetMs = learningPass.mock.calls[0]![0].budgetMs
    expect(budgetMs).toBeGreaterThan(20_000)
    expect(budgetMs).toBeLessThanOrEqual(240_000)
    expect(mocks.recordSyncJobRun).toHaveBeenCalledWith(
      expect.objectContaining({ jobName: 'cron-trade-learning' }),
      expect.objectContaining({ rowsWritten: 5, rowsUpdated: 5 }),
      expect.any(Number),
    )
    expect(await res.json()).toMatchObject({ ok: true, tradeLearning: { valued: 4, refused: 1 } })
  })

  it('a failing trade-learning pass never fails the reap', async () => {
    mocks.reapAllAbandonedRuns.mockResolvedValueOnce({ available: true, reaped: 2, cutoff: '2026-09-05T11:30:00.000Z' })
    learningPass.mockRejectedValueOnce(new Error('aggregation exploded'))
    const { GET } = await import('@/app/api/cron/reap-sync-runs/route')

    const res = await GET(request(CRON_SECRET))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, reaped: 2, tradeLearning: { ran: false, reason: 'aggregation exploded' } })
  })

  it('runs the trade-agent pass only AFTER the heartbeat, inside the route budget', async () => {
    mocks.reapAllAbandonedRuns.mockResolvedValueOnce({ available: true, reaped: 1, cutoff: '2026-09-05T11:30:00.000Z' })
    const order: string[] = []
    mocks.recordSyncJobRun.mockImplementationOnce(async () => void order.push('heartbeat'))
    mocks.runTradeAgentPass.mockImplementationOnce(async () => (order.push('agent'), { ran: false, reason: 'x' }))
    const { GET } = await import('@/app/api/cron/reap-sync-runs/route')

    const res = await GET(request(CRON_SECRET))

    expect(order).toEqual(['heartbeat', 'agent'])
    const budgetMs = mocks.runTradeAgentPass.mock.calls[0]![0].budgetMs
    expect(budgetMs).toBeGreaterThan(200_000)
    expect(budgetMs).toBeLessThanOrEqual(240_000)
    expect(await res.json()).toMatchObject({ ok: true, reaped: 1, tradeAgent: { ran: false } })
  })

  it('a failing trade-agent pass never fails the reap', async () => {
    mocks.reapAllAbandonedRuns.mockResolvedValueOnce({ available: true, reaped: 3, cutoff: '2026-09-05T11:30:00.000Z' })
    mocks.runTradeAgentPass.mockRejectedValueOnce(new Error('grader exploded'))
    const { GET } = await import('@/app/api/cron/reap-sync-runs/route')

    const res = await GET(request(CRON_SECRET))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, reaped: 3, tradeAgent: { ran: false, reason: 'grader exploded' } })
  })

  it('rejects an unauthenticated call without touching the database', async () => {
    const { GET } = await import('@/app/api/cron/reap-sync-runs/route')

    const res = await GET(request())

    expect(res.status).toBe(401)
    expect(mocks.reapAllAbandonedRuns).not.toHaveBeenCalled()
    expect(mocks.purgeExpiredCache).not.toHaveBeenCalled()
  })

  it('rejects a wrong secret', async () => {
    const { GET } = await import('@/app/api/cron/reap-sync-runs/route')

    const res = await GET(request('not-the-secret'))

    expect(res.status).toBe(401)
    expect(mocks.reapAllAbandonedRuns).not.toHaveBeenCalled()
  })

  it('reaps and reports the count when authorised', async () => {
    mocks.reapAllAbandonedRuns.mockResolvedValueOnce({
      available: true,
      reaped: 6,
      cutoff: '2026-09-05T11:30:00.000Z',
    })
    const { GET } = await import('@/app/api/cron/reap-sync-runs/route')

    const res = await GET(request(CRON_SECRET))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, reaped: 6 })
    // The heartbeat is the ONLY evidence this route ran: cron-freshness-check probes it by
    // job_name, so a sweep that reaps correctly and records nothing reads as a dead scheduler.
    // Asserted rather than stubbed on purpose -- the missing export made this the one test that
    // reached the call, and a bare vi.fn() would have silenced the error without guarding it.
    // Reap heartbeat, trade-learning row and terminal draft-maintenance telemetry.
    expect(mocks.recordSyncJobRun).toHaveBeenCalledTimes(3)
    expect(mocks.recordSyncJobRun.mock.calls[0]![0]).toMatchObject({ jobName: 'cron-reap-sync-runs' })
  })

  it('purges expired cache rows after the reap, and records what it did', async () => {
    mocks.reapAllAbandonedRuns.mockResolvedValueOnce({
      available: true,
      reaped: 2,
      cutoff: '2026-09-05T11:30:00.000Z',
    })
    const { GET } = await import('@/app/api/cron/reap-sync-runs/route')

    const res = await GET(request(CRON_SECRET))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, reaped: 2, cachePurge: PURGED })
    expect(mocks.purgeExpiredCache).toHaveBeenCalledTimes(1)
    expect(mocks.reapAllAbandonedRuns.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.purgeExpiredCache.mock.invocationCallOrder[0]!,
    )
    // The heartbeat row is where anyone reading sync_job_runs will look for the purge.
    const outcome = mocks.recordSyncJobRun.mock.calls[0]![1] as {
      rowsWritten: number
      rowsUpdated: number
      warnings: string[]
      metadata: Record<string, unknown>
    }
    // Both: `rows_written` is the only column, and the reaper's count must reach it.
    expect(outcome.rowsWritten).toBe(2)
    expect(outcome.rowsUpdated).toBe(2)
    expect(outcome.warnings).toEqual([])
    expect(outcome.metadata.cachePurge).toEqual(PURGED)
  })

  it('reports a purge that could not run as a warning, without failing the reap', async () => {
    mocks.reapAllAbandonedRuns.mockResolvedValueOnce({
      available: true,
      reaped: 3,
      cutoff: '2026-09-05T11:30:00.000Z',
    })
    const blind = { ...PURGED, available: false, deleted: 0, batches: 0, error: 'connection lost' }
    mocks.purgeExpiredCache.mockResolvedValueOnce(blind)
    const { GET } = await import('@/app/api/cron/reap-sync-runs/route')

    const res = await GET(request(CRON_SECRET))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, reaped: 3, cachePurge: { available: false } })
    const outcome = mocks.recordSyncJobRun.mock.calls[0]![1] as { warnings: string[]; metadata: Record<string, unknown> }
    // A warning makes the run `partial`, so a blind purge cannot read as a clean zero.
    expect(outcome.warnings).toEqual(['cache purge: connection lost'])
    expect(outcome.metadata.cachePurge).toEqual(blind)
  })

  it('refreshes the Private Relay ranges after the reap, and records the outcome', async () => {
    mocks.reapAllAbandonedRuns.mockResolvedValueOnce({ available: true, reaped: 0, cutoff: '2026-09-05T11:30:00.000Z' })
    const { GET } = await import('@/app/api/cron/reap-sync-runs/route')

    const res = await GET(request(CRON_SECRET))

    expect(mocks.refreshPrivateRelayRanges).toHaveBeenCalledTimes(1)
    expect(await res.json()).toMatchObject({ ok: true, privateRelay: RELAY_FRESH })
    const outcome = mocks.recordSyncJobRun.mock.calls[0]![1] as { warnings: string[]; metadata: Record<string, unknown> }
    expect(outcome.warnings).toEqual([])
    expect(outcome.metadata.privateRelay).toEqual(RELAY_FRESH)
  })

  it('reports a failed Private Relay refresh as a warning, without failing the reap', async () => {
    mocks.reapAllAbandonedRuns.mockResolvedValueOnce({ available: true, reaped: 1, cutoff: '2026-09-05T11:30:00.000Z' })
    mocks.refreshPrivateRelayRanges.mockResolvedValueOnce({ status: 'failed', error: 'feed down', keptFetchedAt: null })
    const { GET } = await import('@/app/api/cron/reap-sync-runs/route')

    const res = await GET(request(CRON_SECRET))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, reaped: 1 })
    const outcome = mocks.recordSyncJobRun.mock.calls[0]![1] as { warnings: string[] }
    expect(outcome.warnings).toEqual(['private relay ranges: feed down'])
  })

  it('survives the Private Relay refresh throwing', async () => {
    mocks.reapAllAbandonedRuns.mockResolvedValueOnce({ available: true, reaped: 1, cutoff: '2026-09-05T11:30:00.000Z' })
    mocks.refreshPrivateRelayRanges.mockRejectedValueOnce(new Error('db gone'))
    const { GET } = await import('@/app/api/cron/reap-sync-runs/route')

    const res = await GET(request(CRON_SECRET))

    expect(res.status).toBe(200)
    const outcome = mocks.recordSyncJobRun.mock.calls[0]![1] as { warnings: string[] }
    expect(outcome.warnings).toEqual(['private relay ranges: db gone'])
  })

  it('does not warn when the purge is switched off on purpose', async () => {
    mocks.reapAllAbandonedRuns.mockResolvedValueOnce({
      available: true,
      reaped: 0,
      cutoff: '2026-09-05T11:30:00.000Z',
    })
    mocks.purgeExpiredCache.mockResolvedValueOnce({ ...PURGED, available: false, deleted: 0, batches: 0, error: 'disabled' })
    const { GET } = await import('@/app/api/cron/reap-sync-runs/route')

    await GET(request(CRON_SECRET))

    const outcome = mocks.recordSyncJobRun.mock.calls[0]![1] as { warnings: string[] }
    expect(outcome.warnings).toEqual([])
  })

  it('does NOT return a green zero when the sweep could not run', async () => {
    mocks.reapAllAbandonedRuns.mockResolvedValueOnce({
      available: false,
      reaped: 0,
      cutoff: '2026-09-05T11:30:00.000Z',
    })
    const { GET } = await import('@/app/api/cron/reap-sync-runs/route')

    const res = await GET(request(CRON_SECRET))

    // A blind sweep reporting 200/reaped:0 is indistinguishable from a healthy one — which is the
    // exact class of false-clean signal this route exists to remove, not to add.
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ ok: false, reaped: 0 })
    // And the 503 path records NOTHING, which the route states as deliberate: a heartbeat written
    // for a sweep that could not look is precisely the false-clean signal this route removes.
    expect(mocks.recordSyncJobRun).not.toHaveBeenCalled()
    // An unreachable telemetry model means an unreachable database: the purge is not attempted.
    expect(mocks.purgeExpiredCache).not.toHaveBeenCalled()
  })
})

describe('the reaper is actually scheduled', () => {
  // A route nobody fires is the failure this repo has hit repeatedly: registered, deployed, and
  // silently never invoked. Assert the registry entry exists AND that its schedule is one the
  // slow-tier workflow actually triggers — a schedule with no matching `on.schedule:` line fires
  // nothing, and the route would look healthy while never running.
  it('is registered in cron-schedule.json on a schedule the slow tier fires', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const root = resolve(__dirname, '..')

    const registry = JSON.parse(readFileSync(resolve(root, 'cron-schedule.json'), 'utf8')) as {
      crons: { path: string; schedule: string }[]
    }
    const entry = registry.crons.find((c) => c.path === '/api/cron/reap-sync-runs')
    expect(entry, 'reap-sync-runs must be declared in cron-schedule.json').toBeDefined()

    const workflow = readFileSync(resolve(root, '.github/workflows/cron-slow-tier.yml'), 'utf8')
    expect(
      workflow,
      `no "on.schedule" line fires "${entry!.schedule}" — the cron would never run`,
    ).toContain(`- cron: "${entry!.schedule}"`)
  })
})
