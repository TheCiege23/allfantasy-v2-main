/**
 * Every Survivor automation failure goes to Sentry from here, tagged so ONE alert rule covers them
 * all: `area:survivor`, plus `survivor_job` naming the job and `league_id` when a league is known.
 *
 * Before this, nothing in the Survivor automation reached Sentry. The season runner wrote
 * `lastError` and alerted the commissioner, and every cron caught its batch error into a JSON
 * summary nobody reads — so an operator learned about a stuck league from the commissioner.
 *
 * Throttled per process: the jobs retry every minute or few, and the same failure on the same
 * league is reported at most once per `SURVIVOR_AUTOMATION_REPORT_WINDOW_MS`. A different message
 * is a different failure and reports at once. Never throws.
 */

import { captureException } from '@/lib/error-tracking'

export type SurvivorAutomationJob =
  | 'season_runner'
  | 'season_batch'
  | 'sit_out_batch'
  | 'notifications'
  | 'draft_start'

export const SURVIVOR_AUTOMATION_REPORT_WINDOW_MS = 6 * 60 * 60 * 1000

const lastReported = new Map<string, number>()

export function reportSurvivorAutomationError(
  error: unknown,
  input: { job: SurvivorAutomationJob; leagueId?: string | null; week?: number | null; now?: number },
): boolean {
  try {
    const message = error instanceof Error ? error.message : String(error)
    const key = `${input.job}|${input.leagueId ?? ''}|${message}`
    const now = input.now ?? Date.now()
    const previous = lastReported.get(key)
    if (previous != null && now - previous < SURVIVOR_AUTOMATION_REPORT_WINDOW_MS) return false
    lastReported.set(key, now)
    captureException(error instanceof Error ? error : new Error(message), {
      context: `survivor:${input.job}`,
      ...(input.leagueId ? { leagueId: input.leagueId } : {}),
      ...(input.week != null ? { week: input.week } : {}),
      tags: { area: 'survivor', survivor_job: input.job, ...(input.leagueId ? { league_id: input.leagueId } : {}) },
    })
    return true
  } catch {
    return false
  }
}

/** Test seam. */
export function resetSurvivorAutomationReportThrottle(): void {
  lastReported.clear()
}
