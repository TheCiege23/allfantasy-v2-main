/**
 * The shape `loadFinishedNflWeeks` returns, apart from the loader — so `leagueWeekProgress`, which
 * is pure and client-reachable, can take it without importing a `server-only` module.
 */

/** `${season}:${week}` for every NFL regular-season week whose games are all final. */
export type FinishedNflWeeks = ReadonlySet<string>

export const finishedWeekKey = (season: number, week: number) => `${season}:${week}`
