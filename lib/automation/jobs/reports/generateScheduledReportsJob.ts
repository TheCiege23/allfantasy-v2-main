/**
 * Scheduled report generation, as an orchestrated automation job.
 *
 * Same envelope as the waiver and workspace jobs — `runAutomationJob` for the durable
 * `AutomationJob`/`AutomationRun` ledger and idempotency — so Automation Center reads ONE ledger
 * and this shows up beside the others on identical terms.
 *
 * ⚠ IT SHARES THE COMMISSIONER-OS CRON ROUTE RATHER THAN TAKING ITS OWN.
 * `scripts/cron-budget-check.mjs` caps the registry at 60 schedules and it is AT 60 — measured
 * 2026-09-08, after a peer took the last slot. Adding a 61st would fail the budget check and block
 * every PR that touches the registry. Riding the existing daily commissioner-os cron costs nothing
 * in fidelity: the two jobs write separate `automation_runs` rows under separate job types, so the
 * ledger still distinguishes them; only the HTTP entry point and the heartbeat are shared.
 */

import { runAutomationJob } from '@/lib/automation/engine'
import { buildIdempotencyKey, hashIdempotencyKey } from '@/lib/automation/idempotency'
import { RetryableAutomationError, toErrorMessage } from '@/lib/automation/errors'
import { discoverWorkspaceRefreshLeagues } from '@/lib/automation/jobs/workspace/discoverWorkspaceRefreshLeagues'
import { withAutomationLock } from '@/lib/automation/locks'
import type { AutomationResult } from '@/lib/automation/types'
import { generateReport, readLastRunByTemplate, templatesDue } from '@/lib/commissioner-reports/reportStore'
import { isLiveReady } from '@/lib/commissioner-ui/liveReadiness'

export const REPORTS_JOB_TYPE = 'reports.generateScheduled'

/**
 * One key per league per ISO week.
 *
 * ⚠ NOT A CALENDAR-DAY BUCKET like the workspace scan uses. The weekly digest is the shortest
 * cadence here, so a daily key would let the same digest regenerate seven times a week — seven
 * near-identical artifacts in a history list that is supposed to be a record of distinct reports.
 * The week bucket makes the idempotency guard match the fastest schedule the catalog offers.
 */
