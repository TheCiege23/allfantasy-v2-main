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

export type StandingsViewState = {
  view: StandingsViewKey
  division: StandingsDivisionFilter
  layout: StandingsLayout
}

export const STANDINGS_VIEW_PARAMS = {
  view: 'st_view',
  division: 'st_div',
  layout: 'st_layout',
} as const

export const DEFAULT_STANDINGS_VIEW: StandingsViewState = { view: 'official', division: 'all', layout: 'table' }

function first(v: string | string[] | undefined | null): string | null {
  if (Array.isArray(v)) return v[0] ?? null
  return typeof v === 'string' ? v : null
}

export function parseStandingsView(get: (param: string) => string | string[] | undefined | null): StandingsViewState {
  const view = first(get(STANDINGS_VIEW_PARAMS.view))
  const division = first(get(STANDINGS_VIEW_PARAMS.division))?.trim()
  const layout = first(get(STANDINGS_VIEW_PARAMS.layout))
  return {
    view: view === 'power' ? 'power' : 'official',
    division: division && division.length <= 64 ? division : 'all',
    layout: layout === 'cards' ? 'cards' : 'table',
  }
}

/** The params for a state, defaults omitted so a plain URL stays plain. */
export function serializeStandingsView(state: StandingsViewState): Array<[string, string]> {
  const out: Array<[string, string]> = []
  if (state.view !== 'official') out.push([STANDINGS_VIEW_PARAMS.view, state.view])
  if (state.division !== 'all') out.push([STANDINGS_VIEW_PARAMS.division, state.division])
  if (state.layout !== 'table') out.push([STANDINGS_VIEW_PARAMS.layout, state.layout])
  return out
}
