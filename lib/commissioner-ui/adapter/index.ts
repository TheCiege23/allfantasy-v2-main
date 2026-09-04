import { resolveServerDataMode } from '../demo-mode'
import type { CommissionerDataMode } from '../demo-mode/constants'
import type { CommissionerErrorAttributableId, CommissionerPlatformResponse } from '../contracts'

import { stubDecisionOSClient } from '../decision-os-client/stub'
import { demoDecisionOSClient } from '../decision-os-client/demo'
import { liveDecisionOSClient } from '../decision-os-client/live'
import type { DecisionOSClient } from '../decision-os-client/types'

import { stubLeagueHealthClient } from '../league-health/decision-os-client/stub'
import { demoLeagueHealthClient } from '../league-health/decision-os-client/demo'
import { liveLeagueHealthClient } from '../league-health/decision-os-client/live'
import type { LeagueHealthClient } from '../league-health/decision-os-client/types'

import { stubManagerIntelligenceClient } from '../managers/decision-os-client/stub'
import { demoManagerIntelligenceClient } from '../managers/decision-os-client/demo'
import { liveManagerIntelligenceClient } from '../managers/decision-os-client/live'
import type { ManagerIntelligenceClient } from '../managers/decision-os-client/types'

import { stubRecommendationsClient } from '../recommendations/decision-os-client/stub'
import { demoRecommendationsClient } from '../recommendations/decision-os-client/demo'
import { liveRecommendationsClient } from '../recommendations/decision-os-client/live'
import type { RecommendationsClient } from '../recommendations/decision-os-client/types'

import { stubWorkspaceClient } from '../workspace/decision-os-client/stub'
import { demoWorkspaceClient } from '../workspace/decision-os-client/demo'
import { liveWorkspaceClient } from '../workspace/decision-os-client/live'
import type { WorkspaceClient } from '../workspace/decision-os-client/types'

import { stubAutomationClient } from '../automations/decision-os-client/stub'
import { demoAutomationClient } from '../automations/decision-os-client/demo'
import { liveAutomationClient } from '../automations/decision-os-client/live'
import type { AutomationClient } from '../automations/decision-os-client/types'

import { stubAnalyticsClient } from '../analytics/decision-os-client/stub'
import { demoAnalyticsClient } from '../analytics/decision-os-client/demo'
import { liveAnalyticsClient } from '../analytics/decision-os-client/live'
import type { AnalyticsClient } from '../analytics/decision-os-client/types'

import { stubReportsClient } from '../reports/decision-os-client/stub'
import { demoReportsClient } from '../reports/decision-os-client/demo'
import { liveReportsClient } from '../reports/decision-os-client/live'
import type { ReportsClient } from '../reports/decision-os-client/types'

import { stubSearchClient } from '../search/decision-os-client/stub'
import { demoSearchClient } from '../search/decision-os-client/demo'
import { liveSearchClient } from '../search/decision-os-client/live'
import type { SearchClient } from '../search/decision-os-client/types'

import { stubNotificationsClient } from '../notifications/decision-os-client/stub'
import { demoNotificationsClient } from '../notifications/decision-os-client/demo'
import { liveNotificationsClient } from '../notifications/decision-os-client/live'
import type { NotificationsClient } from '../notifications/decision-os-client/types'

import { stubActivityClient } from '../activity/decision-os-client/stub'
import { demoActivityClient } from '../activity/decision-os-client/demo'
import { liveActivityClient } from '../activity/decision-os-client/live'
import type { ActivityClient } from '../activity/decision-os-client/types'

import { stubHelpClient } from '../help/decision-os-client/stub'
import { demoHelpClient } from '../help/decision-os-client/demo'
import { liveHelpClient } from '../help/decision-os-client/live'
import type { HelpClient } from '../help/decision-os-client/types'

import { normalizeErrorContract, normalizeEventSeverity, normalizeEvidencePoints, normalizeRecommendationList, normalizeSeverity, normalizeTimestamp, errorFromException } from './normalize'
import { isWellFormedResponse } from './validate'
import { logAdapterEvent } from './logging'
import type { CommissionerDecisionOSAdapter } from './types'