function isoWeekBucket(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  // Thursday of the current week decides the ISO year, which is what makes the turn of the year work.
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function buildReportsIdempotencyKey(leagueId: string, at: Date): string {
  return hashIdempotencyKey(buildIdempotencyKey([REPORTS_JOB_TYPE, leagueId, isoWeekBucket(at)]))
}

export async function generateScheduledReportsForLeague(input: {
  leagueId: string
  scheduledFor?: Date
  trigger?: 'scheduled' | 'manual' | 'admin'
}): Promise<AutomationResult & { jobId: string; runId: string }> {
  const scheduledFor = input.scheduledFor ?? new Date()

  return runAutomationJob(
    {
      leagueId: input.leagueId,
      jobType: REPORTS_JOB_TYPE,
      idempotencyKey: buildReportsIdempotencyKey(input.leagueId, scheduledFor),
      metadata: { trigger: input.trigger ?? 'scheduled', scheduledFor: scheduledFor.toISOString() },
    },
    async (ctx) => {
      try {
        const locked = await withAutomationLock(
          `reports:generate:${input.leagueId}`,
          { owner: ctx.jobId, ttlMs: 180_000 },
          async () => {
            const lastRuns = await readLastRunByTemplate(input.leagueId)
            const due = templatesDue(lastRuns, scheduledFor)

            const produced: string[] = []
            const empty: string[] = []
            const failed: string[] = []
            for (const template of due) {
              /*
               * ⚠ `skipWhenEmpty` IS TRUE ONLY HERE, on the scheduled path. Measured on production
               * 2026-09-08: 3 of 119 weekly digests carried nothing behind their provenance block.
               * Storing those every week fills a commissioner's history with files marked `ready`
               * that say nothing — and `ready` is a promise that there is something to open.
               *
               * ⚠ It is NOT aimed at small reports. 0 of 119 transaction summaries were empty; the
               * small ones are true statements about quiet leagues. See `countSubstantiveRows`.
               *
               * A person clicking Generate still gets the thin file: they asked a direct question,
               * and "there is nothing to report" is an honest answer they should be able to see.
               */
              const r = await generateReport(input.leagueId, template.id, 'Scheduled', scheduledFor, true)
              if (r.status === 'ready') produced.push(`${template.id} (${r.sizeBytes}B)`)
              else if (r.status === 'empty') empty.push(template.id)
              else failed.push(`${template.id}: ${r.failureReason ?? 'unknown'}`)
            }
            return { due: due.length, produced, empty, failed }
          },
        )

        if (!locked.ok) {
          return {
            status: 'skipped',
            message: `Another generation holds this league's lock (${locked.reason})`,
            metadata: { reason: 'lock_unavailable' },
          }
        }

        const { due, produced, empty, failed } = locked.value

        /*
         * Nothing due is the COMMON outcome and a completely healthy one — a weekly digest is due
         * one day in seven. Reporting it as a skip would make six days of correct behaviour look
         * like six days of the guard suppressing work, and Automation Center reads `skipped`
         * counts. It completes, and says what it found.
         */
        /*
         * A per-report failure does NOT fail the job. The generation was attempted and its outcome
         * recorded as a `failed` row carrying its reason — that row is the durable record. Failing
         * the job as well would double-count one failure and, worse, mark the job for retry, which
         * would regenerate the reports that succeeded alongside it.
         */
        return {
          status: 'completed',
          /*
           * `empty` is reported separately from `produced` and from `due`, because the three are
           * different facts: what was owed, what was written, and what was checked and found to
           * have nothing to say. Collapsing the last into either of the others is what would make
           * "this league generates no reports" indistinguishable from "this league is not covered".
           */
          message:
            due === 0
              ? 'Nothing due'
              : `${produced.length} generated${empty.length ? `, ${empty.length} empty (not stored)` : ''}${failed.length ? `, ${failed.length} failed` : ''}`,
          metadata: { due, produced, empty, failed },
        }
      } catch (error) {
        throw new RetryableAutomationError(
          `${REPORTS_JOB_TYPE} failed for ${input.leagueId}: ${toErrorMessage(error)}`,
        )
      }
    },
  )
}

export interface GenerateScheduledReportsBatchResult {
  enabled: boolean
  discovered: number
  completed: number
  skipped: number
  failed: number
  generated: number
}

/**
 * The scheduled sweep.
 *
 * ⚠ IT REUSES THE WORKSPACE JOB'S DISCOVERY DELIBERATELY. "Leagues with imported activity, least
 * recently touched first" is the same population and the same fairness problem — and a second
 * discovery would be a second definition of "which leagues exist", free to drift from the first.
 * One definition, two consumers.
 */
export async function generateScheduledReportsBatch(options?: {
  limit?: number
  now?: Date
  leagueId?: string
}): Promise<GenerateScheduledReportsBatchResult> {
  // Same gate as the store's own reads: code must not touch a table whose migration may be unapplied.
  if (!(await isLiveReady('reports'))) {
    return { enabled: false, discovered: 0, completed: 0, skipped: 0, failed: 0, generated: 0 }
  }

  const due = await discoverWorkspaceRefreshLeagues(options)
  const result: GenerateScheduledReportsBatchResult = {
    enabled: true,
    discovered: due.length,
    completed: 0,
    skipped: 0,
    failed: 0,
    generated: 0,
  }

  for (const league of due) {
    try {
      const outcome = await generateScheduledReportsForLeague({
        leagueId: league.leagueId,
        scheduledFor: league.scheduledFor,
      })
      if (outcome.status === 'completed') result.completed += 1
      else if (outcome.status === 'skipped') result.skipped += 1
      else result.failed += 1
      const produced = (outcome.metadata as { produced?: string[] } | undefined)?.produced
      if (Array.isArray(produced)) result.generated += produced.length
    } catch {
      // One league's failure must not end the batch — the run row should say what happened across
      // all of them, not stop at the first bad one.
      result.failed += 1
    }
  }

  return result
}
