/**
 * `/api/cron/morning-briefing` — the heartbeat must survive the feature flag being off.
 *
 * WHY THIS EXISTS. The `withSyncJobRun` wrap used to start BELOW the `MORNING_BRIEFING_ENABLED`
 * early-return, so with the flag off the route answered 200 and recorded nothing. The freshness
 * monitor probes this job by `max(started_at)` in sync_job_runs, which means a deliberately
 * disabled job and a job whose scheduler died look identical — and this one sat at 3.1 days stale
 * while firing correctly every single day, reporting `ok:true` and `1/1 succeeded` each time.
 *
 * Exactly the bug draft-tick had: a wrap below an early return covers only the path someone
 * happened to be thinking about.
 *
 * The disabled path is the important test here — it is the one that was broken, and it is the one
 * that stays broken if someone "simplifies" the flag check back above the wrap.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { withSyncJobRunMock, syncRuns, prismaMock } = vi.hoisted(() => {
  const syncRuns: Array<{ ctx: { jobName: string }; outcome: unknown }> = []
  return {
    syncRuns,
    withSyncJobRunMock: vi.fn(
      async (ctx: { jobName: string }, fn: () => Promise<unknown>, extract?: (r: unknown) => unknown) => {
        const result = await fn()
        syncRuns.push({ ctx, outcome: extract ? extract(result) : null })
        return result
      },
    ),
    prismaMock: {
      league: { findMany: vi.fn() },
      appUser: { findMany: vi.fn() },
    },
  }
})

vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({ withSyncJobRun: withSyncJobRunMock }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

// The non-cron branch calls getServerSession, which needs a Next request scope vitest does not
// provide ("`headers` was called outside a request scope"). Stubbed to an anonymous session so the
// fall-through path is reachable at all — nothing here depends on WHAT it returns, only that a
// request without the cron secret never records a heartbeat.
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { GET } from '@/app/api/cron/morning-briefing/route'

const SECRET = 'test-cron-secret'
const ORIGINAL_ENV = { ...process.env }

function cronReq(): never {
  return new Request('http://localhost/api/cron/morning-briefing', {
    headers: { authorization: `Bearer ${SECRET}` },
  }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  syncRuns.length = 0
  process.env.CRON_SECRET = SECRET
  process.env.NODE_ENV = 'test'
  prismaMock.league.findMany.mockResolvedValue([])
  prismaMock.appUser.findMany.mockResolvedValue([])
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('a disabled job still proves the scheduler fired', () => {
  it('records a heartbeat when MORNING_BRIEFING_ENABLED is not set', async () => {
    // THE REGRESSION. Before the fix this path returned before the wrap and wrote nothing, so the
    // probe read stale forever while the cron fired daily.
    delete process.env.MORNING_BRIEFING_ENABLED

    const res = await GET(cronReq())
    const body = await res.json()

    expect(syncRuns).toHaveLength(1)
    expect(syncRuns[0].ctx.jobName).toBe('cron-morning-briefing')
    expect(res.status).toBe(200)
    expect(body).toEqual({
      mode: 'cron',
      enabled: false,
      note: 'Set MORNING_BRIEFING_ENABLED=1 to enable the daily sweep.',
    })
  })

  it('marks the disabled run success, not failure — inert is not broken', async () => {
    delete process.env.MORNING_BRIEFING_ENABLED
    await GET(cronReq())
    expect(syncRuns[0].outcome).toMatchObject({ status: 'success', metadata: { disabled: true } })
  })

  it('does no work while disabled — the flag still gates the sweep', async () => {
    // Moving the wrap must not move the flag. Nothing should be queried or sent.
    delete process.env.MORNING_BRIEFING_ENABLED
    await GET(cronReq())
    expect(prismaMock.league.findMany).not.toHaveBeenCalled()
    expect(prismaMock.appUser.findMany).not.toHaveBeenCalled()
  })
})

describe('the enabled path is unchanged', () => {
  it('runs the sweep and reports the same body shape as before', async () => {
    process.env.MORNING_BRIEFING_ENABLED = '1'
    prismaMock.league.findMany.mockResolvedValue([{ userId: 'u1' }])
    prismaMock.appUser.findMany.mockResolvedValue([{ id: 'u1', email: null }]) // no email -> skipped

    const res = await GET(cronReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ mode: 'cron', enabled: true, candidates: 1, sent: 0, failed: 0 })
    expect(syncRuns).toHaveLength(1)
    expect(prismaMock.league.findMany).toHaveBeenCalled()
  })

  it('records a heartbeat when enabled but there is nobody to brief', async () => {
    // Zero candidates is a legitimate quiet day, not a dead scheduler.
    process.env.MORNING_BRIEFING_ENABLED = '1'
    const res = await GET(cronReq())
    const body = await res.json()

    expect(syncRuns).toHaveLength(1)
    expect(body).toEqual({ mode: 'cron', enabled: true, candidates: 0, sent: 0, failed: 0 })
  })
})

describe('non-cron callers are untouched', () => {
  it('does not record a heartbeat for a request without the cron secret', async () => {
    // A manual/browser hit falls through to the session-authenticated branch. Recording a run
    // there would let a hand-made request masquerade as a scheduled fire.
    const res = await GET(new Request('http://localhost/api/cron/morning-briefing') as never)
    expect(withSyncJobRunMock).not.toHaveBeenCalled()
    expect(res.status).toBe(401)
  })
})
