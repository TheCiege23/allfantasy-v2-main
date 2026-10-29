/**
 * Client-safe AF ADP helpers for the mock draft room (no server imports, unlike mockPoolAfAdp.ts).
 */

export type MockPoolSort = 'adp' | 'afAdp'

/**
 * Sort by AF ADP, earliest first. A player with no AF ADP goes last rather than borrowing market
 * ADP — the same rule as the live room's AF ADP column (SleeperPoolSort), so the two rooms agree.
 * Stable: ties keep the incoming (market ADP) order.
 */
export function sortByAfAdp<T extends { afAdp?: number | null }>(players: readonly T[]): T[] {
  return players
    .map((player, index) => ({ player, index }))
    .sort((a, b) => {
      const av = a.player.afAdp
      const bv = b.player.afAdp
      const aHas = typeof av === 'number' && Number.isFinite(av)
      const bHas = typeof bv === 'number' && Number.isFinite(bv)
      if (aHas && bHas && av !== bv) return (av as number) - (bv as number)
      if (aHas !== bHas) return aHas ? -1 : 1
      return a.index - b.index
    })
    .map(({ player }) => player)
}

/** The blend's shares from an untyped pool row; null unless all three are finite numbers. */
export function parseAfAdpContributions(raw: unknown): { market: number; imported: number; af: number } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const market = Number(r.market)
  const imported = Number(r.imported)
  const af = Number(r.af)
  return [market, imported, af].every(Number.isFinite) ? { market, imported, af } : null
}
