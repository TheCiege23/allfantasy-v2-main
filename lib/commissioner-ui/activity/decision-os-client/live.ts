import type { ActivityClient } from './types'
import type { CommissionerActivityEventContract } from '../../contracts'
import { isLiveReady } from '../../liveReadiness'
import { liveLeagueHealthClient } from '../../league-health/decision-os-client/live'
import { liveRecommendationsClient } from '../../recommendations/decision-os-client/live'
import { liveAutomationClient } from '../../automations/decision-os-client/live'
import { liveReportsClient } from '../../reports/decision-os-client/live'
import { liveWorkspaceClient } from '../../workspace/decision-os-client/live'
import { conditionToEventSeverity } from '../../notifications/decision-os-client/severityMapping'

/**
 * Phase 3.14 — Activity Stream, like Notification Center (3.13) and
 * Search (3.12), is a **composition layer**: its own contract doc comment
 * says it is "never a duplicate of any module's own evidence, workflow, or
 * audit log." `getEvents()` composes over five other modules' own
 * already-audited *live* clients — risks, recommendations, automations,
 * reports, workspace tasks — generalizing `demo.ts`'s narratively-curated
 * hardcoded single entries (`demo-rec-2` vs `demo-rec-3`, `demo-task-7` vs
 * `demo-task-8`, etc.) into real, field-based rules every real item can be
 * checked against:
 *
 * - Every risk → `risk_detected` (no real field distinguishes "kinds" of
 *   risk the way demo's single example implied).
 * - Every recommendation → `recommendation_created`. Demo's second type,
 *   `recommendation_automated`, was a narrative flourish with no
 *   corresponding real field (recommendations are always system-computed;
 *   there is no "manual vs. automated" distinction in
 *   `CommissionerRecommendationContract`) — collapsed to the one real,
 *   defensible type.
 * - Automations: `lastRunResult === 'failure'` → `automation_failed`;
 *   `'success'` → `automation_executed`; `'skipped'` or never-run
 *   contributes no event (nothing meaningfully happened yet to report).
 * - Reports: `status === 'failed'` → `report_failed`;
 *   `'ready'` → `report_generated`; `'queued'`/`'generating'` contribute no
 *   event (an activity stream logs what happened, not what's pending).
 * - Tasks: `status === 'completed'` → `task_completed`;
 *   `'archived'` → `task_archived`; every other status contributes no
 *   event (an open/in-progress task isn't a completed activity yet).
 *
 * `initiator` is `'system'` for every risk/recommendation/automation/
 * report event (all four are recomputed or system-executed, never
 * manually authored) and `'human'` for every task event — not a guess
 * about a specific person, but a structural fact about Workspace itself
 * (Phase 3.8's own conclusion: it is an exclusively commissioner-managed
 * task tracker with no automated completion mechanism anywhere).
 *
 * `timestamp` reuses each source's own real field where one exists
 * (`recommendation.createdAt`, `automation.lastRunAt`, `report.generatedAt`,
 * `task.updatedAt`) — the same honest-reinterpretation pattern used
 * throughout this program. `LeagueHealthRisk` has no timestamp field at
 * all; since `getRisks()` never actually succeeds today, this never arises
 * in practice, but falls back to the composition's own request time for
 * correctness, exactly like Notification Center's identical fallback.
 *
 * All five sources are, today, structurally unable to contribute (each
 * already concluded in its own phase's report to have no real analog for
 * its own required fields), so `getEvents()` returns `data: []` in every
 * environment right now — an honest success, not a placeholder, for the
 * identical reason established in Notification Center's report: an
 * activity stream entry is a recomputed observation about another
 * module's current state, never a persisted artifact whose absence could
 * misrepresent a commissioner's own irretrievable history. "0 recent
 * events" is a normal, true state for any stream with nothing new to
 * report, not a specific false claim.
 */
