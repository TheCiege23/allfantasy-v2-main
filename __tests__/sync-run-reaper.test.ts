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
}))

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
    }))
  })

  it('rejects an unauthenticated call without touching the database', async () => {
    const { GET } = await import('@/app/api/cron/reap-sync-runs/route')

    const res = await GET(request())

    expect(res.status).toBe(401)
    expect(mocks.reapAllAbandonedRuns).not.toHaveBeenCalled()
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
