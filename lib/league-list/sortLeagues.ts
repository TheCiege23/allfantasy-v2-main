export const LEAGUE_SORT_STORAGE_KEY = 'af-league-sort-mode'

export type LeagueSortMode =
  | 'default'
  | 'sport-name'
  | 'sport-type'
  | 'name-asc'
  | 'name-desc'
  | 'type-name'
  | 'wins'
  | 'win-pct'
  | 'playoff-odds'

export const LEAGUE_SORT_OPTIONS: Array<{ value: LeagueSortMode; label: string }> = [
  { value: 'default', label: 'Default' },
  { value: 'sport-name', label: 'Sport, then name' },
  { value: 'sport-type', label: 'Sport, then type' },
  { value: 'name-asc', label: 'League name A–Z' },
  { value: 'name-desc', label: 'League name Z–A' },
  { value: 'type-name', label: 'League type, then name' },
  { value: 'wins', label: 'Most wins' },
  { value: 'win-pct', label: 'Highest win percentage' },
  { value: 'playoff-odds', label: 'Best playoff opportunity' },
]

type SortableLeague = {
  name: string
  sport?: string | null
  leagueType?: string | null
  isDynasty?: boolean | null
  viewerWins?: number | null
  viewerLosses?: number | null
  viewerTies?: number | null
  viewerPlayoffOdds?: number | null
}

export function isLeagueSortMode(value: string | null): value is LeagueSortMode {
  return LEAGUE_SORT_OPTIONS.some((option) => option.value === value)
}

function nameOf(league: SortableLeague): string {
  return league.name.trim()
}

function typeOf(league: SortableLeague): string {
  return (league.leagueType?.trim() || (league.isDynasty ? 'dynasty' : 'other')).toLowerCase()
}

function winPercentage(league: SortableLeague): number | null {
  const wins = league.viewerWins
  const losses = league.viewerLosses
  const ties = league.viewerTies ?? 0
  if (wins == null || losses == null) return null
  const games = wins + losses + ties
  return games > 0 ? (wins + ties / 2) / games : null
}

function metric(league: SortableLeague, mode: LeagueSortMode): number | null {
  if (mode === 'wins') return league.viewerWins ?? null
  if (mode === 'win-pct') return winPercentage(league)
  if (mode === 'playoff-odds') return league.viewerPlayoffOdds ?? null
  return null
}

export function hasLeagueSortMetric(leagues: SortableLeague[], mode: LeagueSortMode): boolean {
  if (mode !== 'wins' && mode !== 'win-pct' && mode !== 'playoff-odds') return true
  return leagues.some((league) => metric(league, mode) !== null)
}

export function sortLeagues<T extends SortableLeague>(leagues: T[], mode: LeagueSortMode): T[] {
  if (mode === 'default') return [...leagues]
  const compare = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true })
  return [...leagues].sort((a, b) => {
    if (mode === 'sport-name' || mode === 'sport-type') {
      const sport = compare(a.sport?.trim() || 'Other', b.sport?.trim() || 'Other')
      if (sport) return sport
      if (mode === 'sport-type') {
        const type = compare(typeOf(a), typeOf(b))
        if (type) return type
      }
    } else if (mode === 'type-name') {
      const type = compare(typeOf(a), typeOf(b))
      if (type) return type
    } else if (mode === 'name-desc') {
      return compare(nameOf(b), nameOf(a))
    } else if (mode === 'wins' || mode === 'win-pct' || mode === 'playoff-odds') {
      const left = metric(a, mode)
      const right = metric(b, mode)
      if (left === null && right !== null) return 1
      if (right === null && left !== null) return -1
      if (left !== null && right !== null && left !== right) return right - left
    }
    return compare(nameOf(a), nameOf(b))
  })
}
