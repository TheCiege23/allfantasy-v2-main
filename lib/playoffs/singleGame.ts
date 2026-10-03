/**
 * Single-game vs series wording, in ONE place.
 *
 * The engine was built for best-of-N series (NBA/NHL Bo7, MLB Bo3/5/7), so its
 * copy says "wins series 4-2", "Best of 7", "Series already started". The
 * College Football Playoff is single games (`bestOf: 1`), where every one of
 * those reads wrong — "Ohio State wins series 1-0", "Best of 1".
 *
 * Keyed on `bestOf`, never on sport: a single-game round is a single game
 * whatever league it belongs to, and the row already carries the number. Pure,
 * so the server sync and the client board share it.
 */
export function isSingleGameSeries(series: { bestOf?: number | null } | null | undefined): boolean {
  return Number(series?.bestOf) === 1
}

/** "Single game" for bestOf 1, otherwise "Best of N". */
export function formatLabel(bestOf: number | null | undefined): string {
  return Number(bestOf) === 1 ? "Single game" : `Best of ${bestOf}`
}

/** "Game" for a single game, "Series" otherwise — for status and lock copy. */
export function matchupNoun(series: { bestOf?: number | null } | null | undefined): "Game" | "Series" {
  return isSingleGameSeries(series) ? "Game" : "Series"
}
