/**
 * Narrow a league list to the newest season the reader actually has.
 *
 * ⚠ RESOLVED FROM THE DATA, NEVER FROM A CLOCK. Measured on a real account: 557 leagues
 * reached the power-rankings picker and all 557 rendered, costing 7,335 DOM nodes. 68 were the
 * current season.
 *
 * ⚠ AND THE OTHER 489 ARE NOT ALL STALE COPIES — BE HONEST ABOUT WHAT THIS HIDES. Of 298
 * distinct names, 108 recur across seasons (six cards named "AFC Dreaming!", 2021 through
 * 2026), and collapsing those is the win. But 234 names exist ONLY before 2026: this filter
 * makes them unreachable from the picker entirely. That is a deliberate trade for a rankings
 * board — a finished 2021 season is not a thing to rank — and not a claim that they were
 * duplicates.
 *
 * ⚠ `collapseLeagueSeasons` IN `lib/dashboard/get-dashboard-league-list.ts` DOES NOT AND
 * CANNOT DO THIS JOB, THOUGH ITS DOC SAYS IT DOES. It keys on `platform:platformLeagueId`,
 * and Sleeper issues a NEW league id every season — verified: those six "AFC Dreaming!" rows
 * carry six different ids. Measured on the live payload, it collapses 557 to 557. The key that
 * WOULD work is Sleeper's `previous_league_id` chain (it resolves: NFL Dreaming! 2026 ->
 * 1186456795425361920 -> NFL Dreaming! 2025), but that field is stored nowhere — 0 of 70
 * Sleeper league rows carry it. Grouping a series properly needs it captured at import first.
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

/**
 * @param seasonWindow how many seasons back from the newest to keep. 1 = the newest only.
 *
 * ⚠ 2 IS THE PICKER'S CHOICE AND IT IS A TRADE, NOT AN OPTIMUM. Measured on a real account
 * after series collapse: 374 cards, of which 68 are the current season, 9 are the previous one
 * and 194 are 2021-2022 — leagues that genuinely ended years ago, plus entries whose chains
 * were never walked so they never grouped. A window of 2 keeps the ~77 a manager might still
 * rank and drops the long-dead tail. It DOES hide leagues that are real; that is the cost, and
 * the surface says so rather than letting them vanish.
 */
export function selectLatestSeasonLeagues<T extends SeasonScoped>(
  leagues: readonly T[],
  seasonWindow = 1,
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
  /* A window below 1 would keep nothing; clamp rather than blank the picker on a bad caller. */
  const oldestKept = latest - Math.max(1, Math.floor(seasonWindow)) + 1
  const visibleLeagues = leagues.filter((l) => {
    const n = seasonNumber(l.season)
    return Number.isFinite(n) && n >= oldestKept && n <= latest
  })
  return {
    visibleLeagues: [...visibleLeagues],
    latestSeason: String(latest),
    hiddenCount: leagues.length - visibleLeagues.length,
  }
}
