import { describe, expect, it, vi } from 'vitest'
import { refreshHistoricalDerivedData } from '@/lib/league-import/refreshHistoricalDerivedData'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('refreshHistoricalDerivedData', () => {
  it('starts graph and Hall of Fame rebuilds together and returns both results', async () => {
    const graph = deferred<{ nodeCount: number; edgeCount: number; snapshotId: string }>()
    const hallOfFame = deferred<{ count: number }>()
    const buildGraph = vi.fn(() => graph.promise)
    const rebuild = vi.fn(() => hallOfFame.promise)

    const refresh = refreshHistoricalDerivedData(
      { leagueId: 'league-1' },
      {
        buildGraph: buildGraph as never,
        rebuildHallOfFame: rebuild as never,
      },
    )

    expect(buildGraph).toHaveBeenCalledOnce()
    expect(rebuild).toHaveBeenCalledOnce()

    hallOfFame.resolve({ count: 12 })
    graph.resolve({ nodeCount: 10, edgeCount: 20, snapshotId: 'snapshot-1' })

    await expect(refresh).resolves.toEqual({
      graph: {
        refreshed: true,
        nodeCount: 10,
        edgeCount: 20,
        snapshotId: 'snapshot-1',
      },
      hallOfFame: {
        refreshed: true,
        count: 12,
      },
    })
  })

  it('keeps either result when the other rebuild fails', async () => {
    const buildGraph = vi.fn().mockRejectedValue(new Error('graph unavailable'))
    const rebuild = vi.fn().mockResolvedValue({ count: 7 })

    await expect(refreshHistoricalDerivedData(
      { leagueId: 'league-2' },
      {
        buildGraph: buildGraph as never,
        rebuildHallOfFame: rebuild as never,
      },
    )).resolves.toEqual({
      graph: {
        refreshed: false,
        error: 'graph unavailable',
      },
      hallOfFame: {
        refreshed: true,
        count: 7,
      },
    })
  })
})
