import type { ReportsClient } from './types'

/**
 * Phase 3.11 — Reports audited against the established pattern (Mission
 * Control, League Health, Manager Intelligence, Recommendations Center,
 * Commissioner Workspace, Automation Center, League Analytics) and found to
 * be a **full structural absence**, like Workspace (3.8) and Automation
 * Center (3.9) — not the partial-real outcome League Analytics (3.10) had.
 *
 * Reports' own doc comment already states its actual job: "Scheduled,
 * shareable, printable packaging of intelligence already owned elsewhere —
 * never a second copy of the underlying data." That packaging layer —
 * `status` (`queued`/`generating`/`ready`/`failed`, a persisted generation-
 * job lifecycle), `format`, `generatedAt` (of the artifact, not of a
 * request), `generatedByLabel`, `sizeLabel`, `shareStatus`/`shareLink`,
 * `failureReason` — has no Decision OS analog anywhere, ported or excluded:
 * confirmed by a repository-wide search for report/export/template/csv/pdf
 * concepts across `lib/decision-os/`, including `phase6/`, and by checking
 * `prisma/schema.prisma` for any `ReportTemplate`/`GeneratedReport`-shaped
 * model — none exists. This is a persisted-artifact system, the same
 * structural class of gap as Automation Center's execution log, not a
 * porting gap.
 *
 * The Phase 3.10 "is `[]` an honest value" test was applied here and does
 * **not** rescue either `getTemplates()` or `getHistory()`, even though both
 * return arrays: an empty array is only honest when it means "we checked
 * and there is genuinely nothing here" as a supplementary fact inside an
 * otherwise-real response (League Analytics' `competitiveBalance: []`
 * alongside real `kpis`). Here, the array *is* the entire payload — an
 * empty `getTemplates()`/`getHistory()` would misrepresent "we have no way
 * to check" as "you have configured zero report templates" / "generated
 * zero reports," a materially different and potentially false claim (the
 * demo fixture's 4 templates and 5 history entries are real, designed
 * product content, not proof of "usually zero"). The generic
 * `notYetIntegrated()` error communicates the true state; an empty array
 * would not.
 *
 * Constructing a report "live," summarizing real data from `/league` or
 * Recommendations Center on the fly, was considered and rejected: doing so
 * would still require fabricating `status`, `generatedAt` (of a generation
 * event that never happened), `format`, `sizeLabel`, and `shareLink` — every
 * one of Reports' own defining fields — which is exactly the invention this
 * phase's constraints (and this whole program) forbid.
 *
 * No active-league resolution is attempted — every field here is either
 * static catalog metadata or persisted-artifact metadata, neither of which
 * needs a league lookup. This module does not become a sixth consumer of
 * `resolveActiveLeagueId()` (now extracted to
 * `lib/commissioner-ui/resolveActiveLeagueId.ts` in this same phase, once
 * this audit confirmed Reports wouldn't need a sixth copy — see
 * REPORTS_LIVE_INTEGRATION_REPORT.md).
 */
function notYetIntegrated() {
  return {
    category: 'upstream_unavailable' as const,
    message: 'The live Decision OS backend is not yet integrated in this environment.',
    moduleId: 'reports' as const,
    retryable: false,
    timestamp: new Date().toISOString(),
  }
}

export const liveReportsClient: ReportsClient = {
  async getTemplates() {
    return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
  },
  async getHistory() {
    return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
  },
  async getSummary() {
    return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
  },
}