export * from './types'
export * from './normalize'
export * from './validate'
export * from './logging'

function selectByMode<T>(mode: CommissionerDataMode, stub: T, demo: T, live: T): T {
  switch (mode) {
    case 'live':
      return live
    case 'demo':
      return demo
    case 'stub':
    default:
      return stub
  }
}

/**
 * Wraps one Decision OS client method with the adapter's uniform pipeline:
 * catch-and-normalize on throw, envelope normalization (timestamp, error),
 * an optional data-shape normalizer, structural validation (logged, never
 * thrown — an invalid shape degrades to its best-effort normalized form
 * rather than crashing the caller), and a logging hook. This is the one
 * place "translate Decision OS outputs into Platform Contracts" actually
 * happens in code, not just in a comment.
 */
function wrapMethod<T>(
  moduleId: CommissionerErrorAttributableId,
  methodName: string,
  mode: CommissionerDataMode,
  fn: () => Promise<CommissionerPlatformResponse<T>>,
  normalizeData?: (data: T) => T
): () => Promise<CommissionerPlatformResponse<T>> {
  return async () => {
    const startedAt = Date.now()
    let raw: CommissionerPlatformResponse<T>
    try {
      raw = await fn()
    } catch (err) {
      const error = errorFromException(err, moduleId)
      logAdapterEvent({ type: 'error', moduleId, method: methodName, mode, durationMs: Date.now() - startedAt, error })
      return { data: null, error, source: mode, timestamp: new Date().toISOString() }
    }

    if (!isWellFormedResponse<T>(raw)) {
      logAdapterEvent({
        type: 'error',
        moduleId,
        method: methodName,
        mode,
        durationMs: Date.now() - startedAt,
        error: { category: 'unknown', message: 'Decision OS response failed contract validation.', moduleId, retryable: false, timestamp: new Date().toISOString() },
      })
    }

    const normalized: CommissionerPlatformResponse<T> = {
      data: raw.data == null ? null : normalizeData ? normalizeData(raw.data) : raw.data,
      error: normalizeErrorContract(raw.error, moduleId),
      source: raw.source,
      timestamp: normalizeTimestamp(raw.timestamp),
    }

    logAdapterEvent({ type: 'success', moduleId, method: methodName, mode, source: normalized.source, durationMs: Date.now() - startedAt })
    return normalized
  }
}

function buildMissionControlAdapter(mode: CommissionerDataMode): DecisionOSClient {
  const client = selectByMode(mode, stubDecisionOSClient, demoDecisionOSClient, liveDecisionOSClient)
  return {
    getLeagueHealthSummary: wrapMethod('mission-control', 'getLeagueHealthSummary', mode, () => client.getLeagueHealthSummary(), (data) => ({
      ...data,
      tier: normalizeSeverity(data.tier),
    })),
    getManagerHighlights: wrapMethod('mission-control', 'getManagerHighlights', mode, () => client.getManagerHighlights()),
    getMissionControlKpis: wrapMethod('mission-control', 'getMissionControlKpis', mode, () => client.getMissionControlKpis()),
  }
}

function buildLeagueHealthAdapter(mode: CommissionerDataMode): LeagueHealthClient {
  const client = selectByMode(mode, stubLeagueHealthClient, demoLeagueHealthClient, liveLeagueHealthClient)
  return {
    getHealthDetail: wrapMethod('league-health', 'getHealthDetail', mode, () => client.getHealthDetail(), (data) => ({
      ...data,
      tier: normalizeSeverity(data.tier),
    })),
    getRisks: wrapMethod('league-health', 'getRisks', mode, () => client.getRisks(), (data) =>
      data.map((risk) => ({ ...risk, severity: normalizeSeverity(risk.severity) }))
    ),
    getEvidence: wrapMethod('league-health', 'getEvidence', mode, () => client.getEvidence(), normalizeEvidencePoints),
    getRecommendations: wrapMethod('league-health', 'getRecommendations', mode, () => client.getRecommendations(), normalizeRecommendationList),
  }
}

