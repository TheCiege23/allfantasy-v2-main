/**
 * What week is it, according to the platform the leagues actually live on.
 *
 * 🛑 A CRON CANNOT CARRY A MOVING WEEK. `cron-schedule.json` holds a literal
 * path, so a scheduled ingest either hardcodes a week — wrong from the moment
 * the season moves on — or works it out at run time. The weekly-scores route
 * requires season and week explicitly and refuses to guess, which is right for a
 * hand-run call and useless to a scheduler; this is the piece that lets the
 * scheduler answer the question honestly instead.
 *
 * ⚠ SLEEPER'S OWN STATE, NOT A CALENDAR. Deriving the NFL week from a date
 * means reimplementing kickoff dates, byes and flex scheduling, and being wrong
 * about it exactly when it matters — during the week a schedule shifts. The
 * platform publishes what it thinks the week is, and its answer is the one its
 * `matchups/{week}` endpoint is keyed on, which is the only definition that
 * makes the ingest line up.
 *
 * ⚠ INGESTION, so calling a provider here is the permitted layer. Nothing on a
 * request path should reach for this.
 */
import 'server-only'

const SLEEPER_STATE_URL = 'https://api.sleeper.app/v1/state/nfl'

export type NflWeek = { season: number; week: number }

type SleeperState = {
  season?: string | number
  week?: string | number
  display_week?: string | number
  season_type?: string
}

/**
 * Parse Sleeper's state payload.
 *
 * Pure, so the shapes it must survive are asserted without a network call.
 */
export function parseNflState(state: SleeperState | null | undefined): NflWeek | null {
  if (!state) return null
  const season = Number(state.season)
  /*
   * ⚠ `week` RATHER THAN `display_week`. They diverge in the offseason and
   * around the playoffs, and `week` is the one `matchups/{week}` is keyed on —
   * ingesting under a display week would file a real week's scores under a
   * number nothing else uses.
   */
  const week = Number(state.week)
  if (!Number.isFinite(season) || !Number.isFinite(week)) return null
  /* Week 0 is Sleeper's preseason state: nothing has been played, so there is
     nothing to ingest and saying so beats fetching twenty empty payloads. */
  if (week < 1 || season < 2000) return null
  return { season: Math.trunc(season), week: Math.trunc(week) }
}

/**
 * Ask Sleeper what week it is.
 *
 * Returns null rather than throwing or falling back to a guess: a scheduler that
 * cannot establish the week must do nothing, not ingest under a made-up one.
 */
export async function resolveCurrentNflWeek(
  fetchState: () => Promise<SleeperState | null> = async () => {
    const res = await fetch(SLEEPER_STATE_URL, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as SleeperState
  },
): Promise<NflWeek | null> {
  try {
    return parseNflState(await fetchState())
  } catch {
    return null
  }
}

/**
 * The weeks a scheduled sweep should collect.
 *
 * 🛑 THE CURRENT WEEK ALONE IS NOT ENOUGH, AND THE REASON IS A ONE-DAY WINDOW.
 * Sleeper advances `week` early in the new week, while the week just played is
 * only then settling into its final numbers. A sweep that took the current week
 * only would capture partial scores every day of a week and never once record
 * the finished totals — the standings would trail reality by a week, invisibly.
 *
 * So it collects the previous week as well. The ingest is idempotent and scoped
 * to the rosters it writes, so re-collecting a settled week costs one request
 * per league and changes nothing.
 */
export function weeksToSweep(current: NflWeek): NflWeek[] {
  const weeks: NflWeek[] = [current]
  if (current.week > 1) weeks.push({ season: current.season, week: current.week - 1 })
  return weeks
}
