/**
 * `loadAdp` read `allFantasyAdpSnapshot` by EQUALITY on `buildPlayerKey`. Once that key dropped
 * suffixes and punctuation, an equality read would miss every stored row written under the old
 * spelling (`marvin harrison jr.|wr`) until a recompute rewrote it — so the read also takes the
 * legacy spelling and the suffixed variants, then keeps only rows that re-key to this player.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/workers/providers/rolling-insights', () => ({ rollingInsightsProvider: vi.fn() }))

import { loadAdp } from '@/lib/nfl-data-foundation/nflDataFoundationService'

type Stored = { playerKey: string; averageOverallPick: number; lastUpdatedAt: Date }

/** A fake that honours the `where.OR` the reader sends, so a reader that asks for the wrong keys finds nothing. */
function dbWith(rows: Stored[]) {
  return {
    allFantasyAdpSnapshot: {
      findMany: vi.fn(async (args: { where: { OR?: Array<{ playerKey: { in?: string[]; startsWith?: string } }>; playerKey?: string } }) => {
        const w = args.where
        const hit = (k: string) =>
          w.OR
            ? w.OR.some((c) => (c.playerKey.in?.includes(k) ?? false) || (c.playerKey.startsWith != null && k.startsWith(c.playerKey.startsWith)))
            : w.playerKey === k
        return rows.filter((r) => hit(r.playerKey)).sort((a, b) => b.lastUpdatedAt.getTime() - a.lastUpdatedAt.getTime())
      }),
    },
  }
}

const at = (d: string) => new Date(`2026-10-${d}T09:00:00Z`)

describe('loadAdp finds stored rows under any spelling of the player', () => {
  it('a suffixed stored key answers for the SportsPlayer name', async () => {
    const db = dbWith([{ playerKey: 'marvin harrison jr.|wr', averageOverallPick: 7, lastUpdatedAt: at('10') }])
    expect(await loadAdp(db as never, { name: 'Marvin Harrison Jr.', position: 'WR' } as never, 2026)).toBe(7)
    expect(await loadAdp(db as never, { name: 'Marvin Harrison', position: 'WR' } as never, 2026)).toBe(7)
  })

  it('a new normalized key wins when it is the newest row', async () => {
    const db = dbWith([
      { playerKey: 'kenneth walker iii|rb', averageOverallPick: 11, lastUpdatedAt: at('01') },
      { playerKey: 'kenneth walker|rb', averageOverallPick: 12, lastUpdatedAt: at('12') },
    ])
    expect(await loadAdp(db as never, { name: 'Kenneth Walker III', position: 'RB' } as never, 2026)).toBe(12)
  })

  it('does not take a different player whose key merely starts the same', async () => {
    const db = dbWith([{ playerKey: 'james cook smith|rb', averageOverallPick: 3, lastUpdatedAt: at('12') }])
    expect(await loadAdp(db as never, { name: 'James Cook', position: 'RB' } as never, 2026)).toBeNull()
  })
})
