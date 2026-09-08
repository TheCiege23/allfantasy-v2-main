import { prisma } from '@/lib/prisma'

/**
 * The real automation ledger — `automation_jobs` / `automation_runs` — read for Automation Center.
 *
 * ── WHY THIS IS NOW REACHABLE WHEN PHASE 3.9 SAID IT WAS NOT ─────────────────────────────────
 *
 * `lib/commissioner-ui/automations/decision-os-client/live.ts` declined to wire this module and
 * argued, correctly, that Decision OS has no automation catalog, schedule or execution history
 * anywhere. It also identified the engine that DOES exist — `lib/automation/` plus the
 * `AutomationJob`/`AutomationRun`/`AutomationAuditLog` tables — and set it aside for two stated
 * reasons: none of its job types corresponded to anything in the commissioner-facing contract, and
 * reading it would bypass the Decision OS transport.
 *
 * The first reason has been removed rather than waived. `workspace.refreshTasks` is a job type
 * that IS a commissioner-facing automation in the canon's own terms — repetitive, low-stakes
 * league housekeeping, never a trade approval or a member removal — so the catalog now describes
 * something that genuinely belongs in it. The second is a boundary this module was already
 * crossing everywhere else on the same terms: League Analytics reads Postgres directly through
 * `lib/league-history/`, which the repo's own DB-first guard asks for.
 *
 * ── WHAT THE ENGINE'S OWN HISTORY SAYS, AND WHY THE CATALOG MUST SHOW IT ─────────────────────
 *
 * Measured on production 2026-09-08: 251 runs, all `waivers.processLeague`, newest 2026-06-21,
 * 249 of them `skipped`. That is not a broken engine — it is one job pointed at `WaiverClaim`
 * rows with `status = 'pending'`, a table that is empty platform-wide because every league here is
 * an import and imports never write AF-native waiver claims.
 *
 * 🛑 SO THE CATALOG REPORTS THE WAIVER AUTOMATION HONESTLY RATHER THAN HIDING IT. A catalog that
 * showed only the healthy job would be a nicer screenshot and a worse product: a commissioner
 * whose waiver automation has not fired since June is entitled to see that, and `lastRunAt` is
 * how they find out.
 *
 * ⚠ NO `findUnique` BELOW. Its `where` takes only unique fields, so it cannot carry a soft-delete
 * filter — the same reason `lib/league-history/leagueWarehouseReads.ts` gives.
 */

export interface AutomationLedgerAggregate {
  jobType: string
  totalRuns: number
  successCount: number
  failureCount: number
  skippedCount: number
  lastRunAt: Date | null
  lastRunStatus: string | null
}

export interface AutomationLedgerRun {
  id: string
  jobType: string
  leagueId: string | null
  startedAt: Date
  durationMs: number | null
  status: string
  errorMessage: string | null
  metadata: unknown
}

/**
 * Per-job-type totals across the whole ledger.
 *
 * ⚠ `leagueId` IS OPTIONAL AND THAT IS DELIBERATE. An automation's health is a property of the
 * automation, not of one league — a job failing on every league is the same finding whichever
 * league you happen to be viewing. Scoping the aggregate to the active league would make a
 * platform-wide outage look like a local quirk, and would report "never run" for a healthy
 * automation that simply has not reached this league yet.
 */
export async function readAutomationAggregates(): Promise<AutomationLedgerAggregate[]> {
  const grouped = await prisma.automationRun.groupBy({
    by: ['jobType', 'status'],
    _count: { _all: true },
    _max: { startedAt: true },
  })

  const byType = new Map<string, AutomationLedgerAggregate>()
  for (const row of grouped) {
    const entry = byType.get(row.jobType) ?? {
      jobType: row.jobType,
      totalRuns: 0,
      successCount: 0,
      failureCount: 0,
      skippedCount: 0,
      lastRunAt: null,
      lastRunStatus: null,
    }

    const count = row._count._all
    entry.totalRuns += count
    if (row.status === 'completed') entry.successCount += count
    else if (row.status === 'skipped') entry.skippedCount += count
    else if (row.status === 'failed') entry.failureCount += count

    const at = row._max.startedAt
    if (at && (!entry.lastRunAt || at.getTime() > entry.lastRunAt.getTime())) {
      entry.lastRunAt = at
      entry.lastRunStatus = row.status
    }

    byType.set(row.jobType, entry)
  }

  return [...byType.values()].sort((a, b) => a.jobType.localeCompare(b.jobType))
}

/** Recent runs for one job type, newest first. */
export async function readAutomationRuns(jobType: string, limit = 25): Promise<AutomationLedgerRun[]> {
  const rows = await prisma.automationRun.findMany({
    where: { jobType },
    orderBy: { startedAt: 'desc' },
    take: Math.min(100, Math.max(1, limit)),
    select: {
      id: true,
      jobType: true,
      leagueId: true,
      startedAt: true,
      durationMs: true,
      status: true,
      errorMessage: true,
      metadata: true,
    },
  })
  return rows
}
