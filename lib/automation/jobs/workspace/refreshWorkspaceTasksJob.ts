/**
 * Commissioner Workspace's task scan, as an orchestrated automation job.
 *
 * Reuses the same envelope the waiver job does — `runAutomationJob` for the durable
 * `AutomationJob` / `AutomationRun` ledger and idempotency, `withAutomationLock` for the
 * per-league mutex — so this appears in `automation_runs` on exactly the same terms as every
 * other job, and the Automation Center can read one ledger rather than two.
 *
 * See `discoverWorkspaceRefreshLeagues.ts` for why the engine had been idle since 2026-06-21 and
 * why this job is what ends that.
 */

import { runAutomationJob } from '@/lib/automation/engine'
import { RetryableAutomationError, toErrorMessage } from '@/lib/automation/errors'
import {
  buildWorkspaceRefreshIdempotencyKey,
  discoverWorkspaceRefreshLeagues,
  WORKSPACE_REFRESH_JOB_TYPE,
} from '@/lib/automation/jobs/workspace/discoverWorkspaceRefreshLeagues'
import { withAutomationLock } from '@/lib/automation/locks'
import type { AutomationResult } from '@/lib/automation/types'
import { reconcileLeagueTasks } from '@/lib/commissioner-workspace/taskStore'
// A config read, not a UI dependency: `isLiveReady` is a thin wrapper over the DB-backed
// `platform_config` toggle, and sharing it is what keeps the flag's key defined in one place.
import { isLiveReady } from '@/lib/commissioner-ui/liveReadiness'

export interface RefreshWorkspaceTasksInput {
  leagueId: string
  scheduledFor?: Date
  trigger?: 'scheduled' | 'manual' | 'admin'
}

/**
 * One league's scan.
 *
 * ⚠ THE HANDLER REPORTS WHAT CHANGED, NOT MERELY THAT IT RAN. `metadata` carries the reconcile
 * counts, so a run row can distinguish "scanned, nothing to report" from "opened two findings" —
 * which is the difference between a healthy quiet system and one that is not looking. A ledger of
 * runs that all say `completed` and nothing else is the automation equivalent of a green check
 * that has never gone red.
 */
export async function refreshWorkspaceTasksForLeague(
  input: RefreshWorkspaceTasksInput,
): Promise<AutomationResult & { jobId: string; runId: string }> {
  const scheduledFor = input.scheduledFor ?? new Date()
  const idempotencyKey = buildWorkspaceRefreshIdempotencyKey(input.leagueId, scheduledFor)

  return runAutomationJob(
    {
      leagueId: input.leagueId,
      jobType: WORKSPACE_REFRESH_JOB_TYPE,
      idempotencyKey,
      metadata: { trigger: input.trigger ?? 'scheduled', scheduledFor: scheduledFor.toISOString() },
    },
    async (ctx) => {
      try {
        const locked = await withAutomationLock(
          `workspace:tasks:${input.leagueId}`,
          // The owner is the run's own job id, so a stuck lock names the run that took it. The TTL
          // is generous relative to the work (two reads and a handful of writes) because expiring
          // early is what lets two scans interleave on one league.
          { owner: ctx.jobId, ttlMs: 120_000 },
          () => reconcileLeagueTasks(input.leagueId, scheduledFor),
        )

        /*
         * Losing the lock is not a failure and must not be recorded as one — another invocation is
         * already scanning this league, which is the lock working. `skipped` is the honest status,
         * and it is what stops a contended league accumulating false `failed` rows that would make
         * the Automation Center's health read red over a healthy system.
         */
        if (!locked.ok) {
          return {
            status: 'skipped',
            message: `Another scan holds this league's lock (${locked.reason})`,
            metadata: { reason: 'lock_unavailable', lockReason: locked.reason },
          }
        }
        const outcome = locked.value

        /*
         * A scan that found nothing is a real, useful outcome — it is what closes yesterday's
         * findings and what lets the read path say "we looked" rather than showing an empty queue
         * of unknown provenance. So it completes; it does not report itself as skipped.
         */
        const touched = outcome.opened + outcome.changed + outcome.autoResolved
        return {
          status: 'completed',
          message:
            touched === 0
              ? `No change — ${outcome.detected} condition(s) still open, nothing new`
              : `${outcome.opened} opened, ${outcome.changed} changed, ${outcome.autoResolved} auto-resolved`,
          metadata: { ...outcome },
        }
      } catch (error) {
        /*
         * Retryable on purpose: everything this handler can fail on is a database round trip, and
         * the reconcile is idempotent by construction — re-running it converges on the same rows.
         * A fatal classification here would strand a league's task list on one transient blip.
         */
        throw new RetryableAutomationError(
          `workspace.refreshTasks failed for ${input.leagueId}: ${toErrorMessage(error)}`,
        )
      }
    },
  )
}

export interface RefreshWorkspaceTasksBatchResult {
  /** False when the module is not live-ready — nothing was discovered and nothing was written. */
  enabled: boolean
  discovered: number
  completed: number
  skipped: number
  failed: number
  leagues: { leagueId: string; status: string; message?: string }[]
}

/**
 * The scheduled entry point: discover due leagues and scan each.
 *
 * ⚠ ONE LEAGUE'S FAILURE MUST NOT END THE BATCH. The waiver job's own history is the argument —
 * a discovery that yields nothing leaves no trace anyone reads, and a batch that aborts on its
 * first bad league looks identical to one that had no work. Each league is settled on its own and
 * counted, so the run row says what actually happened across all of them.
 */
export async function refreshWorkspaceTasksBatch(options?: {
  limit?: number
  now?: Date
  leagueId?: string
}): Promise<RefreshWorkspaceTasksBatchResult> {
  /*
   * 🛑 THE GATE IS HERE, NOT IN THE CRON ROUTE, BECAUSE CODE SHIPPING AHEAD OF ITS MIGRATION DOES
   * NOT NO-OP. `commissioner_workspace_tasks` arrives in migration 20260908120000, and applying a
   * migration to production is the user's decision — root CLAUDE.md, "A MIGRATION IS NOT PUSHABLE
   * WORK". Landing this code before that decision is made is safe ONLY if nothing writes: against
   * a database without the table, `reconcileLeagueTasks` raises Prisma P2021, and the scheduled job
   * would fail every day until somebody read the logs.
   *
   * `commissioner_os_live_ready_workspace` is therefore one switch for the whole feature — the page
   * and the job come alive together, and neither can be live while the other is not. Guarding the
   * route instead would leave an admin trigger or a script able to hit the missing table.
   */
  if (!(await isLiveReady('workspace'))) {
    return { enabled: false, discovered: 0, completed: 0, skipped: 0, failed: 0, leagues: [] }
  }

  const due = await discoverWorkspaceRefreshLeagues(options)

  const result: RefreshWorkspaceTasksBatchResult = {
    enabled: true,
    discovered: due.length,
    completed: 0,
    skipped: 0,
    failed: 0,
    leagues: [],
  }

  for (const league of due) {
    try {
      const outcome = await refreshWorkspaceTasksForLeague({
        leagueId: league.leagueId,
        scheduledFor: league.scheduledFor,
      })
      if (outcome.status === 'completed') result.completed += 1
      else if (outcome.status === 'skipped') result.skipped += 1
      else result.failed += 1
      result.leagues.push({
        leagueId: league.leagueId,
        status: outcome.status,
        message: outcome.message,
      })
    } catch (error) {
      result.failed += 1
      result.leagues.push({
        leagueId: league.leagueId,
        status: 'failed',
        message: toErrorMessage(error),
      })
    }
  }

  return result
}
