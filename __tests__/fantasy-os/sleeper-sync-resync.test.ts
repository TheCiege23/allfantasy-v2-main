/**
 * #F2 — the authenticated resync route utility drives the SAME durable collector as cron, over the
 * payload it already fetched (no second provider call), and surfaces the outcome honestly.
 * Fully mocked (no DB, no live provider) — proves delegation + single-fetch + honest failure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const NORMALIZED = { __fixture: true, source: { source_league_id: '111' }, league: { season: 2025 } } as unknown

const h = vi.hoisted(() => ({
  pipeline: vi.fn(),
  buildBundle: vi.fn(),
  persist: vi.fn(),
  manualRefresh: vi.fn(),
}))

vi.mock('@/lib/league-import/ImportedLeagueNormalizationPipeline', () => ({
  runImportedLeagueNormalizationPipeline: h.pipeline,
}))
vi.mock('@/lib/league-import/canonicalImportNormalizer', () => ({ buildCanonicalImportBundle: h.buildBundle }))
vi.mock('@/lib/league-import/importPersistenceService', () => ({ persistImportWithCanonicalAudit: h.persist }))
vi.mock('@/lib/fantasy-os/sync/collector', () => ({ manualRefreshConnectedSleeperLeague: h.manualRefresh }))

import { resyncImportedLeague } from '@/lib/league-import/resyncImportUtility'

beforeEach(() => {
  vi.clearAllMocks()
  h.pipeline.mockResolvedValue({ success: true, normalized: NORMALIZED })
  h.buildBundle.mockReturnValue({ warnings: [], reviewRequired: false, reviewReasons: [] })
  h.persist.mockResolvedValue({ persisted: { league: { id: 'L1', name: 'X', sport: 'NFL' } }, runId: 'R1' })
  h.manualRefresh.mockResolvedValue({ ok: true, leagueId: 'L1', sync: { status: 'completed', advancedFreshness: true, executed: true } })
})

describe('resyncImportedLeague routes Sleeper through the durable collector', () => {
  it('delegates to the durable manual refresh and performs NO second provider fetch', async () => {
    const res = await resyncImportedLeague({ userId: 'U1', provider: 'sleeper', sourceId: '111' })
    expect(res.ok).toBe(true)
    expect(h.pipeline).toHaveBeenCalledTimes(1) // exactly one live normalize
    expect(h.manualRefresh).toHaveBeenCalledTimes(1)

    const arg = h.manualRefresh.mock.calls[0][0]
    expect(arg.userId).toBe('U1')
    expect(arg.leagueId).toBe('L1') // same League.id from persistence
    // the injected loader returns the already-fetched payload — the durable path never re-fetches
    await expect(arg.fetchNormalized('111')).resolves.toBe(NORMALIZED)
    expect(h.pipeline).toHaveBeenCalledTimes(1)

    if (res.ok) expect(res.refresh).toMatchObject({ kind: 'sync', status: 'completed', advancedFreshness: true, executed: true })
  })

  it('surfaces a durable-run status honestly (kind:sync, never swallowed)', async () => {
    h.manualRefresh.mockResolvedValue({ ok: true, leagueId: 'L1', sync: { status: 'failed', advancedFreshness: false, executed: true } })
    const res = await resyncImportedLeague({ userId: 'U1', provider: 'sleeper', sourceId: '111' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.refresh).toMatchObject({ kind: 'sync', status: 'failed', advancedFreshness: false })
  })

  it('surfaces a pre-run authorization failure as kind:auth with its HTTP status', async () => {
    h.manualRefresh.mockResolvedValue({ ok: false, status: 403, error: 'no access' })
    const res = await resyncImportedLeague({ userId: 'U1', provider: 'sleeper', sourceId: '111' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.refresh).toMatchObject({ kind: 'auth', httpStatus: 403, error: 'no access' })
  })
})
