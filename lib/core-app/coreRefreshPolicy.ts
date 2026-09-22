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
const NO_LIVE_VALUE_SCREENS: ReadonlySet<string> = new Set(['my-team'])

/**
 * The cadence of the shell's FULL-ROUTE refresh for the screen on display. The rail's own score
 * poll (useLiveRailScores) keeps `coreRefreshIntervalMs` — it fetches live scores and wants 20s.
 */
export function shellRouteRefreshMs(screen: string, gameDayActive: boolean, liveGameCount: number): number {
  if (NO_LIVE_VALUE_SCREENS.has(screen)) return CORE_IDLE_REFRESH_MS
  return coreRefreshIntervalMs(gameDayActive, liveGameCount)
}
