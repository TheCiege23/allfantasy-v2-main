/**
 * The Players screen's tabs, in Sleeper's order (owner ask, 2026-11-22: "Search / Trend / Available /
 * Leaders / Trade" across the top), followed by the two of ours Sleeper has no tab for.
 */
export type PlayersTab = 'search' | 'trending' | 'available' | 'leaders' | 'trade' | 'watchlist' | 'claims'

export const PLAYERS_TABS: ReadonlyArray<{ id: PlayersTab; label: string }> = [
  { id: 'search', label: 'Search' },
  { id: 'trending', label: 'Trend' },
  { id: 'available', label: 'Available' },
  { id: 'leaders', label: 'Leaders' },
  { id: 'trade', label: 'Trade' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'claims', label: 'My claims' },
]

/** Tabs that list rostered players as well as free agents, so they read the league-wide list. */
export function tabUsesLeagueScope(tab: PlayersTab): boolean {
  return tab === 'search' || tab === 'leaders' || tab === 'trade'
}

export type TabRow = {
  id: string
  name: string
  team?: string | null
  projectedPoints?: number | null
  lastWeekPoints?: number | null
  rosteredBy?: { mine: boolean; team: string | null } | null
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * The rows a league-scope tab shows, in order.
 *
 *  - Search: nobody until a name is typed, then every match in the league, rostered or not.
 *  - Leaders: everyone, by last week's points where the league has them, else by projection. A
 *    player with no figure goes after every player who has one.
 *  - Trade: players on OTHER teams, by projection.
 */
export function leagueScopeRows<T extends TabRow>(tab: PlayersTab, rows: readonly T[], needle: string, hasLastWeek: boolean): T[] {
  const text = needle.trim().toLowerCase()
  const matches = (p: T) => p.name.toLowerCase().includes(text) || String(p.team ?? '').toLowerCase().includes(text)
  const by = (key: (p: T) => number | null) => (a: T, b: T) => (key(b) ?? -Infinity) - (key(a) ?? -Infinity)
  if (tab === 'search') return text ? rows.filter(matches) : []
  const named = text ? rows.filter(matches) : [...rows]
  if (tab === 'trade') {
    return named.filter((p) => p.rosteredBy != null && !p.rosteredBy.mine).sort(by((p) => num(p.projectedPoints)))
  }
  return named.sort(by((p) => (hasLastWeek ? num(p.lastWeekPoints) : num(p.projectedPoints))))
}

/** "On Team Name", "On your team", "Rostered", or null for a free agent. */
export function rosteredByLabel(by: { mine: boolean; team: string | null } | null | undefined): string | null {
  if (!by) return null
  if (by.mine) return 'On your team'
  return by.team ? `On ${by.team}` : 'Rostered'
}
