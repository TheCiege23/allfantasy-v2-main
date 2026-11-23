import type { ImportedGuillyViewData } from './importedGuillyView'

/**
 * What the League home's Chopping block card says for one viewer of an IMPORTED Guilly league
 * (components/league/ImportedGuillyChopCard.tsx, 2026-11-09). Built only from the Guilly tab's own view
 * (lib/guillotine/importedGuillyView.ts) — the provider's weekly scores — so the card and the tab can
 * never disagree. Pure, so every branch is testable without a database.
 *
 * `state`:
 *   not_started — no alive team has scored this week, so there is no chop line yet
 *   chop_zone   — the viewer holds this week's lowest score among the teams alive (ties included)
 *   danger      — within the danger margin of the line
 *   safe        — clear of it
 *   chopped     — the viewer's team is already out
 *   unknown     — the viewer's team is not in the view (no claimed team, or an id the view lacks)
 */
export type ChopCardState = 'not_started' | 'chop_zone' | 'danger' | 'safe' | 'chopped' | 'unknown'

export type ChopCardSummary = {
  state: ChopCardState
  week: number | null
  /** The viewer's points this week; null unless the viewer is alive and the week has scores. */
  yourPoints: number | null
  /** Everyone on this week's chop line and the score that puts them there; null before any score. */
  lowest: { names: string[]; points: number } | null
  teamsAlive: number
  /** Every team the league started with: the alive field plus everyone chopped. */
  teamsTotal: number
  /** The week the viewer was chopped, when `state` is `chopped`. */
  choppedWeek: number | null
}

export function chopCardSummary(view: ImportedGuillyViewData, yourRosterId: string | null | undefined): ChopCardSummary {
  const teamsTotal = view.teamsAlive + view.chopped.length
  const started = view.scoredThisWeek > 0
  const onLine = started ? view.standings.filter((t) => t.onChopLine) : []
  const lowest = onLine.length ? { names: onLine.map((t) => t.name), points: onLine[0].points } : null
  const base = { week: view.week, lowest, teamsAlive: view.teamsAlive, teamsTotal }

  const id = yourRosterId == null ? null : String(yourRosterId)
  const out = id ? view.chopped.find((c) => c.rosterId === id) : undefined
  if (out) return { ...base, state: 'chopped', yourPoints: null, choppedWeek: out.week }

  const mine = id ? view.standings.find((t) => t.rosterId === id) : undefined
  if (!mine) return { ...base, state: started ? 'unknown' : 'not_started', yourPoints: null, choppedWeek: null }
  if (!started || mine.tier == null) return { ...base, state: 'not_started', yourPoints: null, choppedWeek: null }
  return { ...base, state: mine.tier, yourPoints: mine.points, choppedWeek: null }
}
