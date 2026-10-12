/**
 * Big Brother League automation — shared types.
 * @see docs/BIG_BROTHER_AUTOMATION_ENGINE.md
 */

export type BbAutomationTickInput = {
  /** When true, handlers must not mutate DB (log intent only). */
  dryRun?: boolean
  /** Optional: process a single league’s BB config (support / debug). */
  forceLeagueId?: string
  /** Injected clock for tests. */
  now?: Date
}

export type BbAutomationTickResult = {
  ok: boolean
  processed: number
  skipped: number
  errors: string[]
  dryRun: boolean
  /** Human-readable status for cron JSON responses. */
  message: string
}

export type BbReminderSweepInput = {
  dryRun?: boolean
  now?: Date
}

export type BbReminderSweepResult = {
  ok: boolean
  remindersScheduled: number
  errors: string[]
  dryRun: boolean
  message: string
}

export type BbStatCorrectionInput = {
  /** Previously published finalized totals, supplied by a correction rerun. */
  previousScores?: Record<string, number>
  leagueId?: string
  redraftSeasonId?: string
  week?: number
  dryRun?: boolean
}

export type BbStatCorrectionResult = {
  ok: boolean
  leaguesNoted: number
  errors: string[]
  message: string
}
