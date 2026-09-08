import { isLiveReady } from '../../liveReadiness'
import {
  readAutomationAggregates,
  readAutomationRuns,
  type AutomationLedgerAggregate,
} from '@/lib/commissioner-automations/automationLedgerReads'
import type {
  AutomationCatalogEntry,
  AutomationClient,
  AutomationExecutionEntry,
  AutomationExecutionResult,
  AutomationSummary,
} from './types'
import type { SeverityTier } from '../../tokens/colors'

/**
 * Automation Center, wired to the real automation ledger.
 *
 * ── WHAT PHASE 3.9 CONCLUDED, AND WHICH HALF OF IT STILL HOLDS ───────────────────────────────
 *
 * This module declined to wire and gave two reasons. The first — Decision OS has no automation
 * catalog, schedule or execution-history concept anywhere, confirmed by repository-wide search —
 * is still true and is not being worked around. The second was that the real engine in
 * `lib/automation/` was unusable here because "none of its job types correspond to anything in
 * this contract".
 *
 * That was accurate when written and is no longer true. `workspace.refreshTasks` is a job type
 * that fits the canon's own definition of what may be automated — repetitive, low-stakes league
 * housekeeping, never a trade approval, member removal or rule ratification — so the catalog now
 * describes real automations rather than borrowing a system that happened to be nearby.
 *
 * ── WHAT A COMMISSIONER SEES, AND WHY IT IS NOT FLATTERING ───────────────────────────────────
 *
 * 🛑 THE CATALOG SHOWS THE WAIVER AUTOMATION'S REAL STATE, WHICH IS THAT IT HAS NOT FIRED SINCE
 * 2026-06-21. Measured on production 2026-09-08: 251 runs, 249 of them `skipped`, one job type.
 * The engine is healthy; the job is pointed at `WaiverClaim` rows that no imported league ever
 * writes. Hiding that entry would make this page a nicer screenshot and a worse product — a
 * commissioner whose waiver automation stopped in June should find that out here.
 *
 * ⚠ AND THE HEALTH SIGNAL DELIBERATELY DOES NOT TREAT `skipped` AS FAILURE. A skip is the
 * idempotency guard doing its job — the same day's work already done — so counting it as a
 * failure would paint a correctly-behaving system red. Staleness is what carries that finding
 * instead, and it is a separate axis from the success rate.
 */

/**
 * The catalog metadata that is NOT in the database: what each job type is called, what it does,
 * and what schedule drives it.
 *
 * ⚠ THIS IS A DESCRIPTION OF CODE THAT EXISTS, NOT A CONFIGURATION. Each entry names a job type
 * with a real handler and a real scheduled caller in this repository; the counts, timings and
 * health beside it all come from the ledger. A job type appearing in `automation_runs` with no
 * entry here is still shown — see `describe()` — because silently dropping a running automation
 * from its own catalog is how a system starts lying about what it does.
 */
const CATALOG_METADATA: Record<
  string,
  Pick<AutomationCatalogEntry, 'name' | 'description' | 'category'> & { scheduleDescription: string }
> = {
  'workspace.refreshTasks': {
    name: 'League task scan',
    description:
      'Checks each league for conditions a commissioner should know about — a feed that has stopped arriving, managers who have gone quiet — and keeps the Workspace task list current. Closes tasks on its own when the condition clears.',
    category: 'compliance_reminders',
    scheduleDescription: 'Daily, one scan per league',
  },
  'waivers.processLeague': {
    name: 'Waiver batch processing',
    description:
      'Settles pending waiver claims for leagues that run batched waivers, in FAAB or rolling-priority order. Only applies to leagues whose waivers are run by AllFantasy — an imported league settles its waivers on its own platform, so this never has work to do for one.',
    category: 'waiver_management',
    scheduleDescription: 'Daily, for leagues with pending claims',
  },
}

const STALE_AFTER_DAYS = 3

