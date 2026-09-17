/**
 * chimmy-surfaces — unified AI UI component library
 *
 * Provides the AISurfaceContext, reusable Chimmy UI primitives,
 * shell/layout components, gate components, and page-specific
 * AI surface wrappers for the AllFantasy platform.
 *
 * Usage:
 *   import { AISurfaceProvider, useAISurface, ChimmyInsightCard, DashboardAISurface } from '@/components/chimmy-surfaces'
 */

// ── Context & hook ────────────────────────────────────────────────────────────
export { AISurfaceProvider, useAISurface } from './AISurfaceContext'
export type {
  AISurfaceContextValue,
  AISurfaceProviderProps,
  AISurfaceSubscriptionState,
  AISurfaceTeamState,
  AISurfaceLeagueState,
  AISurfaceLiveData,
} from './AISurfaceContext'

// ── UI Primitives ─────────────────────────────────────────────────────────────
export { default as ChimmyInsightCard } from './ChimmyInsightCard'
export type { ChimmyInsightCardProps, ChimmyInsightSeverity } from './ChimmyInsightCard'

export { default as ChimmyRecommendationCard } from './ChimmyRecommendationCard'
export type { ChimmyRecommendationCardProps, ChimmyRecommendationPriority } from './ChimmyRecommendationCard'

export { default as ChimmyActionBar } from './ChimmyActionBar'
export type { ChimmyActionBarProps, ChimmyActionBarAction } from './ChimmyActionBar'

export { default as ChimmyConfidenceBadge } from './ChimmyConfidenceBadge'
export type { ChimmyConfidenceBadgeProps } from './ChimmyConfidenceBadge'

export { default as ChimmyRiskBadge } from './ChimmyRiskBadge'
export type { ChimmyRiskBadgeProps, ChimmyRiskLevel } from './ChimmyRiskBadge'

export { default as ChimmyExpandedExplanation } from './ChimmyExpandedExplanation'
export type { ChimmyExpandedExplanationProps } from './ChimmyExpandedExplanation'

export { default as ChimmyCompareCard } from './ChimmyCompareCard'
export type { ChimmyCompareCardProps, ChimmyCompareItem } from './ChimmyCompareCard'

export { default as ChimmyAlertBanner } from './ChimmyAlertBanner'
export type { ChimmyAlertBannerProps, ChimmyAlertBannerVariant } from './ChimmyAlertBanner'

export { default as ChimmyAlertCard } from './ChimmyAlertCard'
export type { ChimmyAlertCardProps } from './ChimmyAlertCard'

export { default as ChimmyAlertFeedItem } from './ChimmyAlertFeedItem'
export type { ChimmyAlertFeedItemProps } from './ChimmyAlertFeedItem'

export { default as ChimmyGroupedAlertCard } from './ChimmyGroupedAlertCard'
export type { ChimmyGroupedAlertCardProps } from './ChimmyGroupedAlertCard'

export { default as ChimmyCommissionerAlertCard } from './ChimmyCommissionerAlertCard'
export type { ChimmyCommissionerAlertCardProps } from './ChimmyCommissionerAlertCard'

export { default as ChimmyUrgencyBadge } from './ChimmyUrgencyBadge'
export type { ChimmyUrgencyBadgeProps } from './ChimmyUrgencyBadge'

export { default as ChimmyAlertActionButton } from './ChimmyAlertActionButton'
export type { ChimmyAlertActionButtonProps } from './ChimmyAlertActionButton'

export { default as ChimmySnoozeAction } from './ChimmySnoozeAction'
export type { ChimmySnoozeActionProps } from './ChimmySnoozeAction'

export { default as ChimmyDismissAction } from './ChimmyDismissAction'
export type { ChimmyDismissActionProps } from './ChimmyDismissAction'

export { default as ChimmyPremiumAlertTeaser } from './ChimmyPremiumAlertTeaser'
export type { ChimmyPremiumAlertTeaserProps } from './ChimmyPremiumAlertTeaser'

export { default as ChimmyUnifiedAlertFeed } from './ChimmyUnifiedAlertFeed'
export type { ChimmyUnifiedAlertFeedProps } from './ChimmyUnifiedAlertFeed'

export { default as ChimmyFloatingNudge } from './ChimmyFloatingNudge'
export type { ChimmyFloatingNudgeProps } from './ChimmyFloatingNudge'

export { default as ChimmyCriticalAlertDrawer } from './ChimmyCriticalAlertDrawer'
export type { ChimmyCriticalAlertDrawerProps } from './ChimmyCriticalAlertDrawer'

export { default as ChimmyStoryCard } from './ChimmyStoryCard'
export type { ChimmyStoryCardProps } from './ChimmyStoryCard'

export { default as ChimmyCommissionerCard } from './ChimmyCommissionerCard'
export type { ChimmyCommissionerCardProps } from './ChimmyCommissionerCard'

export { default as ChimmyUpgradeLockCard } from './ChimmyUpgradeLockCard'
export type { ChimmyUpgradeLockCardProps } from './ChimmyUpgradeLockCard'

export { default as ChimmyThinkingState } from './ChimmyThinkingState'
export type { ChimmyThinkingStateProps } from './ChimmyThinkingState'

export { default as ChimmyEmptyState } from './ChimmyEmptyState'
export type { ChimmyEmptyStateProps } from './ChimmyEmptyState'

export { default as ChimmyErrorState } from './ChimmyErrorState'
export type { ChimmyErrorStateProps } from './ChimmyErrorState'

export { default as ChimmyLauncherButton } from './ChimmyLauncherButton'
export type { ChimmyLauncherButtonProps } from './ChimmyLauncherButton'