function buildManagersAdapter(mode: CommissionerDataMode): ManagerIntelligenceClient {
  const client = selectByMode(mode, stubManagerIntelligenceClient, demoManagerIntelligenceClient, liveManagerIntelligenceClient)
  return {
    getManagerDirectory: wrapMethod('managers', 'getManagerDirectory', mode, () => client.getManagerDirectory()),
  }
}

function buildRecommendationsAdapter(mode: CommissionerDataMode): RecommendationsClient {
  const client = selectByMode(mode, stubRecommendationsClient, demoRecommendationsClient, liveRecommendationsClient)
  return {
    getQueue: wrapMethod('recommendations', 'getQueue', mode, () => client.getQueue(), normalizeRecommendationList),
  }
}

function buildWorkspaceAdapter(mode: CommissionerDataMode): WorkspaceClient {
  const client = selectByMode(mode, stubWorkspaceClient, demoWorkspaceClient, liveWorkspaceClient)
  return {
    getTasks: wrapMethod('workspace', 'getTasks', mode, () => client.getTasks(), (data) =>
      data.map((task) => ({ ...task, priority: normalizeSeverity(task.priority) }))
    ),
  }
}

function buildAutomationsAdapter(mode: CommissionerDataMode): AutomationClient {
  const client = selectByMode(mode, stubAutomationClient, demoAutomationClient, liveAutomationClient)
  return {
    getCatalog: wrapMethod('automations', 'getCatalog', mode, () => client.getCatalog(), (data) =>
      data.map((entry) => ({ ...entry, health: normalizeSeverity(entry.health) }))
    ),
    getExecutionHistory: (automationId: string) =>
      wrapMethod('automations', 'getExecutionHistory', mode, () => client.getExecutionHistory(automationId))(),
    getSummary: wrapMethod('automations', 'getSummary', mode, () => client.getSummary()),
  }
}

function buildAnalyticsAdapter(mode: CommissionerDataMode): AnalyticsClient {
  const client = selectByMode(mode, stubAnalyticsClient, demoAnalyticsClient, liveAnalyticsClient)
  return {
    getSnapshot: wrapMethod('analytics', 'getSnapshot', mode, () => client.getSnapshot()),
    getSummary: wrapMethod('analytics', 'getSummary', mode, () => client.getSummary()),
  }
}

function buildReportsAdapter(mode: CommissionerDataMode): ReportsClient {
  const client = selectByMode(mode, stubReportsClient, demoReportsClient, liveReportsClient)
  return {
    getTemplates: wrapMethod('reports', 'getTemplates', mode, () => client.getTemplates()),
    getHistory: wrapMethod('reports', 'getHistory', mode, () => client.getHistory()),
    getSummary: wrapMethod('reports', 'getSummary', mode, () => client.getSummary()),
  }
}

/**
 * Search is a platform service, not a business module (no
 * `CommissionerModuleId` of its own) — `wrapMethod`'s first parameter
 * accepts `CommissionerErrorAttributableId` specifically so this
 * namespace can flow through the identical pipeline as the other eight
 * without a type-level lie. Nothing else about the pipeline changes.
 */
function buildSearchAdapter(mode: CommissionerDataMode): SearchClient {
  const client = selectByMode(mode, stubSearchClient, demoSearchClient, liveSearchClient)
  return {
    getIndex: wrapMethod('search', 'getIndex', mode, () => client.getIndex()),
  }
}

/**
 * Notifications is the second platform service (after Search) to flow
 * through this pipeline via `CommissionerErrorAttributableId` rather than
 * a `CommissionerModuleId`. `getNotifications` normalizes each payload's
 * `severity` against the event-severity vocabulary (added in the Phase 2
 * adapter audit — today's demo/stub data always already satisfies it, but
 * a future live backend has no such guarantee) — the same defensive
 * treatment every other enum-like field in this adapter already gets.
 */
