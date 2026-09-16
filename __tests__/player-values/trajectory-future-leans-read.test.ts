/**
 * `loadFutureLeans` now asks for its two books by name instead of reading every format's history.
 * The pairing it exists for — dynasty vs redraft, same QB format — must survive the split.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadLatest = vi.fn()
vi.mock('@/lib/player-values/latestPlayerValueSnapshots', () => ({
  loadLatestPlayerValueSnapshots: (...args: unknown[]) => loadLatest(...args),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { loadFutureLeans } from '@/lib/trade-intel/trajectory'

const row = (sleeperId: string, format: string, value: number) => ({
  sleeperId,
  format,
  value,
  name: `Player ${sleeperId}`,
})

describe('loadFutureLeans', () => {
  beforeEach(() => {
    loadLatest.mockReset()
  })

  it('reads the dynasty and redraft books for the requested QB format, and pairs them', async () => {
    loadLatest.mockImplementation(async (args: { format: string }) =>
      args.format === 'DYNASTY'
        ? [row('a', 'DYNASTY', 6000), row('b', 'DYNASTY', 3000)]
        : [row('a', 'REDRAFT', 4000), row('b', 'REDRAFT', 3100)],
    )

    const out = await loadFutureLeans({ sleeperIds: ['a', 'b'], qbFormat: 'SUPERFLEX' })

    const asked = loadLatest.mock.calls.map((c) => c[0] as { format: string; qbFormat: string; source: string })
    expect(asked.map((a) => a.format).sort()).toEqual(['DYNASTY', 'REDRAFT'])
    expect(asked.every((a) => a.qbFormat === 'SUPERFLEX' && a.source === 'FANTASYCALC')).toBe(true)

    expect(out.get('a')).toMatchObject({ dynastyValue: 6000, redraftValue: 4000, direction: 'rising' })
    // 3000 / 3100 sits inside the flat band — reported as flat, not dropped.
    expect(out.get('b')?.direction).toBe('flat')
  })

  it('reports nothing for a player missing from either book', async () => {
    loadLatest.mockImplementation(async (args: { format: string }) =>
      args.format === 'DYNASTY' ? [row('a', 'DYNASTY', 6000)] : [],
    )
    const out = await loadFutureLeans({ sleeperIds: ['a'], qbFormat: 'ONE_QB' })
    expect(out.size).toBe(0)
  })

  it('keeps the other book when one read fails', async () => {
    loadLatest.mockImplementation(async (args: { format: string }) => {
      if (args.format === 'REDRAFT') throw new Error('timeout')
      return [row('a', 'DYNASTY', 6000)]
    })
    await expect(loadFutureLeans({ sleeperIds: ['a'], qbFormat: 'ONE_QB' })).resolves.toEqual(new Map())
    expect(loadLatest).toHaveBeenCalledTimes(2)
  })
})
