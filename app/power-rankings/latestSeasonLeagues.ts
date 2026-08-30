/**
 * Narrow a league list to the newest season the reader actually has.
 *
 * ⚠ RESOLVED FROM THE DATA, NEVER FROM A CLOCK. Measured on a real account: 557 leagues
 * reached the power-rankings picker, of which 68 were the current season and the other 489
 * were the SAME leagues repeated back to 2020 — eight cards named "AFC Dreaming!", one per
 * year. All 557 rendered, costing 7,335 DOM nodes.
 *
 * `new Date().getFullYear()` is the obvious filter and is wrong twice: it empties the picker
 * for anyone whose newest league is last season, and it flips on 1 January while the playoffs
 * are still being played. The newest season present in the list itself can never be empty,
 * because it is drawn from the list.
 *
 * Pure: no clock, no network, no DOM — which is the whole reason it is not inline in the page.
 */

export interface SeasonScoped {
  season: string
}

export interface LatestSeasonResult<T extends SeasonScoped> {
  /** The leagues to render. */
  visibleLeagues: T[]
  /** The season they belong to, or null when no league carries a readable one. */
  latestSeason: string | null
  /** How many were left out, so a surface can say so rather than appearing to lose them. */
  hiddenCount: number
}

/**
 * A season as a number, or NaN when it is not one.
 *
 * ⚠ `Number('')` IS 0, NOT NaN, AND THAT DEFEATED THE GUARD BELOW. A league carrying an empty
 * season parsed as the year zero, counted as readable, and won the `Math.max` whenever every
 * other entry was unreadable too — so "show everything when nothing parses" silently showed
 * only the blank ones. Caught by its own test, which is why the blank case is in there.
 */
function seasonNumber(season: unknown): number {
  const text = String(season ?? '').trim()
  if (text === '') return NaN
  const n = Number(text)
  return Number.isFinite(n) && n > 0 ? n : NaN
}

export function selectLatestSeasonLeagues<T extends SeasonScoped>(
  leagues: readonly T[],
): LatestSeasonResult<T> {
  const seasons = leagues.map((l) => seasonNumber(l.season)).filter((n) => Number.isFinite(n))

  /*
   * No readable season anywhere: show everything rather than nothing. Filtering on a field we
   * could not parse would hide the reader's entire library on a data quirk.
   */
  if (seasons.length === 0) {
    return { visibleLeagues: [...leagues], latestSeason: null, hiddenCount: 0 }
  }

  const latest = Math.max(...seasons)
  const visibleLeagues = leagues.filter((l) => seasonNumber(l.season) === latest)
  return {
    visibleLeagues: [...visibleLeagues],
    latestSeason: String(latest),
    hiddenCount: leagues.length - visibleLeagues.length,
  }
}
