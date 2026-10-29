/**
 * Pure helpers for the sport-default waiver cadence (lib/sport-defaults/SportDefaultsRegistry.ts).
 *
 * - `defaultProcessingDaysList` — the multi-day `LeagueWaiverSettings.processingDays` value to persist
 *   from a sport's `processing_days`. Only a list of TWO OR MORE days is returned: a single-day sport
 *   (NFL, NCAAF) is fully described by `processingDayOfWeek`, so its rows stay exactly as before.
 * - `resolveFreeAgentUnlockBehavior` — the league's free-agent unlock rule: an explicit
 *   `settings.waiver_free_agent_unlock_behavior` wins, otherwise the sport/variant default.
 *
 * `'daily'` (NBA/MLB/NHL) means a player who is not on waivers is a first-come free agent between
 * runs; a player still on waivers (dropped inside the waiver period, or with a pending claim) needs a
 * claim. `'after_waiver_run'` (NFL/NCAAF) keeps its existing behaviour: immediate adds only with FCFS
 * or `instantFaAfterClear`.
 */

export function defaultProcessingDaysList(processingDays: unknown): number[] | null {
  if (!Array.isArray(processingDays)) return null
  const days = processingDays.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  const unique = Array.from(new Set(days))
  return unique.length > 1 ? unique : null
}

export function resolveFreeAgentUnlockBehavior(
  leagueSettings: unknown,
  defaultBehavior: unknown,
): string | null {
  const src =
    leagueSettings && typeof leagueSettings === 'object' && !Array.isArray(leagueSettings)
      ? (leagueSettings as Record<string, unknown>)
      : {}
  const explicit = src.waiver_free_agent_unlock_behavior
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim().toLowerCase()
  return typeof defaultBehavior === 'string' && defaultBehavior.trim() ? defaultBehavior.trim().toLowerCase() : null
}

export function isDailyFreeAgentUnlock(behavior: string | null | undefined): boolean {
  return behavior === 'daily'
}
