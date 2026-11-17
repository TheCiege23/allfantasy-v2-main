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
  /*
   * How a feed's team string becomes a join key. The default is the NFL fold, and
   * every NFL caller relies on it. College passes the CFBD directory resolver instead
   * (collegeNextGame.ts): `normalizeTeamAbbrev` is NFL-only and folds "Miami" and
   * "Tennessee" onto the Dolphins and the Titans.
   */
  fold: (team: string | null) => string | null = normalizeTeamAbbrev,
): Map<string, NextGameCandidate> {
  const best = new Map<string, NextGameCandidate>()
  for (const g of games) {
    if (!g.startTime) continue
    const home = fold(g.homeTeam)
    const away = fold(g.awayTeam)
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

/** The subset of `SportsGame` the kickoff correction reads. */
export type KickoffRow = {
  homeTeam: string | null
  awayTeam: string | null
  startTime: Date | null
  /** When the provider last wrote this row. A row without one never corrects another. */
  fetchedAt?: Date | null
}

/** How far apart two rows of one pairing may sit and still be the same game. */
const SAME_FIXTURE_MS = 7 * 86_400_000

/**
 * Each row's kickoff, taken from the most recently fetched row for the SAME game. Pure.
 *
 * ⚠ THE SOURCES REFRESH AT DIFFERENT SPEEDS, SO WHEN THE LEAGUE MOVES A GAME THEY DISAGREE FOR
 * DAYS. Rolling Insights and API-Sports schedules are re-imported weekly (Monday 03:00 UTC);
 * TheSportsDB every six hours. Measured on production 2026-11-17, for 2026 week 11, after a
 * flex swap: Rolling Insights and API-Sports still put PIT @ PHI at 4:25 PM ET and JAX @ NYG at
 * 1:00 PM; TheSportsDB, fetched a day and a half later, had them the other way round, and ESPN
 * agreed with TheSportsDB. Matchup and My Team read only the TYPED rows (TheSportsDB leaves
 * `seasonType` null) and took the earliest, so both screens showed the stale time with nothing
 * to say it was stale — and would have until the next weekly import, after the games were played.
 *
 * So each row in `rows` keeps its own identity, opponent, venue and season type — the selection
 * rules callers already rely on are untouched — and only its KICKOFF is replaced by the newest
 * fetched row in `rows` or `correctors` for the same pairing within a week of it. `correctors`
 * is where the untyped rows go: they may correct a kickoff, never introduce a game, which keeps
 * an untyped preseason row out (the August-lock failure `nflRegularSlate` records).
 *
 * The pairing is order-insensitive, in case one source files a game home/away the other way.
 *
 * Not for lineup LOCKING. `lib/redraft/lineupLock.ts` deliberately locks at each team's EARLIEST
 * kickoff from any source, which is safe when sources disagree: early, never late. This is for
 * showing people when the game is.
 */
export function withNewestKickoffs<T extends KickoffRow>(
  rows: readonly T[],
  correctors: readonly KickoffRow[] = [],
  fold: (team: string | null) => string | null = normalizeTeamAbbrev,
): T[] {
  const pairOf = (r: KickoffRow): string | null => {
    const a = fold(r.homeTeam)
    const b = fold(r.awayTeam)
    return a && b ? [a, b].sort().join('|') : null
  }
  const byPair = new Map<string, KickoffRow[]>()
  for (const r of [...rows, ...correctors]) {
    const key = r.startTime && r.fetchedAt ? pairOf(r) : null
    if (key) byPair.set(key, [...(byPair.get(key) ?? []), r])
  }
  return rows.map((row) => {
    const key = row.startTime ? pairOf(row) : null
    if (!key || !row.startTime) return row
    const at = row.startTime.getTime()
    let newest: KickoffRow | null = null
    for (const other of byPair.get(key) ?? []) {
      if (Math.abs(other.startTime!.getTime() - at) > SAME_FIXTURE_MS) continue
      if (!newest || other.fetchedAt!.getTime() > newest.fetchedAt!.getTime()) newest = other
    }
    if (!newest || newest.startTime!.getTime() === at) return row
    // A row fetched no earlier than the newest one is already the best word on this game.
    if (row.fetchedAt && row.fetchedAt.getTime() >= newest.fetchedAt!.getTime()) return row
    return { ...row, startTime: newest.startTime }
  })
}
