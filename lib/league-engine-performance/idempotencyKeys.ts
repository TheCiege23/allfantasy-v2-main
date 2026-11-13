/**
 * Stable idempotency key builders for league-engine background work.
 * Use these for cron, BullMQ jobIds, and deduplicated processing — not for client-generated keys unless documented.
 */

/** Minute-bucket key so overlapping cron invocations in the same UTC minute skip duplicate waiver runs per league. */
export function buildWaiverCronIdempotencyKey(leagueId: string, at: Date = new Date()): string {
  const iso = at.toISOString()
  const minute = iso.slice(0, 16)
  return `cron:waiver:${leagueId}:${minute}`
}

/** Scoring batch: one key per league per season-week bucket. */
export function buildScoringJobIdempotencyKey(
  leagueId: string,
  season: number,
  weekOrRound: number,
  at: Date = new Date(),
): string {
  const minute = at.toISOString().slice(0, 16)
  return `job:scoring:${leagueId}:${season}:w${weekOrRound}:${minute}`
}

/** AI matchup / start-sit refresh — throttle duplicate enqueue for same league+week. */
export function buildAiMatchupRefreshEnqueueKey(leagueId: string, week: number, surface: string): string {
  return `ai:matchup:${leagueId}:w${week}:${surface}`
}
