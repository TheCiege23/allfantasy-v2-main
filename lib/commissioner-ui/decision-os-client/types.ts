import type { CommissionerPlatformResponse } from '../contracts'
import type { SeverityTier } from '../tokens/colors'

/**
 * The interface Mission Control consumes instead of reaching into League
 * Health/Recommendations Center/Manager Intelligence directly —
 * Implementation Program §12. Swappable behind this one interface: a
 * stub/demo implementation (Demo Mode) and, later, a real implementation
 * backed by the actual Decision OS, with zero UI-layer change required
 * when that swap happens.
 *
 * Recommendations were removed from here deliberately — Mission Control
 * previewed its own ad hoc RecommendationSummary shape until
 * Recommendations Center's own client and the shared
 * CommissionerRecommendationContract existed. That was exactly the
 * "duplicate recommendation logic" the Recommendations Center phase
 * explicitly required not to exist; Mission Control now consumes
 * lib/commissioner-ui/recommendations/decision-os-client directly.
 *
 * `getRecentActivity()` / `ActivityEntrySummary` (id, label, a
 * pre-formatted relative-time string) were removed the same way once
 * Phase 1.10 built a real Universal Activity Stream — the two shapes
 * were answering the identical question ("what recently happened across
 * the league") with two independently-maintained implementations, the
 * same kind of duplicate the Recommendations deletion above already set
 * precedent for. Mission Control now consumes
 * lib/commissioner-ui/activity/decision-os-client directly, sliced and
 * mapped to `TimelineCard`'s own `TimelineEntry` shape in
 * app/commissioner-os/page.tsx.
 */
export interface LeagueHealthSummary {
  score: number
  tier: SeverityTier
  trendLabel: string
  trendDirection: 'up' | 'down' | 'flat'
  driver: string
}

export interface ManagerHighlight {
  id: string
  managerName: string
  callout: string
  tone: 'positive' | 'risk'
}

export interface MissionControlKpis {
  openRecommendations: number
  activeRisks: number
  engagementScore: number
  nextDeadlineLabel: string
}

export interface DecisionOSClient {
  getLeagueHealthSummary(): Promise<CommissionerPlatformResponse<LeagueHealthSummary>>
  getManagerHighlights(): Promise<CommissionerPlatformResponse<ManagerHighlight[]>>
  getMissionControlKpis(): Promise<CommissionerPlatformResponse<MissionControlKpis>>
}
