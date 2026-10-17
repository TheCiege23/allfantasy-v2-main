import 'server-only'

import { createRunBudget, rotateForFairness } from '@/lib/cron/runBudget'
import { recordSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { runTradeAgentForLeague, tradeAgentLeagueIds } from './tradeAgent'
import { inAgentWindow, runDateOf } from './tradeAgentRules'
import { leaguesDoneTonight, leaguesVisitedTonight, markLeaguesVisited, tradeAgentTableReady } from './tradeAgentStore'

/**
 * One budgeted pass of the nightly trade agent over the leagues not yet done tonight.
 *
 * 🛑 NO CRON SLOT OF ITS OWN, ON PURPOSE. `cron-schedule.json` sits at its 60-job ceiling
 * (`scripts/cron-budget-check.mjs`), and docs/crons.md says to extend an existing handler first. The
 * hourly housekeeping job (`/api/cron/reap-sync-runs`) calls this AFTER recording its own heartbeat,
 * so a slow or failing pass can never delay or fail the reap. Outside 03:00–10:59 UTC it returns at
 * once; inside, the hourly fire gives about eight passes a night, and each skips a league that already
 * has tonight's suggestions OR that an earlier pass visited in full, and rotates which league leads, so
 * the passes cover the list between them and then stop grading it. A league whose visit the budget cut
 * short, or that threw, is not marked and is retried next hour (see `markLeaguesVisited`).
 *
 * Does nothing until `20260928000000_trade_agent_suggestions` is applied (`tradeAgentTableReady`).
 */

const JOB = 'cron-trade-agent'
/** One hour: each nightly pass puts a different league first. */
const ROTATION_PERIOD_MS = 60 * 60 * 1000

export type TradeAgentPassResult =
  | { ran: false; reason: string }
  | {
      ran: true
      runDate: string
      eligible: number
      alreadyDone: number
      /** Leagues an earlier pass visited in full tonight, skipped without a suggestion. */
      alreadyVisited: number
      visited: number
      /** Leagues this pass completed and recorded as visited. */
      marked: number
      failed: number
      managers: number
      graded: number
      saved: number
      stoppedEarly: boolean
    }

export async function runTradeAgentPass(opts: { now?: Date; budgetMs: number; force?: boolean }): Promise<TradeAgentPassResult> {
  const now = opts.now ?? new Date()
  if (!opts.force && !inAgentWindow(now)) return { ran: false, reason: 'outside the nightly window' }
  if (opts.budgetMs <= 5_000) return { ran: false, reason: 'no time left in this run' }
  if (!(await tradeAgentTableReady())) return { ran: false, reason: 'trade_agent_suggestions does not exist yet — the migration is not applied' }

  const startedAt = Date.now()
  const budget = createRunBudget(opts.budgetMs)
  const runDate = runDateOf(now)
  const [all, done, seen] = await Promise.all([tradeAgentLeagueIds(), leaguesDoneTonight(runDate), leaguesVisitedTonight(runDate)])
  const queue = rotateForFairness(
    all.filter((id) => !done.has(id) && !seen.has(id)),
    ROTATION_PERIOD_MS,
    () => now.getTime(),
  )

  let visited = 0
  let failed = 0
  let managers = 0
  let graded = 0
  let saved = 0
  const errors: string[] = []
  const completed: string[] = []
  for (const leagueId of queue) {
    if (budget.exhausted()) break
    visited += 1
    try {
      const r = await runTradeAgentForLeague(leagueId, runDate, { shouldStop: () => budget.exhausted() })
      managers += r.managers
      graded += r.graded
      saved += r.saved
      // Complete visits only: a league the budget interrupted is graded again next hour.
      if (!r.partial) completed.push(leagueId)
    } catch (error) {
      failed += 1
      if (errors.length < 5) errors.push(`${leagueId}: ${error instanceof Error ? error.message.slice(0, 120) : 'failed'}`)
    }
  }
  const stoppedEarly = visited < queue.length
  const markedOk = await markLeaguesVisited(runDate, completed, now)
  const marked = markedOk ? completed.length : 0

  await recordSyncJobRun(
    { jobName: JOB, trigger: 'cron' },
    {
      rowsRead: visited,
      rowsWritten: saved,
      errors,
      ...(stoppedEarly || failed > 0 ? { status: 'partial' as const } : {}),
      ...(markedOk ? {} : { warnings: ['could not record visited leagues — they will be graded again next pass'] }),
      metadata: { runDate, eligible: all.length, alreadyDone: done.size, alreadyVisited: seen.size, marked, managers, graded },
    },
    Date.now() - startedAt,
  ).catch(() => {})

  return {
    ran: true,
    runDate,
    eligible: all.length,
    alreadyDone: done.size,
    alreadyVisited: seen.size,
    visited,
    marked,
    failed,
    managers,
    graded,
    saved,
    stoppedEarly,
  }
}
