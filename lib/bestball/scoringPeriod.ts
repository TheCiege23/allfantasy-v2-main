/**
 * BEST BALL'S SCORING PERIOD — weekly or daily — and the ONE place that decides which a league uses.
 *
 * Weekly (the default, every sport): one optimal lineup over each player's WEEKLY total.
 * Daily (NBA / NHL / MLB only, never a tournament): the week's score is the SUM over its US Eastern days
 * of that day's optimal lineup from the players on the roster that day (`scoreRosterBestBall`,
 * lib/redraft/scoringEngine.ts).
 *
 * 🛑 THE STORED `scoringPeriod` CANNOT BE TRUSTED ON ITS OWN. Until this change the sport profiles
 * (`lib/bestball/rules.ts`) DEFAULTED NBA / NHL / MLB / NCAAB to `'daily'`, so every such league created
 * before it has `best_ball_settings.scoringPeriod: 'daily'` (and `League.bbScoringPeriod: 'daily'`)
 * without anyone having chosen it — and every one of them has always been scored WEEKLY, because nothing
 * in scoring read the field. Reading that value as a choice would flip in-season leagues to a different
 * scoring rule, against per-day stat rows that were never written for them.
 *
 * So a league is daily only when its settings carry the marker `normalizeBestBallSettings` writes beside
 * a daily choice (`dailyBestBall: true`). Legacy rows have no marker and stay weekly — what they were
 * actually scored as — and the commissioner panel shows them as weekly.
 *
 * Pure and client-safe.
 */

export type BestBallScoringPeriodValue = 'weekly' | 'daily'

/** The sports with per-day stat rows and a daily week window (`resolveDailySportWeekWindow`). */
const DAILY_BEST_BALL_SPORTS = ['NBA', 'NHL', 'MLB'] as const

export function bestBallSportSupportsDaily(sport: string | null | undefined): boolean {
  return (DAILY_BEST_BALL_SPORTS as readonly string[]).includes(String(sport ?? '').trim().toUpperCase())
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** The stored `best_ball_settings` block, or null. */
export function storedBestBallSettings(settings: unknown): Record<string, unknown> | null {
  return record(record(settings)?.best_ball_settings)
}

/**
 * The scoring period a league is ACTUALLY scored with. Daily only when all hold: a daily-capable sport,
 * not a tournament, `scoringPeriod: 'daily'`, and the `dailyBestBall: true` marker (see above).
 */
export function resolveBestBallScoringPeriod(league: { sport?: string | null; settings?: unknown } | null | undefined): BestBallScoringPeriodValue {
  if (!league || !bestBallSportSupportsDaily(league.sport)) return 'weekly'
  const bb = storedBestBallSettings(league.settings)
  if (!bb) return 'weekly'
  if (bb.contestStructure === 'tournament' || bb.tournamentEnabled === true) return 'weekly'
  return bb.scoringPeriod === 'daily' && bb.dailyBestBall === true ? 'daily' : 'weekly'
}

/** True for a Best Ball league scored daily. `bestBallMode` false (when given) is never daily. */
export function isDailyBestBallLeague(
  league: { sport?: string | null; settings?: unknown; bestBallMode?: boolean | null } | null | undefined,
): boolean {
  if (!league || league.bestBallMode === false) return false
  return resolveBestBallScoringPeriod(league) === 'daily'
}

/**
 * The stored block with `scoringPeriod` replaced by the period the league is actually scored with — what
 * the settings panel and every label read, so a legacy "daily" that was never daily reads as weekly.
 */
export function withEffectiveScoringPeriod(
  sport: string | null | undefined,
  settings: unknown,
): Record<string, unknown> | null {
  const bb = storedBestBallSettings(settings)
  if (!bb) return null
  const period = resolveBestBallScoringPeriod({ sport, settings })
  return { ...bb, scoringPeriod: period, dailyBestBall: period === 'daily' }
}

