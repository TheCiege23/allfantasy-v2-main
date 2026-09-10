/**
 * One rule for what "season" means in a stored row: THE YEAR THE SEASON STARTED.
 *
 * WHY THIS EXISTS. Providers disagree about how to label a season that spans two calendar
 * years, and this repo stores both spellings in the same column:
 *
 *   TheSportsDB   NBA / NHL  ->  "2024-2025"      (hyphenated span)
 *   TheSportsDB   MLB / NFL  ->  "2025"           (single year; no span to express)
 *   Rolling Insights, all    ->  "2025"
 *
 * Measured on production 2026-09-08: `player_season_stats` held NBA rows under
 * "2024-2025" / "2022-2023" / "2019-2020" and NHL under "2020-2021" / "1993-1994",
 * while every NFL row from Rolling Insights sat under a plain year.
 *
 * 🛑 THE COLUMN TYPE IS WHY ONE HALF WAS ALREADY RIGHT AND THE OTHER WAS NOT.
 * `SportsGame.season` is an `Int`, so `theSportsDbIngest` was already forced to reduce the
 * label (`intOf(season.slice(0, 4))`) before writing. `player_season_stats.season` is a
 * `String`, so the raw span passed straight through and nothing complained. Same file, same
 * feed, two answers — decided by a column type rather than by a decision.
 *
 * ⚠ AND A MISMATCH HERE CANNOT THROW. A season compared as an integer year against the string
 * "2024-2025" simply matches nothing: no error, no empty-result warning, just a query that
 * quietly returns zero rows. That is the failure mode this repo keeps rediscovering, so the
 * rule is named, shared and tested rather than inlined a second time.
 *
 * THE AUTHORITY IS THE VENDOR CONTRACT, NOT A PREFERENCE. `contracts/rolling-insights/
 * ENDPOINTS.yaml` states it for the season-keyed endpoints:
 *
 *   player_stats:
 *     path: /player-stats/{season}/{SPORT}
 *     season: { format: "YYYY", note: "Year season started." }
 *
 * So "2024-2025" is 2024. Choosing the END year would silently disagree with every id we
 * send back to the provider.
 *
 * 🛑 THIS NORMALISES WHAT WE STORE. IT IS NOT A REQUEST BUILDER, AND THE TWO DISAGREE.
 * The `YYYY` rule above is the REST season path. Rolling Insights' GraphQL `nflRoster` query
 * wants the SPAN and rejects a plain year — `lib/rolling-insights.ts` coerces "2025" up to
 * "2025-2026" precisely because "2025" returns 0 rows there. Passing the output of this
 * function into that query would silently fetch nothing. Normalise on the way INTO the
 * database; build each request in whatever spelling that endpoint documents.
 *
 * ⚠ A THIRD COPY OF THIS RULE EXISTS AND IS DELIBERATELY LEFT ALONE FOR NOW.
 * `lib/scores/gameScoreProviders.ts` has a private `seasonYear()` doing the same job with an
 * UNANCHORED `/(\d{4})/` and no range check, so it reads "Week 2024" as a season where this
 * declines. Consolidating is right — two implementations of one rule is the bug this repo
 * already records — but it changes behaviour in a live scoring path on inputs nobody has
 * measured, so it belongs in its own change with its own evidence, not smuggled into this one.
 */

/** A season label is plausible for these sports between roughly the first pro leagues and near future. */
const MIN_PLAUSIBLE_SEASON = 1870
const MAX_PLAUSIBLE_SEASON = 2100

/**
 * The year a season started, or `null` when the label cannot be read as one.
 *
 * ⚠ RETURNS `null` RATHER THAN GUESSING. A label this does not understand is a new provider
 * spelling, and inventing a year for it would write a row that joins to nothing while looking
 * correct — strictly worse than declining and being counted.
 *
 * Accepts: "2025", "2024-2025", "2024-25", "2024/2025", " 2024 - 2025 ".
 * Declines: "", "not a season", "20", "999999", null, undefined.
 */
export function seasonStartYear(label: unknown): number | null {
  if (typeof label === 'number' && Number.isInteger(label)) {
    return inRange(label) ? label : null
  }
  const raw = String(label ?? '').trim()
  if (!raw) return null

  // The leading 4-digit group is the start year for every spelling above. Anchored so a
  // trailing number ("Week 2024") cannot be mistaken for a season.
  const m = /^(\d{4})/.exec(raw)
  if (!m) return null

  const year = Number(m[1])
  return inRange(year) ? year : null
}

function inRange(year: number): boolean {
  return year >= MIN_PLAUSIBLE_SEASON && year <= MAX_PLAUSIBLE_SEASON
}

/**
 * The canonical STRING form for a season column that stores text.
 *
 * `player_season_stats.season` is a `String`, so it needs the same rule as the integer
 * columns rather than a second one — this is `seasonStartYear` rendered, never a different
 * decision. Returns `null` when the label cannot be read, so a caller can skip and count
 * rather than write an unjoinable row.
 */
export function canonicalSeasonLabel(label: unknown): string | null {
  const year = seasonStartYear(label)
  return year == null ? null : String(year)
}
