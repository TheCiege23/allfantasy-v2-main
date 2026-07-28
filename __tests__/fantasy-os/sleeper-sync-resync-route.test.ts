// @vitest-environment node
/**
 * B6 (DB-first) — ROUTE tests for /api/leagues/import/resync.
 *   POST (Sleeper) enqueues a durable job and returns 202 WITHOUT any inline durable refresh / provider
 *   fetch; a quota rejection surfaces its 429; non-Sleeper providers keep the inline path.
 *   GET returns a sanitized, DB-backed status phase derived from the AutomationJob + LeagueSyncState.
 * Fully mocked at the module boundary — no DB, no live provider.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  requireVerifiedUser: vi.fn(),
  resolveProvider: vi.fn(),
  isImportProviderAvailable: vi.fn(),
  resyncImportedLeague: vi.fn(),
  enqueue: vi.fn(),
  resolveConn: vi.fn(),
  jobFindFirst: vi.fn(),
  lssFindUnique: vi.fn(),
}))

vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: h.requireVerifiedUser }))
vi.mock('@/lib/league-import/ImportProviderResolver', () => ({ resolveProvider: h.resolveProvider }))
vi.mock('@/lib/league-import/provider-ui-config', () => ({ isImportProviderAvailable: h.isImportProviderAvailable }))
vi.mock('@/lib/league-import/resyncImportUtility', () => ({ resyncImportedLeague: h.resyncImportedLeague }))
vi.mock('@/lib/fantasy-os/sync/refreshJob/enqueueSleeperRefreshJob', () => ({ enqueueSleeperRefreshJob: h.enqueue }))
vi.mock('@/lib/fantasy-os/sync/collector', () => ({ resolveSleeperConnectionForSource: h.resolveConn }))
vi.mock('@/lib/prisma', () => ({
  prisma: { automationJob: { findFirst: h.jobFindFirst }, leagueSyncState: { findUnique: h.lssFindUnique } },
}))

import { POST, GET } from '@/app/api/leagues/import/resync/route'

function postReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}
function getReq(qs: string): NextRequest {
  return { url: `http://x/api/leagues/import/resync?${qs}` } as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireVerifiedUser.mockResolvedValue({ ok: true, userId: 'U1' })
  h.resolveProvider.mockImplementation((p: string) => p)
  h.isImportProviderAvailable.mockReturnValue(true)
})

describe('POST /api/leagues/import/resync — Sleeper enqueues (202), no inline fetch', () => {
  it('queued → 202 with a sanitized job status, and NO inline durable refresh', async () => {
    h.enqueue.mockResolvedValue({ ok: true, status: 'queued', jobId: 'job1', leagueId: 'L1', lastSuccessfullyUpdated: null })
    const res = await POST(postReq({ provider: 'sleeper', sourceId: '131353' }))
    expect(res.status).toBe(202)
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, status: 'queued', jobId: 'job1', leagueId: 'L1' })
    expect(h.resyncImportedLeague).not.toHaveBeenCalled()
    expect(JSON.stringify(json)).not.toMatch(/token|password|normalized|playerData|fos-sync/i)
  })

  it('quota exceeded → 429', async () => {
    h.enqueue.mockResolvedValue({ ok: false, httpStatus: 429, error: 'Too many refreshes in progress.' })
    const res = await POST(postReq({ provider: 'sleeper', sourceId: '131353' }))
    expect(res.status).toBe(429)
    expect((await res.json()).ok).toBe(false)
  })

  it('access failure keeps its 4xx (403)', async () => {
    h.enqueue.mockResolvedValue({ ok: false, httpStatus: 403, error: 'no access' })
    const res = await POST(postReq({ provider: 'sleeper', sourceId: '131353' }))
    expect(res.status).toBe(403)
  })

  it('non-Sleeper provider keeps the inline path (200), never enqueues', async () => {
    h.resyncImportedLeague.mockResolvedValue({ ok: true, leagueId: 'L2', runId: 'R', warningCount: 0, reviewRequired: false, refresh: null })
    const res = await POST(postReq({ provider: 'espn', sourceId: '999' }))
    expect(res.status).toBe(200)
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('missing provider/sourceId → 400', async () => {
    const res = await POST(postReq({ provider: '', sourceId: '' }))
    expect(res.status).toBe(400)
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('unauthenticated → the auth response (401)', async () => {
    const { NextResponse } = await import('next/server')
    h.requireVerifiedUser.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'unauth' }, { status: 401 }) })
    const res = await POST(postReq({ provider: 'sleeper', sourceId: '131353' }))
    expect(res.status).toBe(401)
  })
})

describe('GET /api/leagues/import/resync — DB-backed status phase', () => {
  beforeEach(() => {
    h.resolveConn.mockResolvedValue({ ok: true, connection: { runKey: 'sleeper:131353:2026' }, leagueId: 'L1' })
  })

  it('in-flight job → refreshing', async () => {
    h.jobFindFirst.mockResolvedValue({ status: 'running', metadata: {} })
    h.lssFindUnique.mockResolvedValue({ syncStatus: 'pending', lastAttemptedSyncAt: null, lastSuccessfulSyncAt: null })
    const res = await GET(getReq('provider=sleeper&sourceId=131353'))
    expect(res.status).toBe(200)
    expect((await res.json()).phase).toBe('refreshing')
  })

  it('completed + changed → updated', async () => {
    const now = new Date()
    h.jobFindFirst.mockResolvedValue({ status: 'completed', metadata: { changed: true } })
    h.lssFindUnique.mockResolvedValue({ syncStatus: 'synced', lastAttemptedSyncAt: now, lastSuccessfulSyncAt: now })
    expect((await (await GET(getReq('provider=sleeper&sourceId=131353'))).json()).phase).toBe('updated')
  })

  it('completed + unchanged → no_change', async () => {
    const now = new Date()
    h.jobFindFirst.mockResolvedValue({ status: 'completed', metadata: { changed: false } })
    h.lssFindUnique.mockResolvedValue({ syncStatus: 'synced', lastAttemptedSyncAt: now, lastSuccessfulSyncAt: now })
    expect((await (await GET(getReq('provider=sleeper&sourceId=131353'))).json()).phase).toBe('no_change')
  })

  it('failed durable run → failed (previous data preserved)', async () => {
    h.jobFindFirst.mockResolvedValue({ status: 'failed', metadata: {} })
    h.lssFindUnique.mockResolvedValue({ syncStatus: 'partial', lastAttemptedSyncAt: new Date(), lastSuccessfulSyncAt: new Date(Date.now() - 100_000) })
    expect((await (await GET(getReq('provider=sleeper&sourceId=131353'))).json()).phase).toBe('failed')
  })

  it('missing params → 400', async () => {
    expect((await GET(getReq('provider=sleeper'))).status).toBe(400)
  })
})
