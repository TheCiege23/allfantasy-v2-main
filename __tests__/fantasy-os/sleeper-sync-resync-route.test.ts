/**
 * #G1 — ROUTE-level tests for POST /api/leagues/import/resync. Proves the durable Sleeper refresh
 * outcome is mapped to an honest HTTP status (never a non-completed refresh reported as success),
 * the refresh result is included (not dropped), no second provider fetch is triggered by the route,
 * non-Sleeper behavior is unchanged, and the response leaks no payload/credentials/lock token.
 * Fully mocked at the module boundary — no DB, no live provider.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  requireVerifiedUser: vi.fn(),
  resolveProvider: vi.fn(),
  isImportProviderAvailable: vi.fn(),
  resyncImportedLeague: vi.fn(),
}))

vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: h.requireVerifiedUser }))
vi.mock('@/lib/league-import/ImportProviderResolver', () => ({ resolveProvider: h.resolveProvider }))
vi.mock('@/lib/league-import/provider-ui-config', () => ({ isImportProviderAvailable: h.isImportProviderAvailable }))
vi.mock('@/lib/league-import/resyncImportUtility', () => ({ resyncImportedLeague: h.resyncImportedLeague }))

import { POST } from '@/app/api/leagues/import/resync/route'

const BASE = { leagueId: 'L1', runId: 'R1', warningCount: 0, reviewRequired: false }

async function call(body: unknown): Promise<{ status: number; json: any }> {
  const req = { json: async () => body } as unknown as NextRequest
  const res = await POST(req)
  return { status: res.status, json: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireVerifiedUser.mockResolvedValue({ ok: true, userId: 'U1' })
  h.resolveProvider.mockImplementation((p: string) => p)
  h.isImportProviderAvailable.mockReturnValue(true)
})

describe('POST /api/leagues/import/resync — honest durable refresh outcome', () => {
  it('completed Sleeper refresh → 200 ok:true, includes the refresh result, one invocation', async () => {
    h.resyncImportedLeague.mockResolvedValue({ ok: true, ...BASE, refresh: { kind: 'sync', status: 'completed', advancedFreshness: true, executed: true } })
    const { status, json } = await call({ provider: 'sleeper', sourceId: '111' })
    expect(status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.refresh).toMatchObject({ status: 'completed', advancedFreshness: true, executed: true })
    expect(h.resyncImportedLeague).toHaveBeenCalledTimes(1) // route triggers no second provider fetch
  })

  it('failed Sleeper refresh → 503 ok:false, data preserved, refresh included', async () => {
    h.resyncImportedLeague.mockResolvedValue({ ok: true, ...BASE, refresh: { kind: 'sync', status: 'failed', advancedFreshness: false, executed: true } })
    const { status, json } = await call({ provider: 'sleeper', sourceId: '111' })
    expect(status).toBe(503)
    expect(json.ok).toBe(false)
    expect(json.refresh.status).toBe('failed')
    expect(String(json.error)).toMatch(/preserved/i)
  })

  it('partial Sleeper refresh → 503 ok:false', async () => {
    h.resyncImportedLeague.mockResolvedValue({ ok: true, ...BASE, refresh: { kind: 'sync', status: 'partial', advancedFreshness: false, executed: true } })
    const { status, json } = await call({ provider: 'sleeper', sourceId: '111' })
    expect(status).toBe(503)
    expect(json.ok).toBe(false)
    expect(json.refresh.status).toBe('partial')
  })

  it('locked Sleeper refresh → 409 ok:false with a retry message', async () => {
    h.resyncImportedLeague.mockResolvedValue({ ok: true, ...BASE, refresh: { kind: 'sync', status: 'locked', advancedFreshness: false, executed: false } })
    const { status, json } = await call({ provider: 'sleeper', sourceId: '111' })
    expect(status).toBe(409)
    expect(json.ok).toBe(false)
    expect(String(json.error)).toMatch(/already being refreshed/i)
  })

  it('completed-but-not-advanced / unknown durable outcome → fails closed 503 ok:false', async () => {
    h.resyncImportedLeague.mockResolvedValue({ ok: true, ...BASE, refresh: { kind: 'sync', status: 'completed', advancedFreshness: false, executed: true } })
    const { status, json } = await call({ provider: 'sleeper', sourceId: '111' })
    expect(status).toBe(503)
    expect(json.ok).toBe(false)
  })

  it('pre-run authorization failure keeps its 4xx (403 ok:false)', async () => {
    h.resyncImportedLeague.mockResolvedValue({ ok: true, ...BASE, refresh: { kind: 'auth', httpStatus: 403, error: 'You do not have access to this league' } })
    const { status, json } = await call({ provider: 'sleeper', sourceId: '111' })
    expect(status).toBe(403)
    expect(json.ok).toBe(false)
  })

  it('non-Sleeper provider (refresh null) → 200 ok:true, behavior unchanged', async () => {
    h.resyncImportedLeague.mockResolvedValue({ ok: true, ...BASE, refresh: null })
    const { status, json } = await call({ provider: 'espn', sourceId: '999' })
    expect(status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it('resync utility failure → 400 ok:false', async () => {
    h.resyncImportedLeague.mockResolvedValue({ ok: false, error: 'League not found. Please check your League ID.' })
    const { status, json } = await call({ provider: 'sleeper', sourceId: 'bad' })
    expect(status).toBe(400)
    expect(json.ok).toBe(false)
  })

  it('missing provider/sourceId → 400', async () => {
    const { status } = await call({ provider: '', sourceId: '' })
    expect(status).toBe(400)
    expect(h.resyncImportedLeague).not.toHaveBeenCalled()
  })

  it('unauthenticated → the auth response (401)', async () => {
    const { NextResponse } = await import('next/server')
    h.requireVerifiedUser.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'unauth' }, { status: 401 }) })
    const { status } = await call({ provider: 'sleeper', sourceId: '111' })
    expect(status).toBe(401)
  })

  it('response never contains provider payload / credentials / lock token', async () => {
    h.resyncImportedLeague.mockResolvedValue({ ok: true, ...BASE, refresh: { kind: 'sync', status: 'completed', advancedFreshness: true, executed: true } })
    const { json } = await call({ provider: 'sleeper', sourceId: '111' })
    expect(JSON.stringify(json)).not.toMatch(/token|password|normalized|playerData|source_manager_id|fos-sync/i)
  })
})