function describe(jobType: string) {
  return (
    CATALOG_METADATA[jobType] ?? {
      name: jobType,
      description:
        'This automation has run on the platform but is not described in the Automation Center catalog yet.',
      category: 'scheduling' as const,
      scheduleDescription: 'Unknown — no catalog entry for this job type',
    }
  )
}

function toResult(status: string | null): AutomationExecutionResult | undefined {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'failure'
  if (status === 'skipped') return 'skipped'
  return undefined
}

/**
 * Health is two questions, not one: is it succeeding when it runs, and is it running at all?
 *
 * 🛑 THE SECOND QUESTION IS THE ONE THIS PLATFORM ACTUALLY FAILED. Judged on success rate alone,
 * `waivers.processLeague` scores perfectly — 2 completed, 0 failed, 249 skipped — while having
 * been silent for eleven weeks. A health signal that reads "healthy" over that is worse than no
 * signal, because it is cited as evidence.
 */
function healthOf(aggregate: AutomationLedgerAggregate, now: Date): SeverityTier {
  const attempted = aggregate.successCount + aggregate.failureCount

  if (aggregate.totalRuns === 0) return 'advisory'

  if (!aggregate.lastRunAt) return 'elevated'
  const daysSince = Math.floor((now.getTime() - aggregate.lastRunAt.getTime()) / 86_400_000)
  if (daysSince > STALE_AFTER_DAYS * 7) return 'critical'
  if (daysSince > STALE_AFTER_DAYS) return 'elevated'

  if (attempted === 0) return 'standard'
  const successRate = aggregate.successCount / attempted
  if (successRate < 0.5) return 'critical'
  if (successRate < 0.9) return 'elevated'
  return 'positive'
}

/**
 * Success rate over ATTEMPTS, not over runs.
 *
 * ⚠ Dividing by `totalRuns` would put the 249 skips in the denominator and report the waiver
 * automation at 0.8% — a number that reads as catastrophic failure about a job that has never
 * failed once. A skip is not an attempt, so it is not in the denominator; that it has barely
 * attempted anything is the staleness finding, reported on its own axis above.
 */
function successRatePercent(aggregate: AutomationLedgerAggregate): number {
  const attempted = aggregate.successCount + aggregate.failureCount
  if (attempted === 0) return 0
  return Math.round((aggregate.successCount / attempted) * 100)
}

function toCatalogEntry(aggregate: AutomationLedgerAggregate, now: Date): AutomationCatalogEntry {
  const meta = describe(aggregate.jobType)
  const lastRunResult = toResult(aggregate.lastRunStatus)

  return {
    id: aggregate.jobType,
    name: meta.name,
    description: meta.description,
    category: meta.category,
    /*
     * `enabled` means "there is a scheduled caller for this job type in this deployment", which is
     * a fact about the code. There is no per-commissioner on/off switch for these yet, and
     * rendering a toggle that controls nothing would be the more damaging kind of fiction.
     */
    status: 'enabled',
    health: healthOf(aggregate, now),
    schedule: { triggerType: 'schedule', description: meta.scheduleDescription },
    ...(aggregate.lastRunAt ? { lastRunAt: aggregate.lastRunAt.toISOString() } : {}),
    ...(lastRunResult ? { lastRunResult } : {}),
    totalRunsCount: aggregate.totalRuns,
    successRatePercent: successRatePercent(aggregate),
    relatedLinks:
      aggregate.jobType === 'workspace.refreshTasks'
        ? [{ moduleId: 'workspace' as const, label: 'Workspace', href: '/commissioner-os/workspace' }]
        : [],
  }
}

function notYetIntegrated(message: string) {
  return {
    category: 'upstream_unavailable' as const,
    message,
    moduleId: 'automations' as const,
    retryable: false,
    timestamp: new Date().toISOString(),
  }
}

