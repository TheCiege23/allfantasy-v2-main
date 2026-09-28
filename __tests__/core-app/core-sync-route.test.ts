/**
 * POST /api/core/sync — the per-league outcome must never call a league `synced` when nothing ran.
 *
 * 🛑 THE FALLBACK (`mode: 'full'`) MAPPED `refresh === null` TO `synced`. `resyncImportedLeague`
 * returns a null refresh when it persisted no league id to hand the durable collector, i.e. no
 * refresh happened at all — and the /core "Sync now" button counted it as a success.
 *
 * Fully mocked at the module boundary: no DB, no provider.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  requireVerifiedUser: vi.fn(),
  collectResyncCandidates: vi.fn(),
  manualRefreshConnectedSleeperLeague: vi.fn(),
  resyncImportedLeague: vi.fn(),
}))

vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: h.requireVerifiedUser }))
vi.mock('@/lib/core-app/resyncableLeagues', () => ({ collectResyncCandidates: h.collectResyncCandidates }))
vi.mock('@/lib/import-os/collector', () => ({
  manualRefreshConnectedSleeperLeague: h.manualRefreshConnectedSleeperLeague,
}))
vi.mock('@/lib/league-import/resyncImportUtility', () => ({ resyncImportedLeague: h.resyncImportedLeague }))

import { POST } from '@/app/api/core/sync/route'

/** A legacy dashboard row with no native League id, so the route takes the `full` fallback. */
function legacyCandidate(key = 'espn:999') {
  const [provider, sourceId] = key.split(':')
  return { key, provider, sourceId, row: { id: 'row-1', name: 'Legacy League', navigationLeagueId: null } }
}

async function call(body: unknown = {}) {
  const req = { json: async () => body } as unknown as NextRequest
  const res = await POST(req)
  return { status: res.status, json: (await res.json()) as any }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireVerifiedUser.mockResolvedValue({ ok: true, userId: 'U1' })
  h.collectResyncCandidates.mockResolvedValue([legacyCandidate()])
})

describe('POST /api/core/sync — full-reread fallback outcome', () => {
  it('refresh null → the league is reported NOT synced, with a reason', async () => {
    h.resyncImportedLeague.mockResolvedValue({
      ok: true,
      leagueId: '',
      runId: 'R1',
      warningCount: 0,
      reviewRequired: false,
      refresh: null,
    })
    const { status, json } = await call()
    expect(status).toBe(200)
    expect(json.synced).toBe(0)
    expect(json.failed).toBe(1)
    expect(json.results[0]).toMatchObject({ key: 'espn:999', mode: 'full', status: 'failed' })
    expect(String(json.results[0].error)).toMatch(/nothing was synced/i)
  })

  it('a completed refresh is still reported synced', async () => {
    h.resyncImportedLeague.mockResolvedValue({
      ok: true,
      leagueId: 'L1',
      runId: 'R1',
      warningCount: 0,
      reviewRequired: false,
      refresh: { kind: 'sync', status: 'completed', advancedFreshness: true, executed: true },
    })
    const { json } = await call()
    expect(json.synced).toBe(1)
    expect(json.results[0]).toMatchObject({ mode: 'full', status: 'synced' })
  })

  it('the incremental path does not reach the fallback', async () => {
    h.collectResyncCandidates.mockResolvedValue([
      { key: 'sleeper:1', provider: 'sleeper', sourceId: '1', row: { id: 'r', name: 'N', navigationLeagueId: 'L9' } },
    ])
    h.manualRefreshConnectedSleeperLeague.mockResolvedValue({
      ok: true,
      sync: { status: 'completed', executed: true, advancedFreshness: true },
    })
    const { json } = await call()
    expect(json.results[0]).toMatchObject({ mode: 'incremental', status: 'synced' })
    expect(h.resyncImportedLeague).not.toHaveBeenCalled()
  })
})
