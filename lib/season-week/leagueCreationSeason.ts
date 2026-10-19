/** Published MLB regular-season end dates, in US Eastern calendar days. */
const MLB_REGULAR_SEASON_END: Readonly<Record<number, string>> = {
  2026: '2026-09-27',
  2027: '2027-09-26',
}

/**
 * MLB's final regular-season day for a year with no published date: the last Sunday of September,
 * which reproduces both published years above (2026-09-27, 2027-09-26). Without it a 2028 MLB
 * league created after that season ended was stamped 2028 — a finished season that never scores.
 */
function mlbRegularSeasonEnd(year: number): string {
  const published = MLB_REGULAR_SEASON_END[year]
  if (published) return published
  const sept30 = new Date(Date.UTC(year, 8, 30))
  const lastSunday = new Date(sept30.getTime() - sept30.getUTCDay() * 86_400_000)
  return lastSunday.toISOString().slice(0, 10)
}

/**
 * Sports whose season spans two calendar years, and the last month (US Eastern, 1-12) in which a
 * new league still joins the season that is IN PROGRESS rather than the next one.
 *
 * 🛑 WHY. Seasons are keyed by the calendar year they BEGIN (`dailySportSeasonStarts.ts`: "a 2026-27
 * season is `2026`"). Only MLB was adjusted here, so an NBA or NHL league created in February 2027
 * was stamped 2027 — the season that opens next October — instead of 2026, the one being played.
 * Same for NCAAB and soccer.
 *
 * The cutoffs deliberately err EARLY: a league created in the last weeks of a regular season is
 * stamped with the next one, where it waits and plays a full season. Erring late would stamp a
 * season that has already ended, which can never score. NBA/NHL regular seasons end mid-April,
 * NCAAB's regular season in early March, soccer's in late May.
 */
const SPLIT_YEAR_IN_PROGRESS_THROUGH_MONTH: Readonly<Record<string, number>> = {
  NBA: 3,
  NHL: 3,
  NCAAB: 2,
  NCAABB: 2,
  SOCCER: 4,
}

function easternDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/**
 * The season a NEW league is stamped with: the season in progress, or the next one once the
 * in-progress season's regular season is (nearly) over.
 */
export function resolveLeagueCreationSeason(sport: string, now = new Date()): number {
  const key = sport.trim().toUpperCase()
  if (key === 'MLB') {
    const day = easternDay(now)
    const easternYear = Number(day.slice(0, 4))
    return day > mlbRegularSeasonEnd(easternYear) ? easternYear + 1 : easternYear
  }
  const throughMonth = SPLIT_YEAR_IN_PROGRESS_THROUGH_MONTH[key]
  if (throughMonth != null) {
    const day = easternDay(now)
    const easternYear = Number(day.slice(0, 4))
    const month = Number(day.slice(5, 7))
    // January..cutoff belongs to the season that began LAST calendar year.
    return month <= throughMonth ? easternYear - 1 : easternYear
  }
  return now.getFullYear()
}
