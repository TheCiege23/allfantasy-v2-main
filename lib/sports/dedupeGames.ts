/**
 * Collapse provider duplicates in `SportsGame` down to one row per real fixture.
 *
 * WHY THIS IS A SHARED MODULE AND NOT A LOCAL HELPER
 * `SportsGame` is unique on `(sport, externalId, source)`, so every provider writing the same
 * fixture gets its OWN row — by design, because the id spaces differ and provenance matters.
 * The consequence is that a read which does not collapse them counts one game several times.
 *
 * Measured on production 2026-08-30, NFL season 2026 week 1:
 *
 *     64 rows  →  32 distinct matchups  →  16 real games
 *
 * Houston Texans vs Buffalo Bills existed three times over — espn `401872660`,
 * rolling_insights `20260913-1-25`, thesportsdb `2475383` — all with the identical
 * `startTime` of 2026-09-13T21:00:00Z. (The other 16 "matchups" were August preseason games
 * mislabelled `week 1` by Rolling Insights, which is a separate defect in the ingest.)
 *
 * ⚠ THE LOGIC HERE IS NOT NEW. It was written and proven inside
 * `lib/chimmy/liveSlateGrounding.ts`, which learned the hard way that "421 rolling_insights +
 * 324 thesportsdb + 32 espn + 16 espn_live for NFL 2026" joined without collapsing counts one
 * game four times and lets two sources disagree about whether it is over. This module is that
 * function lifted to a shared home, unchanged in behaviour, because 45 modules read `SportsGame`
 * and exactly one of them had the fix.
 *
 * ⚠ NFL ONLY, AND IT SAYS SO RATHER THAN PRETENDING. `nflFixtureKey` resolves through
 * `resolveNflTeamRef` and returns null for anything it cannot identify, so rows for other sports
 * cannot be keyed and are passed through UNCHANGED rather than dropped. Silently discarding an
 * NCAAF slate because the NFL resolver did not recognise "Rice Owls" would be a worse bug than
 * the duplication this fixes. `dedupeGamesByFixture` reports how many it could not key so a
 * caller can tell "nothing to collapse" from "I could not read these".
 */
import { nflFixtureKey } from '@/lib/sports/teamRef'

/**
 * Provider preference when two rows describe the same fixture.
 *
 * Live feeds first: when sources disagree about whether a game is over, the one polling the game
 * is likelier to be right than the one that published a schedule in July. An UNKNOWN source sorts
 * last rather than winning by accident — a new provider added upstream must not silently outrank
 * the ones whose behaviour is understood.
 */
export const GAME_SOURCE_PRIORITY = ['espn_live', 'espn', 'rolling_insights', 'thesportsdb'] as const

/** Rank for a source; unknown sources sort after every known one. */
export function gameSourceRank(source: string | null | undefined): number {
  const i = (GAME_SOURCE_PRIORITY as readonly string[]).indexOf(String(source ?? ''))
  return i === -1 ? 99 : i
}

/**
 * Is this row a PRESEASON game?
 *
 * ⚠ THE OBVIOUS PREDICATE IS WRONG AND WOULD DELETE REAL GAMES. `seasonType = 'regular'` looks
 * like the filter and is not: measured 2026-08-30 on NFL 2026 week 1, the four source blocks are
 *
 *     espn              seasonType 'regular'   16 rows   Sep 10-15
 *     rolling_insights  seasonType 'pre'       16 rows   Aug 13-16   <- preseason
 *     rolling_insights  seasonType 'regular'   16 rows   Sep 10-15
 *     thesportsdb       seasonType NULL        16 rows   Sep 10-15   <- REAL, unlabelled
 *
 * 472 of the 841 NFL 2026 rows carry a NULL `seasonType` at all. Excluding anything that is not
 * literally 'regular' therefore drops every TheSportsDB row — 16 genuine week-1 games — to remove
 * 16 preseason ones. Excluding only what is POSITIVELY marked preseason keeps the unlabelled rows,
 * which is the safe direction: an unlabelled regular game shown is a smaller error than a real
 * game hidden.
 *
 * ⚠ AND THE PRESEASON ROWS ARE NOT A DATA BUG. NFL preseason has its own week 1, so
 * `week: 1, seasonType: 'pre'` is CORRECT — Rolling Insights labelled it properly. The defect was
 * always on the read side: consumers asking for "week 1" without saying which season type they
 * meant. Do not "fix" the ingest.
 */
export function isPreseasonGame(row: { seasonType?: string | null }): boolean {
  const t = String(row.seasonType ?? '').trim().toLowerCase()
  return t === 'pre' || t === 'preseason' || t === 'pre-season'
}

/**
 * Drop positively-marked preseason rows, keeping unlabelled ones. See {@link isPreseasonGame}
 * for why this is not `=== 'regular'`.
 */
export function excludePreseason<T extends { seasonType?: string | null }>(rows: readonly T[]): T[] {
  return rows.filter((r) => !isPreseasonGame(r))
}

/** The minimum a row needs for this module to key and rank it. */
export type DedupableGame = {
  homeTeam: string | null
  awayTeam: string | null
  startTime: Date | null
  week: number | null
  season: number | null
  source: string
}

export type DedupeResult<T> = {
  /** One row per fixture, plus every row that could not be keyed. */
  games: T[]
  /** Rows collapsed away — `input.length - games.length`. */
  collapsed: number
  /**
   * Rows no fixture key could be built for (non-NFL, or a team name the resolver does not know).
   * They are INCLUDED in `games` untouched; this is how a caller tells "clean slate" from
   * "I did not understand these", which are different facts and only one is reassuring.
   */
  unkeyed: number
}

/**
 * Collapse duplicate provider rows for the same fixture, keeping the highest-priority source.
 *
 * Order is preserved for unkeyed rows; keyed rows come back in first-seen order.
 */
export function dedupeGamesByFixture<T extends DedupableGame>(rows: readonly T[]): DedupeResult<T> {
  const byKey = new Map<string, T>()
  const unkeyed: T[] = []

  for (const row of rows) {
    const key = nflFixtureKey({
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      startTime: row.startTime,
      week: row.week,
      season: row.season,
    })

    if (!key) {
      unkeyed.push(row)
      continue
    }

    const existing = byKey.get(key)
    if (!existing || gameSourceRank(row.source) < gameSourceRank(existing.source)) {
      byKey.set(key, row)
    }
  }

  const games = [...byKey.values(), ...unkeyed]
  return { games, collapsed: rows.length - games.length, unkeyed: unkeyed.length }
}
