/**
 * Commissioner OS Surface Alignment — Phase B Increment 4.
 *
 * Contract test for `/api/cron/decision-os-snapshot-capture`: identical auth shape to
 * `app/api/cron/waivers/route.ts` (Bearer CRON_SECRET, non-production `?secret=` fallback),
 * explicit-leagueId(s) parsing, dryRun short-circuit, and honest `snapshot_store_unavailable`
 * degradation when the Prisma delegate isn't present. No DB, no network — the job functions and
 * store factory are mocked; this file only proves the route's own dispatch contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { captureLeagueSnapshotJobMock, captureLeagueSnapshotsBatchJobMock, createDefaultBehavioralSnapshotStoreMock } =
  vi.hoisted(() => ({
    captureLeagueSnapshotJobMock: vi.fn(),
    captureLeagueSnapshotsBatchJobMock: vi.fn(),
    createDefaultBehavioralSnapshotStoreMock: vi.fn(),
  }))

vi.mock('@/lib/decision-os/snapshot/captureLeagueSnapshotJob', () => ({
  captureLeagueSnapshotJob: captureLeagueSnapshotJobMock,
  captureLeagueSnapshotsBatchJob: captureLeagueSnapshotsBatchJobMock,
}))

vi.mock('@/lib/decision-os/snapshot/prismaBehavioralSnapshotStore', () => ({
  createDefaultBehavioralSnapshotStore: createDefaultBehavioralSnapshotStoreMock,
}))

import { GET } from '@/app/api/cron/decision-os-snapshot-capture/route'

const ORIGINAL_ENV = { ...process.env }

function req(path: string, headers?: Record<string, string>) {
  return new Request(`http://localhost${path}`, { headers }) as unknown as Parameters<typeof GET>[0]
}

describe('/api/cron/decision-os-snapshot-capture route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-secret'
    process.env.NODE_ENV = 'test'
    createDefaultBehavioralSnapshotStoreMock.mockReturnValue({})
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('blocks unauthorized access (no secret at all)', async () => {
    const res = await GET(req('/api/cron/decision-os-snapshot-capture?leagueId=L1'))
    expect(res.status).toBe(401)
    expect(captureLeagueSnapshotJobMock).not.toHaveBeenCalled()
  })

  it('blocks a wrong bearer token', async () => {
    const res = await GET(
      req('/api/cron/decision-os-snapshot-capture?leagueId=L1', { authorization: 'Bearer wrong' }),
    )
    expect(res.status).toBe(401)
  })

  it('rejects with 401 if CRON_SECRET is unset, even with a matching-looking query secret', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(req('/api/cron/decision-os-snapshot-capture?leagueId=L1&secret=test-secret'))
    expect(res.status).toBe(401)
  })

  it('accepts a correct bearer token and rejects when no league is specified', async () => {
    const res = await GET(req('/api/cron/decision-os-snapshot-capture', { authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('no_leagues_specified')
  })

  it('dryRun short-circuits before touching the store or the job', async () => {
    const res = await GET(
      req('/api/cron/decision-os-snapshot-capture?leagueId=L1&dryRun=true', { authorization: 'Bearer test-secret' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, dryRun: true, discovered: 1 })
    expect(createDefaultBehavioralSnapshotStoreMock).not.toHaveBeenCalled()
    expect(captureLeagueSnapshotJobMock).not.toHaveBeenCalled()
  })

  it('reports snapshot_store_unavailable honestly instead of pretending to capture anything', async () => {
    createDefaultBehavioralSnapshotStoreMock.mockReturnValue(null)
    const res = await GET(
      req('/api/cron/decision-os-snapshot-capture?leagueId=L1', { authorization: 'Bearer test-secret' }),
    )
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toEqual({ ok: false, error: 'snapshot_store_unavailable' })
    expect(captureLeagueSnapshotJobMock).not.toHaveBeenCalled()
  })

  it('a single ?leagueId= calls the single-league job, not the batch job', async () => {
    captureLeagueSnapshotJobMock.mockResolvedValue({ leagueId: 'L1', ok: true, summary: { created: 2, updated: 0, managerCount: 1 } })
    const res = await GET(
      req('/api/cron/decision-os-snapshot-capture?leagueId=L1', { authorization: 'Bearer test-secret' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, dryRun: false, discovered: 1, processed: 1, failed: 0 })
    expect(captureLeagueSnapshotJobMock).toHaveBeenCalledWith('L1', { store: {} })
    expect(captureLeagueSnapshotsBatchJobMock).not.toHaveBeenCalled()
  })

  it('reports failed:1 honestly when the single-league job fails', async () => {
    captureLeagueSnapshotJobMock.mockResolvedValue({ leagueId: 'L1', ok: false, error: 'boom' })
    const res = await GET(
      req('/api/cron/decision-os-snapshot-capture?leagueId=L1', { authorization: 'Bearer test-secret' }),
    )
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, processed: 0, failed: 1 })
  })

  it('?leagueIds=a,b,c parses an explicit comma-separated batch and calls the batch job', async () => {
    captureLeagueSnapshotsBatchJobMock.mockResolvedValue({
      ok: true,
      results: [
        { leagueId: 'a', ok: true, summary: {} },
        { leagueId: 'b', ok: true, summary: {} },
        { leagueId: 'c', ok: true, summary: {} },
      ],
    })
    const res = await GET(
      req('/api/cron/decision-os-snapshot-capture?leagueIds=a,%20b,c', { authorization: 'Bearer test-secret' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, discovered: 3, processed: 3, failed: 0 })
    expect(captureLeagueSnapshotsBatchJobMock).toHaveBeenCalledWith(['a', 'b', 'c'], { store: {} })
  })

  it('a partially-failing batch reports failed count honestly', async () => {
    captureLeagueSnapshotsBatchJobMock.mockResolvedValue({
      ok: false,
      results: [
        { leagueId: 'a', ok: true, summary: {} },
        { leagueId: 'b', ok: false, error: 'boom' },
      ],
    })
    const res = await GET(
      req('/api/cron/decision-os-snapshot-capture?leagueIds=a,b', { authorization: 'Bearer test-secret' }),
    )
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, discovered: 2, processed: 1, failed: 1 })
  })

  it('allows the non-production ?secret= fallback', async () => {
    const res = await GET(req('/api/cron/decision-os-snapshot-capture?leagueId=L1&dryRun=true&secret=test-secret'))
    expect(res.status).toBe(200)
  })

  it('rejects the ?secret= fallback in production', async () => {
    process.env.NODE_ENV = 'production'
    const res = await GET(req('/api/cron/decision-os-snapshot-capture?leagueId=L1&secret=test-secret'))
    expect(res.status).toBe(401)
  })
})