function buildNotificationsAdapter(mode: CommissionerDataMode): NotificationsClient {
  const client = selectByMode(mode, stubNotificationsClient, demoNotificationsClient, liveNotificationsClient)
  return {
    getNotifications: wrapMethod('notifications', 'getNotifications', mode, () => client.getNotifications(), (data) =>
      data.map((notification) => ({ ...notification, severity: normalizeEventSeverity(notification.severity) }))
    ),
    getSummary: wrapMethod('notifications', 'getSummary', mode, () => client.getSummary()),
  }
}

/**
 * Unlike Search and Notifications, Activity Stream *is* a real
 * `CommissionerModuleId` ('activity' already has a sidebar entry in
 * `COMMISSIONER_SECONDARY_NAV_ITEMS') — `wrapMethod`'s first argument is
 * passed as a plain module id here, no `CommissionerErrorAttributableId`
 * widening needed. One method, mirroring Recommendations' own
 * `getQueue()` — `getEvents` normalizes each event's `severity` against
 * the same event-severity vocabulary Notifications' adapter method uses
 * (added in the Phase 2 adapter audit, for the identical forward-looking
 * reason).
 */
function buildActivityAdapter(mode: CommissionerDataMode): ActivityClient {
  const client = selectByMode(mode, stubActivityClient, demoActivityClient, liveActivityClient)
  return {
    getEvents: wrapMethod('activity', 'getEvents', mode, () => client.getEvents(), (data) =>
      data.map((event) => ({ ...event, severity: normalizeEventSeverity(event.severity) }))
    ),
  }
}

/**
 * Like Activity Stream, Help Center is a real `CommissionerModuleId`
 * ('help' has its own sidebar entry and header link) — `wrapMethod`'s
 * first argument is passed as a plain module id, no
 * `CommissionerErrorAttributableId` widening needed. Two flat
 * list-getters, no `getSummary()` — no per-field normalizer required
 * either, since neither an article nor a glossary term carries a
 * severity/confidence field the adapter needs to coerce.
 */
function buildHelpAdapter(mode: CommissionerDataMode): HelpClient {
  const client = selectByMode(mode, stubHelpClient, demoHelpClient, liveHelpClient)
  return {
    getArticles: wrapMethod('help', 'getArticles', mode, () => client.getArticles()),
    getGlossary: wrapMethod('help', 'getGlossary', mode, () => client.getGlossary()),
  }
}

/**
 * The pure half of the factory — composes all four modules' normalized
 * clients for a given, already-resolved mode. No `cookies()` call, so
 * it's directly unit-testable outside a Next.js request scope (unlike
 * `resolveServerDataMode()`, which every module's own client factory
 * already calls and which none of this program's tests call directly
 * for exactly that reason).
 */
export function buildDecisionOSAdapter(mode: CommissionerDataMode): CommissionerDecisionOSAdapter {
  return {
    mode,
    missionControl: buildMissionControlAdapter(mode),
    leagueHealth: buildLeagueHealthAdapter(mode),
    managers: buildManagersAdapter(mode),
    recommendations: buildRecommendationsAdapter(mode),
    workspace: buildWorkspaceAdapter(mode),
    automations: buildAutomationsAdapter(mode),
    analytics: buildAnalyticsAdapter(mode),
    reports: buildReportsAdapter(mode),
    search: buildSearchAdapter(mode),
    notifications: buildNotificationsAdapter(mode),
    activity: buildActivityAdapter(mode),
    help: buildHelpAdapter(mode),
  }
}

/**
 * The one factory every Commissioner OS page calls. Resolves Demo Mode
 * once (previously each module's own client factory resolved it
 * separately), then composes all four modules' normalized clients behind
 * a single object. No UI module should import from
 * `lib/commissioner-ui/{module}/decision-os-client` directly anymore —
 * only from here.
 */
export async function getDecisionOSAdapter(): Promise<CommissionerDecisionOSAdapter> {
  const mode = await resolveServerDataMode()
  return buildDecisionOSAdapter(mode)
}
