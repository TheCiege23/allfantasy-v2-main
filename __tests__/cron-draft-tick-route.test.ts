/**
 * Contract tests for GET /api/cron/draft-tick.
 *
 * Context: `processExpiredDraftPicks` was written and unit-tested but had ZERO
 * production callers — nothing scheduled it and no route invoked it. Draft
 * advancement was driven entirely by a connected browser (the live-sync poll's
 * automation ticks, plus the client-initiated autopick-expired route), so if every
 * manager closed their tab an expired pick timer never fired and a slow/overnight
 * draft stalled indefinitely. This route is what makes the server advance drafts.
 *
 * Because enabling server-side autopick is a visible behavioural change to live
 * drafts, the route is gated behind DRAFT_TICK_CRON_ENABLED (default OFF). These
 * tests pin both the auth boundary and the kill-switch semantics.
 *
 * NOTE: follows the repo's working route-test pattern (see admin-metrics-route.test.ts) —
 * `vi.hoisted` mocks and a plain `Request`. Importing `next/server` at module top
 * level hangs the vitest worker on startup in this repo.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  processExpiredDraftPicks: vi.fn(),
}))

vi.mock('@/lib/live-draft-engine/expired-picks/processExpiredDraftPicks', () => ({
  processExpiredDraftPicks: mocks.processExpiredDraftPicks,
}))

// Telemetry is exercised for real elsewhere; here it must not require a database.
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
}))

const CRON_SECRET = 'test-cron-secret'
const SUMMARY = { scanned: 3, processed: 2, skipped: 1, errors: [], details: [] }

function request(secret?: string, url = 'http://localhost/api/cron/draft-tick') {
  return new Request(url, {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  }) as never
}

describe('GET /api/cron/draft-tick', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.processExpiredDraftPicks.mockResolvedValue(SUMMARY)
    process.env.CRON_SECRET = CRON_SECRET
    delete process.env.LEAGUE_CRON_SECRET
    delete process.env.ADMIN_PASSWORD
    delete process.env.BRACKET_ADMIN_SECRET
    delete process.env.IMPORT_WORKER_SECRET
    delete process.env.DRAFT_TICK_CRON_ENABLED
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('rejects a request with no credential', async () => {
    const { GET } = await import('@/app/api/cron/draft-tick/route')
    const res = await GET(request())
    expect(res.status).toBe(401)
    expect(mocks.processExpiredDraftPicks).not.toHaveBeenCalled()
  })

  it('rejects a wrong bearer secret', async () => {
    const { GET } = await import('@/app/api/cron/draft-tick/route')
    const res = await GET(request('not-the-secret'))
    expect(res.status).toBe(401)
    expect(mocks.processExpiredDraftPicks).not.toHaveBeenCalled()
  })

  it('authorises a valid cron bearer but stays inert while the flag is unset', async () => {
    const { GET } = await import('@/app/api/cron/draft-tick/route')
    const res = await GET(request(CRON_SECRET))

    // 200, not an error: a disabled tick must not paint the schedule red or emit
    // false failure telemetry.
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, disabled: true })
    expect(mocks.processExpiredDraftPicks).not.toHaveBeenCalled()
  })

  it('treats an explicit "false" as disabled (not a truthy string)', async () => {
    process.env.DRAFT_TICK_CRON_ENABLED = 'false'
    const { GET } = await import('@/app/api/cron/draft-tick/route')
    const res = await GET(request(CRON_SECRET))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ disabled: true })
    expect(mocks.processExpiredDraftPicks).not.toHaveBeenCalled()
  })

  it('runs the scanner and returns its summary when enabled', async () => {
    process.env.DRAFT_TICK_CRON_ENABLED = 'true'
    const { GET } = await import('@/app/api/cron/draft-tick/route')
    const res = await GET(request(CRON_SECRET))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      scanned: 3,
      processed: 2,
      skipped: 1,
    })
    expect(mocks.processExpiredDraftPicks).toHaveBeenCalledTimes(1)
    expect(mocks.processExpiredDraftPicks).toHaveBeenCalledWith({ maxLeagues: 40 })
  })

  it('honours a maxLeagues override from the query string', async () => {
    process.env.DRAFT_TICK_CRON_ENABLED = 'true'
    const { GET } = await import('@/app/api/cron/draft-tick/route')
    await GET(request(CRON_SECRET, 'http://localhost/api/cron/draft-tick?maxLeagues=5'))
    expect(mocks.processExpiredDraftPicks).toHaveBeenCalledWith({ maxLeagues: 5 })
  })

  it('ignores a non-numeric maxLeagues rather than passing NaN to the scanner', async () => {
    process.env.DRAFT_TICK_CRON_ENABLED = 'true'
    const { GET } = await import('@/app/api/cron/draft-tick/route')
    await GET(request(CRON_SECRET, 'http://localhost/api/cron/draft-tick?maxLeagues=abc'))
    expect(mocks.processExpiredDraftPicks).toHaveBeenCalledWith({ maxLeagues: 40 })
  })

  it('returns 500 rather than throwing when the scanner fails', async () => {
    process.env.DRAFT_TICK_CRON_ENABLED = 'true'
    mocks.processExpiredDraftPicks.mockRejectedValue(new Error('db exploded'))
    const { GET } = await import('@/app/api/cron/draft-tick/route')
    const res = await GET(request(CRON_SECRET))
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'db exploded' })
  })
})