export { default as ChimmyFloatingActionButton } from './ChimmyFloatingActionButton'
export type { ChimmyFloatingActionButtonProps } from './ChimmyFloatingActionButton'

export { default as ChimmyContextPanel } from './ChimmyContextPanel'
export type { ChimmyContextPanelProps, ChimmyContextPanelSection } from './ChimmyContextPanel'

// ── Shell & Layout ────────────────────────────────────────────────────────────
export { default as ChimmySurfaceShell } from './ChimmySurfaceShell'
export type { ChimmySurfaceShellProps } from './ChimmySurfaceShell'

export { default as ChimmyDrawer } from './ChimmyDrawer'
export type { ChimmyDrawerProps } from './ChimmyDrawer'

export { default as ChimmyRightRailPanel } from './ChimmyRightRailPanel'
export type { ChimmyRightRailPanelProps } from './ChimmyRightRailPanel'

export { default as ChimmyModalDeepDive } from './ChimmyModalDeepDive'
export type { ChimmyModalDeepDiveProps } from './ChimmyModalDeepDive'

export { default as ChimmyActionBinder } from './ChimmyActionBinder'
export type { ChimmyActionBinderProps } from './ChimmyActionBinder'

export { default as ChimmyNotificationRenderer } from './ChimmyNotificationRenderer'
export type { ChimmyNotificationRendererProps, ChimmyNotification } from './ChimmyNotificationRenderer'

export { default as ChimmyAnalyticsSummaryPanel } from './ChimmyAnalyticsSummaryPanel'
export type { ChimmyAnalyticsSummaryPanelProps } from './ChimmyAnalyticsSummaryPanel'

export { default as ChimmyAlertPreferencesPanel } from './ChimmyAlertPreferencesPanel'
export type { ChimmyAlertPreferencesPanelProps } from './ChimmyAlertPreferencesPanel'

// ── Gates ─────────────────────────────────────────────────────────────────────
export { default as ChimmyRoleGate } from './ChimmyRoleGate'
export type { ChimmyRoleGateProps } from './ChimmyRoleGate'

export { default as ChimmyPremiumGate } from './ChimmyPremiumGate'
export type { ChimmyPremiumGateProps } from './ChimmyPremiumGate'

// ── Page Surface Wrappers ─────────────────────────────────────────────────────
export { default as DashboardAISurface } from './surfaces/DashboardAISurface'
export type { DashboardAISurfaceProps, DashboardAISurfaceInsight, DashboardAISurfaceRecommendation } from './surfaces/DashboardAISurface'

export { default as LeagueHomeAISurface } from './surfaces/LeagueHomeAISurface'
export type { LeagueHomeAISurfaceProps } from './surfaces/LeagueHomeAISurface'

export { default as DraftRoomAISurface } from './surfaces/DraftRoomAISurface'
export type { DraftRoomAISurfaceProps, DraftRoomAISurfacePickRec } from './surfaces/DraftRoomAISurface'

export { default as RosterAISurface } from './surfaces/RosterAISurface'
export type { RosterAISurfaceProps } from './surfaces/RosterAISurface'

export { default as MatchupAISurface } from './surfaces/MatchupAISurface'
export type { MatchupAISurfaceProps } from './surfaces/MatchupAISurface'

export { default as WaiverAISurface } from './surfaces/WaiverAISurface'
export type { WaiverAISurfaceProps, WaiverAISurfaceAdd } from './surfaces/WaiverAISurface'

export { default as TradeAISurface } from './surfaces/TradeAISurface'
export type { TradeAISurfaceProps } from './surfaces/TradeAISurface'

export { default as ChatAISurface } from './surfaces/ChatAISurface'
export type { ChatAISurfaceProps } from './surfaces/ChatAISurface'

export { default as CommissionerAISurface } from './surfaces/CommissionerAISurface'
export type { CommissionerAISurfaceProps, CommissionerAlert } from './surfaces/CommissionerAISurface'

export { default as DiscoveryAISurface } from './surfaces/DiscoveryAISurface'
export type { DiscoveryAISurfaceProps } from './surfaces/DiscoveryAISurface'

export { default as PlayerAISurface } from './surfaces/PlayerAISurface'
export type { PlayerAISurfaceProps } from './surfaces/PlayerAISurface'

export { default as TeamAISurface } from './surfaces/TeamAISurface'
export type { TeamAISurfaceProps, TeamDirection } from './surfaces/TeamAISurface'

export { default as AdminAISurface } from './surfaces/AdminAISurface'
export type { AdminAISurfaceProps } from './surfaces/AdminAISurface'

// ── Action UI (Phase 6) ───────────────────────────────────────────────────────
export { default as ChimmyActionRecommendationCard } from './ChimmyActionRecommendationCard'
export type { ChimmyActionRecommendationCardProps } from './ChimmyActionRecommendationCard'

export { default as ChimmyQuickActionStrip } from './ChimmyQuickActionStrip'
export type { ChimmyQuickActionStripProps } from './ChimmyQuickActionStrip'

export { default as ChimmySavedRecommendationCard } from './ChimmySavedRecommendationCard'
export type { ChimmySavedRecommendationCardProps } from './ChimmySavedRecommendationCard'

export { default as ChimmySurfaceActionFeed } from './ChimmySurfaceActionFeed'
export type { ChimmySurfaceActionFeedProps } from './ChimmySurfaceActionFeed'

export { default as SavedRecommendationRow } from './SavedRecommendationRow'
export type { SavedRecommendationRowProps } from './SavedRecommendationRow'

export { default as SavedRecStaleCompare } from './SavedRecommendationStaleCompare'
export type { SavedRecommendationStaleCompareProps as SavedRecStaleCompareProps } from './SavedRecommendationStaleCompare'
