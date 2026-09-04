import type { AutomationClient } from './types'

/**
 * Phase 3.9 — Automation Center audited against the established pattern
 * (Mission Control, League Health, Manager Intelligence, Recommendations
 * Center, Commissioner Workspace) and, like Workspace in Phase 3.8, found
 * to have **no partial real wiring worth attempting** — every field of
 * `AutomationCatalogEntry`/`AutomationExecutionEntry`/`AutomationSummary`
 * (`status`, `health`, `schedule`, `lastRunAt`/`lastRunResult`,
 * `totalRunsCount`, `successRatePercent`, execution `startedAt`/
 * `durationMs`/`result`, every aggregate count) describes a persisted,
 * per-commissioner-automation catalog and run history. Decision OS has no
 * analog anywhere: not in the currently-ported Intelligence API, and not
 * in any unported Phase 6 classifier — confirmed by a repository-wide
 * search across `lib/decision-os/`, including `phase6/`, for automation/
 * schedule/trigger/execution-history/workflow concepts. The only
 * superficially similar term, `automation_capable: boolean` on Decision
 * OS's core `Decision<TAction>` object (`lib/decision-os/core/decision.ts`
 * on `g15-event-foundation`), is a categorically different thing — a
 * per-decision flag meaning "could a future automation execute this
 * action" (always `false` for trades/waivers/commissioner actions,
 * `true` only for lineup auto-sub), never a catalog, schedule, or
 * execution log, and it isn't even part of the approved port.
 *
 * A real, separate automation *job engine* does exist in this
 * repository (`lib/automation/` + Prisma `AutomationJob`/`AutomationRun`/
 * `AutomationAuditLog`) — but it is main-application infrastructure, not
 * a Decision OS capability: an admin-only, system-level background-job
 * orchestrator (`waivers.processLeague`, `draft.tick`, `scoring.sync`,
 * `trades.process`, `leagueConcept.*`, `notifications.dispatch`), not
 * reachable through `callDecisionOS`, and conceptually unrelated to this
 * module's commissioner-facing automation catalog (trade-deadline
 * reminders, lineup-lock reminders, welcome messages) — none of its job
 * types correspond to anything in this contract. Wiring to it would both
 * bypass the Decision OS transport layer and require a new backend
 * surface, both out of scope for this phase. See
 * AUTOMATION_CENTER_LIVE_INTEGRATION_REPORT.md for the full audit.
 *
 * No functional change from the pre-Phase-3.9 placeholder — this is a
 * documented conclusion, not a missed opportunity.
 */
function notYetIntegrated() {
  return {
    category: 'upstream_unavailable' as const,
    message: 'The live Decision OS backend is not yet integrated in this environment.',
    moduleId: 'automations' as const,
    retryable: false,
    timestamp: new Date().toISOString(),
  }
}

export const liveAutomationClient: AutomationClient = {
  async getCatalog() {
    return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
  },
  async getExecutionHistory() {
    return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
  },
  async getSummary() {
    return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
  },
}
