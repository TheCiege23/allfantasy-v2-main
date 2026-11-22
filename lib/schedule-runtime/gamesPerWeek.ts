/**
 * Games per team per week: how many head-to-head opponents each team plays in one scoring week.
 *
 * 1 is the ordinary schedule. Above 1, a week holds that many round-robin rounds, so every team meets
 * that many different opponents with the same weekly score, and each game is its own win or loss.
 * Pure and dependency-free; stored on `League.settings.games_per_week`.
 */

export const GAMES_PER_WEEK_SETTINGS_KEY = 'games_per_week' as const
export const MAX_GAMES_PER_WEEK = 7

/** A valid stored value, else 1. */
export function readGamesPerWeek(settings: unknown): number {
  const raw =
    settings != null && typeof settings === 'object' && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)[GAMES_PER_WEEK_SETTINGS_KEY]
      : null
  return normalizeGamesPerWeek(raw)
}

export function normalizeGamesPerWeek(value: unknown): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_GAMES_PER_WEEK ? n : 1
}

export function isValidGamesPerWeek(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_GAMES_PER_WEEK
}

/** The most games any one team plays in a single week of these matchups; 1 when there are none. */
export function inferGamesPerWeek(
  matchups: ReadonlyArray<{ week: number; homeRosterId: string; awayRosterId?: string | null; isMedianMatchup?: boolean | null }>,
): number {
  const counts = new Map<string, number>()
  let max = 1
  for (const matchup of matchups) {
    if (matchup.isMedianMatchup || !matchup.awayRosterId) continue
    for (const rosterId of [matchup.homeRosterId, matchup.awayRosterId]) {
      const key = `${matchup.week}|${rosterId}`
      const next = (counts.get(key) ?? 0) + 1
      counts.set(key, next)
      if (next > max) max = next
    }
  }
  return max
}
