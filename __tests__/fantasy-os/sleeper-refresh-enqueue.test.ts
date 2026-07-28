// @vitest-environment node
/**
 * B6 (DB-first) — the manual resync ENQUEUE returns immediately, performs NO provider fetch, enforces a
 * soft quota, and collapses duplicate clicks to ONE durable AutomationJob. Fully mocked (prisma +
 * connection resolver) — no DB, no live provider.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  resolveConn: vi.fn(),
  lssFindUnique: vi.fn(),
  jobFindFirst: vi.fn(),
  jobCount: vi.fn(),
  jobCreate: vi.fn(),
  jobFindUnique: vi.fn(),
}))

vi.mock('@/lib/fantasy-os/sync/collector', () => ({ resolveSleeperConnectionForSource: h.resolveConn }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueSyncState: { findUnique: h.lssFindUnique },
    automationJob: { findFirst: h.jobFindFirst, count: h.jobCount, create: h.jobCreate, findUnique: h.jobFindUnique },
  },
}))

import { enqueueSleeperRefreshJob } from '@/lib/fantasy-os/sync/refreshJob/enqueueSleeperRefreshJob'
import { SLEEPER_REFRESH_JOB_TYPE, SLEEPER_REFRESH_MAX_INFLIGHT_PER_USER } from '@/lib/fantasy-os/sync/refreshJob/constants'

const CONN = { runKey: 'sleeper:131353:2026', provider: 'sleeper' as const, externalLeagueId: '131353', season: 2026, sport: 'NFL' }
const NOW = new Date('2026-07-28T14:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  h.resolveConn.mockResolvedValue({ ok: true, connection: CONN, leagueId: 'L1' })
  h.lssFindUnique.mockResolvedValue(null)
  h.jobFindFirst.mockResolvedValue(null)
  h.jobCount.mockResolvedValue(0)
  h.jobCreate.mockResolvedValue({ id: 'job1' })
})

describe('enqueueSleeperRefreshJob — fast, durable, idempotent', () => {
  it('returns queued WITHOUT any provider fetch, creating ONE pending AutomationJob', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as never)
    const out = await enqueueSleeperRefreshJob({ userId: 'U1', externalLeagueId: '131353', now: NOW })
    expect(out).toMatchObject({ ok: true, status: 'queued', jobId: 'job1', leagueId: 'L1' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(h.jobCreate).toHaveBeenCalledTimes(1)
    const data = h.jobCreate.mock.calls[0]![0].data
    expect(data.status).toBe('pending')
    expect(data.jobType).toBe(SLEEPER_REFRESH_JOB_TYPE)
    expect(String(data.idempotencyKey)).toContain('sleeper-refresh:sleeper:131353:2026:')
    expect(data.metadata.connection.runKey).toBe(CONN.runKey)
  })

  it('duplicate click reuses one job (already_running, no second create)', async () => {
    h.jobFindFirst.mockResolvedValue({ id: 'job1' })
    const out = await enqueueSleeperRefreshJob({ userId: 'U1', externalLeagueId: '131353', now: NOW })
    expect(out).toMatchObject({ ok: true, status: 'already_running', jobId: 'job1' })
    expect(h.jobCreate).not.toHaveBeenCalled()
  })

  it('enforces the per-user in-flight quota with 429 (completed/failed jobs are not in-flight)', async () => {
    h.jobCount.mockResolvedValue(SLEEPER_REFRESH_MAX_INFLIGHT_PER_USER)
    const out = await enqueueSleeperRefreshJob({ userId: 'U1', externalLeagueId: '131353', now: NOW })
    expect(out).toEqual({ ok: false, httpStatus: 429, error: expect.stringMatching(/too many/i) })
    expect(h.jobCreate).not.toHaveBeenCalled()
  })

  it('honors the cooldown after a recent SUCCESSFUL sync (up_to_date, no new job)', async () => {
    h.lssFindUnique.mockResolvedValue({ lastSuccessfulSyncAt: new Date(NOW.getTime() - 5_000) })
    const out = await enqueueSleeperRefreshJob({ userId: 'U1', externalLeagueId: '131353', now: NOW })
    expect(out).toMatchObject({ ok: true, status: 'up_to_date' })
    expect(h.jobCreate).not.toHaveBeenCalled()
  })

  it('surfaces an access failure as its HTTP status', async () => {
    h.resolveConn.mockResolvedValue({ ok: false, status: 403, error: 'no access' })
    const out = await enqueueSleeperRefreshJob({ userId: 'U1', externalLeagueId: '131353', now: NOW })
    expect(out).toEqual({ ok: false, httpStatus: 403, error: 'no access' })
    expect(h.jobCreate).not.toHaveBeenCalled()
  })
})