function notYetIntegrated() {
  return {
    category: 'upstream_unavailable' as const,
    message: 'The live Decision OS backend is not yet integrated in this environment.',
    moduleId: 'activity' as const,
    retryable: false,
    timestamp: new Date().toISOString(),
  }
}

export const liveActivityClient: ActivityClient = {
  async getEvents() {
    if (!(await isLiveReady('activity'))) {
      return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
    }
    const now = new Date().toISOString()

    const [risks, recommendations, automations, reportHistory, tasks] = await Promise.all([
      liveLeagueHealthClient.getRisks(),
      liveRecommendationsClient.getQueue(),
      liveAutomationClient.getCatalog(),
      liveReportsClient.getHistory(),
      liveWorkspaceClient.getTasks(),
    ])

    const events: CommissionerActivityEventContract[] = []

    for (const risk of risks.data ?? []) {
      events.push({
        id: `activity-${risk.id}`,
        type: 'risk_detected',
        sourceModuleId: 'league-health',
        severity: conditionToEventSeverity(risk.severity),
        initiator: 'system',
        summary: risk.description,
        evidenceHref: '/commissioner-os/league-health',
        timestamp: now,
      })
    }

    for (const rec of recommendations.data ?? []) {
      events.push({
        id: `activity-${rec.id}`,
        type: 'recommendation_created',
        sourceModuleId: 'recommendations',
        severity: conditionToEventSeverity(rec.severity),
        initiator: 'system',
        summary: rec.title,
        evidenceHref: '/commissioner-os/recommendations',
        timestamp: rec.createdAt,
      })
    }

    for (const automation of automations.data ?? []) {
      if (automation.lastRunResult === 'failure') {
        events.push({
          id: `activity-${automation.id}-failed`,
          type: 'automation_failed',
          sourceModuleId: 'automations',
          severity: conditionToEventSeverity(automation.health),
          initiator: 'system',
          summary: `${automation.name} failed on its last run.`,
          evidenceHref: '/commissioner-os/automations',
          timestamp: automation.lastRunAt ?? now,
        })
      } else if (automation.lastRunResult === 'success') {
        events.push({
          id: `activity-${automation.id}-success`,
          type: 'automation_executed',
          sourceModuleId: 'automations',
          severity: 'success',
          initiator: 'system',
          summary: `${automation.name} ran successfully.`,
          evidenceHref: '/commissioner-os/automations',
          timestamp: automation.lastRunAt ?? now,
        })
      }
    }

    for (const report of reportHistory.data ?? []) {
      if (report.status === 'failed') {
        events.push({
          id: `activity-${report.id}`,
          type: 'report_failed',
          sourceModuleId: 'reports',
          severity: 'warning',
          initiator: 'system',
          summary: `${report.templateName} failed to generate.`,
          evidenceHref: '/commissioner-os/reports',
          timestamp: report.generatedAt,
        })
      } else if (report.status === 'ready') {
        events.push({
          id: `activity-${report.id}`,
          type: 'report_generated',
          sourceModuleId: 'reports',
          severity: 'success',
          initiator: 'system',
          summary: `${report.templateName} generated successfully.`,
          evidenceHref: '/commissioner-os/reports',
          timestamp: report.generatedAt,
        })
      }
    }

    for (const task of tasks.data ?? []) {
      if (task.status === 'completed') {
        events.push({
          id: `activity-${task.id}`,
          type: 'task_completed',
          sourceModuleId: 'workspace',
          severity: 'success',
          initiator: 'human',
          summary: task.title,
          evidenceHref: '/commissioner-os/workspace',
          timestamp: task.updatedAt,
        })
      } else if (task.status === 'archived') {
        events.push({
          id: `activity-${task.id}`,
          type: 'task_archived',
          sourceModuleId: 'workspace',
          severity: 'informational',
          initiator: 'human',
          summary: task.title,
          evidenceHref: '/commissioner-os/workspace',
          timestamp: task.updatedAt,
        })
      }
    }

    return { data: events, error: null, source: 'live', timestamp: now }
  },
}
