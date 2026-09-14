export const CORE_GAME_DAY_REFRESH_MS = 20_000
export const CORE_IDLE_REFRESH_MS = 120_000

/** The shell checks cached read models quickly while any followed sport is active. */
export function coreRefreshIntervalMs(gameDayActive: boolean, liveGameCount: number): number {
  return gameDayActive || liveGameCount > 0 ? CORE_GAME_DAY_REFRESH_MS : CORE_IDLE_REFRESH_MS
}
