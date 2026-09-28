import 'server-only'

import { createRunBudget, rotateForFairness } from '@/lib/cron/runBudget'
import { recordSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { runTradeAgentForLeague, tradeAgentLeagueIds } from './tradeAgent'
import { inAgentWindow, runDateOf } from './tradeAgentRules'
import { leaguesDoneTonight, tradeAgentTableReady } from './tradeAgentStore'

/**
 * One budgeted pass of the nightly trade agent over the leagues not yet done tonight.
 *
 * 🛑 NO CRON SLOT OF ITS OWN, ON PURPOSE. `cron-schedule.json` sits at its 60-job ceiling
 * (`scripts/cron-budget-check.mjs`), and docs/crons.md says to extend an existing handler first. The
 * hourly housekeeping job (`/api/cron/reap-sync-runs`) calls this AFTER recording its own heartbeat,
 * so a slow or failing pass can never delay or fail the reap. Outside 03:00–10:59 UTC it returns at
 * once; inside, the hourly fire gives about eight passes a night, and each skips a league that already
 * has tonight's suggestions and rotates which league leads, so the passes cover the list between them.
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
      visited: number
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
  const [all, done] = await Promise.all([tradeAgentLeagueIds(), leaguesDoneTonight(runDate)])
  const queue = rotateForFairness(
    all.filter((id) => !done.has(id)),
    ROTATION_PERIOD_MS,
    () => now.getTime(),
  )

  let visited = 0
  let failed = 0
  let managers = 0
  let graded = 0
  let saved = 0
  const errors: string[] = []
  for (const leagueId of queue) {
    if (budget.exhausted()) break
    visited += 1
    try {
      const r = await runTradeAgentForLeague(leagueId, runDate, { shouldStop: () => budget.exhausted() })
      managers += r.managers
      graded += r.graded
      saved += r.saved
    } catch (error) {
      failed += 1
      if (errors.length < 5) errors.push(`${leagueId}: ${error instanceof Error ? error.message.slice(0, 120) : 'failed'}`)
    }
  }
  const stoppedEarly = visited < queue.length

  await recordSyncJobRun(
    { jobName: JOB, trigger: 'cron' },
    {
      rowsRead: visited,
      rowsWritten: saved,
      errors,
      ...(stoppedEarly || failed > 0 ? { status: 'partial' as const } : {}),
      metadata: { runDate, eligible: all.length, alreadyDone: done.size, managers, graded },
    },
    Date.now() - startedAt,
  ).catch(() => {})

  return { ran: true, runDate, eligible: all.length, alreadyDone: done.size, visited, failed, managers, graded, saved, stoppedEarly }
}