async function catalogEntries(now: Date): Promise<AutomationCatalogEntry[]> {
  const aggregates = await readAutomationAggregates()
  return aggregates
    .map((aggregate) => toCatalogEntry(aggregate, now))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export const liveAutomationClient: AutomationClient = {
  async getCatalog() {
    const timestamp = new Date().toISOString()
    if (!(await isLiveReady('automations'))) {
      return {
        data: null,
        error: notYetIntegrated('The live Decision OS backend is not yet integrated in this environment.'),
        source: 'live',
        timestamp,
      }
    }

    const data = await catalogEntries(new Date())

    /*
     * An empty ledger means no automation has ever run on this deployment. That is a real and
     * reportable state, but it is NOT "you have no automations" — the handlers and their schedules
     * exist in the code either way. Returning `[]` would render as an empty catalog and read as
     * the first claim, so the honest error is returned instead.
     */
    if (data.length === 0) {
      return {
        data: null,
        error: notYetIntegrated(
          'No automation has run on this deployment yet, so there is no execution history to describe.',
        ),
        source: 'live',
        timestamp,
      }
    }

    return { data, error: null, source: 'live', timestamp }
  },

  async getExecutionHistory(automationId: string) {
    const timestamp = new Date().toISOString()
    if (!(await isLiveReady('automations'))) {
      return {
        data: null,
        error: notYetIntegrated('The live Decision OS backend is not yet integrated in this environment.'),
        source: 'live',
        timestamp,
      }
    }

    const runs = await readAutomationRuns(automationId)

    const data: AutomationExecutionEntry[] = runs.map((run) => {
      const result = toResult(run.status) ?? 'failure'
      const meta =
        run.metadata && typeof run.metadata === 'object' && !Array.isArray(run.metadata)
          ? (run.metadata as Record<string, unknown>)
          : {}
      const message = typeof meta.message === 'string' ? meta.message : null

      return {
        id: run.id,
        automationId: run.jobType,
        startedAt: run.startedAt.toISOString(),
        // A run killed mid-flight never wrote a duration. Zero is the honest reading of "we do
        // not know how long it took", and the list shows the result rather than the timing.
        durationMs: run.durationMs ?? 0,
        result,
        summary:
          message ??
          run.errorMessage ??
          (result === 'skipped' ? 'Skipped — already completed for this window' : 'Completed'),
        detail:
          run.errorMessage ??
          message ??
          (run.leagueId ? `League ${run.leagueId}` : 'Platform-wide run'),
      }
    })

    return { data, error: null, source: 'live', timestamp }
  },

  async getSummary() {
    const timestamp = new Date().toISOString()
    if (!(await isLiveReady('automations'))) {
      return {
        data: null,
        error: notYetIntegrated('The live Decision OS backend is not yet integrated in this environment.'),
        source: 'live',
        timestamp,
      }
    }

    const entries = await catalogEntries(new Date())
    if (entries.length === 0) {
      return {
        data: null,
        error: notYetIntegrated(
          'No automation has run on this deployment yet, so there is no execution history to describe.',
        ),
        source: 'live',
        timestamp,
      }
    }

    const needsAttention = entries.filter((e) => e.health === 'critical' || e.health === 'elevated')

    const data: AutomationSummary = {
      totalCount: entries.length,
      activeCount: entries.filter((e) => e.status === 'enabled').length,
      needsAttentionCount: needsAttention.length,
      /*
       * The headline names WHICH automation needs attention rather than counting them. "1 needs
       * attention" sends a commissioner looking; "Waiver batch processing has not run in 79 days"
       * is the finding itself, and Mission Control has room for exactly one sentence.
       */
      headline:
        needsAttention.length === 0
          ? `${entries.length} automation${entries.length === 1 ? '' : 's'} running normally`
          : needsAttention.length === 1
            ? `${needsAttention[0].name} needs attention`
            : `${needsAttention[0].name} and ${needsAttention.length - 1} other${needsAttention.length === 2 ? '' : 's'} need attention`,
    }

    return { data, error: null, source: 'live', timestamp }
  },
}
