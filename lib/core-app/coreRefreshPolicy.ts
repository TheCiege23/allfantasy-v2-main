export const CORE_GAME_DAY_REFRESH_MS = 20_000
export const CORE_IDLE_REFRESH_MS = 120_000

/** The shell checks cached read models quickly while any followed sport is active. */
export function coreRefreshIntervalMs(gameDayActive: boolean, liveGameCount: number): number {
  return gameDayActive || liveGameCount > 0 ? CORE_GAME_DAY_REFRESH_MS : CORE_IDLE_REFRESH_MS
}

/**
 * Screens that render NO value able to change during a game, so a game-day full-route refresh of
 * them re-runs every read to redraw the same page.
 *
 * `my-team` is the one measured: its score is always "no live scoring ingested"
 * (lib/core-app/myTeam.ts), the lock countdown already ticks on the client clock, and injury flags
 * move only when the injury cron writes. Yet in prod Sentry (7d to 2026-09-22) its refreshes were
 * the largest DB load on /core — Σ53k queries, p95 105 per render. It keeps the idle cadence, so
 * injury and lock flips still arrive within two minutes and `gameDayActive` itself stays current.
 *
 * ⚠ ADD A SCREEN HERE ONLY WITH THE SAME EVIDENCE. A screen that shows live points refreshed at
 * idle cadence would sit on stale scores through a whole slate, with nothing to say so.
 */
// LiveScores owns its 20-second data poll; the rail also polls independently.
// A full server render at that same cadence adds work without fresher scores.
const IDLE_SHELL_SCREENS: ReadonlySet<string> = new Set(['my-team', 'live'])

/**
 * ⚠ THE SHELL REBUILDS THE PAGE ONLY WHEN ITS DATA CHANGED — the user's call on 2026-11-19, "follow
 * the Sleeper model". Before, the shell called `router.refresh()` blindly every 20s on a game day,
 * which for someone following several sports is nearly every day: measured on prod, 8 full
 * renders of /core in 3 minutes, ~80 every 30 minutes, almost all of them identical.
 *
 * Now the cadence below is how often it ASKS `/api/core/league-version` for a fingerprint of the
 * user's leagues, teams and rosters (one SQL round trip, no rows returned). It rebuilds when the
 * fingerprint moves. Measured on prod the same day: 728 roster and 728 team writes by the sync
 * in 31 minutes left the fingerprint unchanged, because the sync rewrites identical content.
 *
 * Two backstops keep it from ever being staler than this bound:
 *   - CORE_SAFETY_REFRESH_MS: a rebuild at least this often regardless, for everything the
 *     fingerprint does not cover (injuries, schedules, settings JSON, news).
 *   - an unavailable fingerprint means "rebuild", i.e. the old behaviour, never "assume unchanged".
 * Live scores are not in it at all: the rail and the matchup board patch them in place.
 */
export const CORE_SAFETY_REFRESH_MS = 300_000

export type CoreRefreshDecision = { refresh: boolean; seen: string | null }

/**
 * `seen` is the fingerprint the page on screen was built from (null until the first answer),
 * `next` the one just fetched (null when the fetch failed), `sinceRefreshMs` the time since the
 * last rebuild. Returns whether to rebuild and the fingerprint to remember.
 */
export function decideCoreRefresh(seen: string | null, next: string | null, sinceRefreshMs: number): CoreRefreshDecision {
  if (next === null) return { refresh: true, seen }
  const due = sinceRefreshMs >= CORE_SAFETY_REFRESH_MS
  // First answer: the page was just built, so it is the baseline, not a change.
  if (seen === null) return { refresh: due, seen: next }
  return { refresh: due || next !== seen, seen: next }
}

/**
 * The cadence of the shell's FULL-ROUTE refresh for the screen on display. The rail's own score
 * poll (useLiveRailScores) keeps `coreRefreshIntervalMs` — it fetches live scores and wants 20s.
 */
export function shellRouteRefreshMs(screen: string, gameDayActive: boolean, liveGameCount: number): number {
  if (IDLE_SHELL_SCREENS.has(screen)) return CORE_IDLE_REFRESH_MS
  return coreRefreshIntervalMs(gameDayActive, liveGameCount)
}
