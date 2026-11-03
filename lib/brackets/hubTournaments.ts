/**
 * Which bracket tournament the hub leads with, by the calendar.
 *
 * The hub used to open on the College Football Playoff in November, while the
 * NBA Cup — the tournament actually being played — sat behind a tab. A hub's
 * first tab is a claim about what is happening now, so it is computed, not
 * hard-coded.
 *
 * ⚠ THE WINDOWS ARE THE LEAGUES' OWN CALENDARS, NOT DATA FROM A FEED, and they
 * are generous on purpose: a pool for a tournament should be the default from
 * the moment people start creating them until its final is over.
 *
 *   NBA Cup        Oct 20 → Dec 20   (group play from early Nov, final mid-Dec)
 *   CFP            Dec 1  → Jan 25   (field set early Dec, title game ~Jan 20)
 *   NFL playoffs   Jan 1  → Feb 20   (Wild Card ~Jan 10, Super Bowl ~mid-Feb)
 *
 * CFP and the NFL playoffs overlap in January; the one that started first
 * stays first, which is how they run.
 */

export type HubTournament = "nba_cup" | "ncaaf" | "nfl"

type Window = { startMonth: number; startDay: number; endMonth: number; endDay: number }

/** Months are 0-based (JS Date). An end month earlier than the start month wraps into the next year. */
const WINDOWS: Record<HubTournament, Window> = {
  nba_cup: { startMonth: 9, startDay: 20, endMonth: 11, endDay: 20 },
  ncaaf: { startMonth: 11, startDay: 1, endMonth: 0, endDay: 25 },
  nfl: { startMonth: 0, startDay: 1, endMonth: 1, endDay: 20 },
}

const DAY = 86_400_000

/** The window that contains `now`, or the next one to open. Dates are UTC midnights. */
function windowAround(t: HubTournament, now: Date): { start: number; end: number } {
  const w = WINDOWS[t]
  const year = now.getUTCFullYear()
  const build = (startYear: number) => {
    const start = Date.UTC(startYear, w.startMonth, w.startDay)
    const endYear = w.endMonth < w.startMonth ? startYear + 1 : startYear
    return { start, end: Date.UTC(endYear, w.endMonth, w.endDay) + DAY - 1 }
  }
  for (const startYear of [year - 1, year, year + 1]) {
    const win = build(startYear)
    if (now.getTime() <= win.end) return win
  }
  return build(year + 1)
}

export type HubTournamentState = {
  tournament: HubTournament
  /** True while today is inside the tournament's window. */
  live: boolean
  /** The season year pools for this tournament are stored under. */
  season: number
  opensAt: Date
}

/**
 * Live tournaments first (earliest start first), then upcoming ones by how
 * soon they open. On 1 November that is NBA Cup → CFP → NFL; on 5 January it
 * is CFP → NFL → NBA Cup.
 */
export function orderHubTournaments(now: Date = new Date()): HubTournamentState[] {
  return (Object.keys(WINDOWS) as HubTournament[])
    .map((tournament) => {
      const win = windowAround(tournament, now)
      const live = now.getTime() >= win.start
      return { tournament, live, season: hubSeasonYear(tournament, new Date(win.start)), opensAt: new Date(win.start) }
    })
    .sort((a, b) => Number(b.live) - Number(a.live) || a.opensAt.getTime() - b.opensAt.getTime())
}

/**
 * Pools are stored under the year the season STARTS. A CFP or NFL playoff
 * game played in January belongs to the previous year's season — querying
 * the calendar year in January would find no pools at all.
 */
export function hubSeasonYear(tournament: HubTournament, now: Date = new Date()): number {
  const year = now.getUTCFullYear()
  if (tournament === "nba_cup") return year
  return now.getUTCMonth() <= 1 ? year - 1 : year
}
