/**
 * `/core/standings?league=` view state — pure, so the page can parse it on the server and the board can
 * write it back on the client.
 *
 * ⚠ IN THE URL, NOT ONLY IN STATE. A view someone chose (the power table, one division, the card
 * layout) survives a refresh and can be shared, exactly like the Portfolio filters. The board writes it
 * with `history.replaceState`, so switching views never costs a server round trip.
 */

export type StandingsViewKey = 'official' | 'power'
/**
 * `ladder` (2026-10-01) is the default: one tappable row per team, the playoff line drawn through the
 * list, readable on a phone without scrolling sideways. `table` is the dense every-column view and
 * `cards` the labelled-per-team view; both keep their own URL value, so a shared table link still opens
 * as a table.
 */
export type StandingsLayout = 'ladder' | 'table' | 'cards'
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

export const DEFAULT_STANDINGS_VIEW: StandingsViewState = { view: 'official', division: 'all', layout: 'ladder' }

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
    layout: layout === 'cards' || layout === 'table' ? layout : 'ladder',
  }
}

/** The params for a state, defaults omitted so a plain URL stays plain. */
export function serializeStandingsView(state: StandingsViewState): Array<[string, string]> {
  const out: Array<[string, string]> = []
  if (state.view !== 'official') out.push([STANDINGS_VIEW_PARAMS.view, state.view])
  if (state.division !== 'all') out.push([STANDINGS_VIEW_PARAMS.division, state.division])
  if (state.layout !== 'ladder') out.push([STANDINGS_VIEW_PARAMS.layout, state.layout])
  return out
}
