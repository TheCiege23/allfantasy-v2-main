/**
 * `/core/standings?league=` view state — pure, so the page can parse it on the server and the board can
 * write it back on the client.
 *
 * ⚠ IN THE URL, NOT ONLY IN STATE. A view someone chose (the power table, one division, the card
 * layout) survives a refresh and can be shared, exactly like the Portfolio filters. The board writes it
 * with `history.replaceState`, so switching views never costs a server round trip.
 */

export type StandingsViewKey = 'official' | 'power'
export type StandingsLayout = 'table' | 'cards'
/** `all`, `group` (every division, grouped), or one division's key. */
export type StandingsDivisionFilter = string

/**
 * The league table's sortable columns. `seed` is the table's own order, the only one that draws the
 * playoff line — every other key is a lens on the same rows.
 */
export type StandingsSortKey = 'seed' | 'pct' | 'pf' | 'pa' | 'streak' | 'odds' | 'sos' | 'proj'
export type StandingsSortDir = 'asc' | 'desc'
export type StandingsSort = { key: StandingsSortKey; dir: StandingsSortDir }

/**
 * Each column's natural first click: best first. Points against is "most first" (the unlucky), schedule
 * is "hardest first" (rank 1), and the projected seed is "1st first".
 */
export const SORT_DEFAULT_DIR: Record<StandingsSortKey, StandingsSortDir> = {
  seed: 'asc',
  pct: 'desc',
  pf: 'desc',
  pa: 'desc',
  streak: 'desc',
  odds: 'desc',
  sos: 'asc',
  proj: 'asc',
}

const SORT_KEYS = Object.keys(SORT_DEFAULT_DIR) as StandingsSortKey[]

export type StandingsViewState = {
  view: StandingsViewKey
  division: StandingsDivisionFilter
  layout: StandingsLayout
  sort: StandingsSort
}

export const STANDINGS_VIEW_PARAMS = {
  view: 'st_view',
  division: 'st_div',
  layout: 'st_layout',
  sort: 'st_sort',
  dir: 'st_dir',
} as const

export const DEFAULT_STANDINGS_SORT: StandingsSort = { key: 'seed', dir: 'asc' }

export const DEFAULT_STANDINGS_VIEW: StandingsViewState = {
  view: 'official',
  division: 'all',
  layout: 'table',
  sort: DEFAULT_STANDINGS_SORT,
}

function first(v: string | string[] | undefined | null): string | null {
  if (Array.isArray(v)) return v[0] ?? null
  return typeof v === 'string' ? v : null
}

export function parseStandingsView(get: (param: string) => string | string[] | undefined | null): StandingsViewState {
  const view = first(get(STANDINGS_VIEW_PARAMS.view))
  const division = first(get(STANDINGS_VIEW_PARAMS.division))?.trim()
  const layout = first(get(STANDINGS_VIEW_PARAMS.layout))
  const sortKey = first(get(STANDINGS_VIEW_PARAMS.sort))
  const dir = first(get(STANDINGS_VIEW_PARAMS.dir))
  const key = SORT_KEYS.includes(sortKey as StandingsSortKey) ? (sortKey as StandingsSortKey) : 'seed'
  return {
    view: view === 'power' ? 'power' : 'official',
    division: division && division.length <= 64 ? division : 'all',
    layout: layout === 'cards' ? 'cards' : 'table',
    sort: { key, dir: dir === 'asc' || dir === 'desc' ? dir : SORT_DEFAULT_DIR[key] },
  }
}

/** The params for a state, defaults omitted so a plain URL stays plain. */
export function serializeStandingsView(state: StandingsViewState): Array<[string, string]> {
  const out: Array<[string, string]> = []
  if (state.view !== 'official') out.push([STANDINGS_VIEW_PARAMS.view, state.view])
  if (state.division !== 'all') out.push([STANDINGS_VIEW_PARAMS.division, state.division])
  if (state.layout !== 'table') out.push([STANDINGS_VIEW_PARAMS.layout, state.layout])
  if (state.sort.key !== 'seed') out.push([STANDINGS_VIEW_PARAMS.sort, state.sort.key])
  if (state.sort.dir !== SORT_DEFAULT_DIR[state.sort.key]) out.push([STANDINGS_VIEW_PARAMS.dir, state.sort.dir])
  return out
}
