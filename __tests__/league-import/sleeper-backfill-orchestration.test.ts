import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  drafts: vi.fn(),
  seasonState: vi.fn(),
  matchups: vi.fn(),
  transactions: vi.fn(),
  backfill: vi.fn(),
  graph: vi.fn(),
  hallOfFame: vi.fn(),
}))

vi.mock('@/lib/league-import/sleeper/SleeperHistoricalDraftSyncService', () => ({
  syncSleeperHistoricalDraftFactsAfterImport: mocks.drafts,
}))
vi.mock('@/lib/league-import/sleeper/SleeperHistoricalSeasonStateSyncService', () => ({
  syncSleeperHistoricalSeasonStateAfterImport: mocks.seasonState,
}))
vi.mock('@/lib/league-import/sleeper/SleeperHistoricalMatchupSyncService', () => ({
  syncSleeperHistoricalMatchupsAfterImport: mocks.matchups,
}))
vi.mock('@/lib/league-import/sleeper/SleeperHistoricalTransactionSyncService', () => ({
  syncSleeperHistoricalTransactionsAfterImport: mocks.transactions,
}))
vi.mock('@/lib/dynasty-import', () => ({ runDynastyBackfill: mocks.backfill }))
vi.mock('@/lib/league-intelligence-graph', () => ({ buildLeagueGraph: mocks.graph }))
vi.mock('@/lib/rankings-engine/hall-of-fame', () => ({ rebuildHallOfFame: mocks.hallOfFame }))

import { syncSleeperHistoricalBackfillAfterImport } from '@/lib/league-import/sleeper/SleeperHistoricalBackfillService'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('Sleeper historical backfill orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('overlaps independent syncs while protecting shared season metadata', async () => {
    const drafts = deferred<Record<string, never>>()
    const seasonState = deferred<Record<string, never>>()
    const matchups = deferred<Record<string, never>>()
    const transactions = deferred<Record<string, never>>()
    const graph = deferred<{ nodeCount: number; edgeCount: number; snapshotId: string }>()
    const hallOfFame = deferred<{ count: number }>()

    mocks.drafts.mockReturnValue(drafts.promise)
    mocks.seasonState.mockReturnValue(seasonState.promise)
    mocks.matchups.mockReturnValue(matchups.promise)
    mocks.transactions.mockReturnValue(transactions.promise)
    mocks.backfill.mockResolvedValue({
      success: true,
      status: 'complete',
      seasonsDiscovered: 2,
      seasonsImported: 2,
      seasonsSkipped: 0,
      tradesPersisted: 4,
    })
    mocks.graph.mockReturnValue(graph.promise)
    mocks.hallOfFame.mockReturnValue(hallOfFame.promise)

    const resultPromise = syncSleeperHistoricalBackfillAfterImport({
      leagueId: 'league-1',
      isDynasty: true,
    })

    await flushPromises()
    expect(mocks.drafts).toHaveBeenCalledOnce()
    expect(mocks.seasonState).toHaveBeenCalledOnce()
    expect(mocks.transactions).toHaveBeenCalledOnce()
    expect(mocks.matchups).not.toHaveBeenCalled()

    seasonState.resolve({})
    await flushPromises()
    expect(mocks.matchups).toHaveBeenCalledOnce()
    expect(mocks.backfill).not.toHaveBeenCalled()

    drafts.resolve({})
    transactions.resolve({})
    matchups.resolve({})
    await flushPromises()
    expect(mocks.backfill).toHaveBeenCalledOnce()
    expect(mocks.graph).toHaveBeenCalledOnce()
    expect(mocks.hallOfFame).toHaveBeenCalledOnce()

    graph.resolve({ nodeCount: 3, edgeCount: 2, snapshotId: 'snapshot-1' })
    hallOfFame.resolve({ count: 5 })

    await expect(resultPromise).resolves.toMatchObject({
      graph: { refreshed: true, nodeCount: 3, edgeCount: 2, snapshotId: 'snapshot-1' },
      hallOfFame: { refreshed: true, count: 5 },
    })
  })

  it('keeps one derived rebuild failure from blocking the other result', async () => {
    mocks.drafts.mockResolvedValue({})
    mocks.seasonState.mockResolvedValue({})
    mocks.matchups.mockResolvedValue({})
    mocks.transactions.mockResolvedValue({})
    mocks.backfill.mockResolvedValue({
      success: true,
      status: 'complete',
      seasonsDiscovered: 1,
      seasonsImported: 1,
      seasonsSkipped: 0,
      tradesPersisted: 0,
    })
    mocks.graph.mockRejectedValue(new Error('graph unavailable'))
    mocks.hallOfFame.mockResolvedValue({ count: 7 })

    await expect(
      syncSleeperHistoricalBackfillAfterImport({ leagueId: 'league-1', isDynasty: true }),
    ).resolves.toMatchObject({
      graph: { refreshed: false, error: 'graph unavailable' },
      hallOfFame: { refreshed: true, count: 7 },
    })
  })
})
