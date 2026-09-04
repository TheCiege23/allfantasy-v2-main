import type { CommissionerDataMode } from '../demo-mode/constants'
import type { DecisionOSClient } from '../decision-os-client/types'
import type { LeagueHealthClient } from '../league-health/decision-os-client/types'
import type { ManagerIntelligenceClient } from '../managers/decision-os-client/types'
import type { RecommendationsClient } from '../recommendations/decision-os-client/types'
import type { WorkspaceClient } from '../workspace/decision-os-client/types'
import type { AutomationCatalogEntry, AutomationClient, AutomationExecutionEntry, AutomationSummary } from '../automations/decision-os-client/types'
import type { AnalyticsClient, LeagueAnalyticsSnapshot, AnalyticsSummary } from '../analytics/decision-os-client/types'
import type { ReportsClient, GeneratedReport, ReportTemplate, ReportsSummary } from '../reports/decision-os-client/types'
import type { SearchClient } from '../search/decision-os-client/types'
import type { NotificationsClient, NotificationsSummary } from '../notifications/decision-os-client/types'
import type { ActivityClient } from '../activity/decision-os-client/types'
import type { HelpClient } from '../help/decision-os-client/types'

export type {
  DecisionOSClient,
  LeagueHealthClient,
  ManagerIntelligenceClient,
  RecommendationsClient,
  WorkspaceClient,
  AutomationClient,
  AutomationCatalogEntry,
  AutomationExecutionEntry,
  AutomationSummary,
  AnalyticsClient,
  LeagueAnalyticsSnapshot,
  AnalyticsSummary,
  ReportsClient,
  GeneratedReport,
  ReportTemplate,
  ReportsSummary,
  SearchClient,
  NotificationsClient,
  NotificationsSummary,
  ActivityClient,
  HelpClient,
}

/**
 * The single door every Commissioner OS UI module reaches Decision OS
 * through. Each namespace's method surface is the exact same interface
 * that module's own decision-os-client already defined — the adapter
 * does not redefine or duplicate those shapes, it composes them behind
 * one import, normalizing, validating, and logging every call uniformly.
 *
 * `mode` is exposed because every current page also needs to know which
 * mode resolved (for `PreviewDataBanner`) — previously a second, separate
 * `resolveServerDataMode()` call; now resolved once, alongside the data.
 */
export interface CommissionerDecisionOSAdapter {
  readonly mode: CommissionerDataMode
  readonly missionControl: DecisionOSClient
  readonly leagueHealth: LeagueHealthClient
  readonly managers: ManagerIntelligenceClient
  readonly recommendations: RecommendationsClient
  readonly workspace: WorkspaceClient
  readonly automations: AutomationClient
  readonly analytics: AnalyticsClient
  readonly reports: ReportsClient
  readonly search: SearchClient
  readonly notifications: NotificationsClient
  readonly activity: ActivityClient
  readonly help: HelpClient
}
