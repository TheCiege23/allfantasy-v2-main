/** Published MLB regular-season end dates, in US Eastern calendar days. */
const MLB_REGULAR_SEASON_END: Readonly<Record<number, string>> = {
  2026: '2026-09-27',
  2027: '2027-09-26',
}

/** New MLB leagues created after the regular season prepare for the following season. */
export function resolveLeagueCreationSeason(sport: string, now = new Date()): number {
  const year = now.getFullYear()
  if (sport.trim().toUpperCase() !== 'MLB') return year
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
  const easternYear = Number(day.slice(0, 4))
  const end = MLB_REGULAR_SEASON_END[easternYear]
  return end && day > end ? easternYear + 1 : easternYear
}
