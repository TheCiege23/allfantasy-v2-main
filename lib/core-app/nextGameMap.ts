import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { isPreseason } from './sportsWeek'

/**
 * The fixture a club plays in one week, chosen from up to four provider rows.
 */
export type NextGameCandidate = {
  opponent: string
  home: boolean
  at: Date
  preseason: boolean
  venue: string | null
  /** Whether the provider row that produced this knew its season type. */
  typed: boolean
}

/** The subset of `SportsGame` this reads, so any `select` satisfies it. */
export type FixtureRow = {
  homeTeam: string | null
  awayTeam: string | null
  startTime: Date | null
  seasonType: string | null
  venue: string | null
}

/**
 * Is `next` a better row for this club than what we already have?
 *
 * ⚠ THE SAME FIXTURE ARRIVES UP TO FOUR TIMES, ONE PER PROVIDER, AND THEY DO
 * NOT AGREE. The unique key includes `source`, and `seasonType` is populated on
 * the Rolling Insights and ESPN rows but null on TheSportsDB's row for the same
 * game — deliberately, because that provider does not carry the field. Whichever
 * row happened to sort first would otherwise decide at random whether a game
 * could be labelled preseason at all.
 *
 * Earlier kickoff wins, because that is the one that locks the lineup. On a tie
 * — which is what duplicate rows for one fixture look like — the row that knows
 * its season type wins.
 */
function better(next: NextGameCandidate, current: NextGameCandidate | undefined): boolean {
  if (!current) return true
  if (next.at.getTime() !== current.at.getTime()) return next.at < current.at
  if (next.typed !== current.typed) return next.typed
  // Same kickoff, same knowledge: prefer the row that carries a venue.
  return current.venue == null && next.venue != null
}

/**
 * This week's fixture per club, keyed on the FOLDED abbreviation.
 *
 * ⚠ ONE VOCABULARY ON BOTH SIDES OF THE JOIN, WHICH IS THE WHOLE POINT. This
 * lived inside `getMyTeamData` as a `Map<folded, rawSpelling>` used to translate
 * back to whatever string a `SportsPlayer` row happened to store — and
 * `Map.set` resolves a duplicate key to the LAST pair. So when one player
 * carried both "SF" and "San Francisco 49ers", the map ended up keyed on
 * exactly one of them and a lookup with the other returned nothing: no
 * opponent, no kickoff, no venue and no lineup lock for that starter, with
 * nothing on screen to say why. It reads as thin schedule coverage, which is
 * how it survived — two of seven visible starters on a real roster, written off
 * as missing data.
 *
 * Measured on production 2026-08-30: 1,172 of 11,960 NFL sleeperIds carry more
 * than one spelling of their club, so this was never an edge case.
 *
 * Callers must therefore pass FOLDED club tokens in `rosterTeams` and look up
 * with folded tokens too — which is what `composePlayerIdentities` produces.
 *
 * `rosterTeams` is a filter, not a lookup: a club nobody on the roster plays
 * for is skipped rather than stored.
 */
export function buildNextGameMap(
  games: readonly FixtureRow[],
  rosterTeams: ReadonlySet<string>,
): Map<string, NextGameCandidate> {
  const best = new Map<string, NextGameCandidate>()
  for (const g of games) {
    if (!g.startTime) continue
    const home = normalizeTeamAbbrev(g.homeTeam)
    const away = normalizeTeamAbbrev(g.awayTeam)
    for (const [team, opponent, isHome] of [
      [home, away, true],
      [away, home, false],
    ] as const) {
      if (!team || !opponent) continue
      if (!rosterTeams.has(team)) continue

      const candidate: NextGameCandidate = {
        opponent,
        home: isHome,
        at: g.startTime,
        preseason: isPreseason(g.seasonType),
        venue: g.venue ?? null,
        typed: g.seasonType != null,
      }
      if (better(candidate, best.get(team))) best.set(team, candidate)
    }
  }
  return best
}
