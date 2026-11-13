/**
 * Commissioner Intelligence Service — shadow-mode types, Fantasy OS Migration
 * Plan, Phase 10. Like Game Day OS (Phase 9), this module REUSES real,
 * already-live engines directly rather than reinventing them — the audit
 * found the commissioner-intelligence surface is the most already-built of
 * any phase so far:
 *  - lib/decision-os/missionControl.ts's resolveMissionControlSnapshot() —
 *    already federates League Health + trend + manager counts + activity +
 *    retention risk + recommended actions, real, live.
 *  - lib/decision-os/leagueAnalytics.ts's resolveLeagueAnalyticsSnapshot().
 *  - lib/decision-os/attentionSignals.ts's deriveLeagueAttentionSignals() —
 *    real, computed, but (per the audit) currently has no live route caller;
 *    this module gives it one real consumer.
 *  - lib/league-power-rankings/PowerRankingEngine.ts's computePowerRankings()
 *    — real, deterministic, already has rank/movement tracking built in.
 *  - lib/league/permissions.ts's getLeagueRole() — the one, real, established
 *    authorization helper (never a second framework).
 *
 * This module's real, additive contribution: (1) cross-referencing the
 * Phase 5-9 shared services (Trade/Waiver/Draft/Game-Day shadow outputs)
 * into one canonical CommissionerContext, something no existing system does
 * yet; (2) a genuinely new, single-league, structured CommissionerBrief
 * (distinct from the existing cross-league DailyBrief); (3) an honest
 * specialty-format-awareness layer; (4) a real divergence check between two
 * genuinely independent existing systems.
 */

import type { MissionControlSnapshot } from '@/lib/decision-os/missionControl'
import type { LeagueAnalyticsSnapshot } from '@/lib/decision-os/leagueAnalytics'
import type { DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'
import type { PowerRankingsOutput } from '@/lib/league-power-rankings/types'
import type { LineupAttentionItem } from '@/lib/shared-services/game-day/types'
import type { ManagerBehaviorProfile } from '@/lib/shared-services/knowledge-graph/types'
import type { LeagueRole } from '@/lib/league/permissions'

export type { MissionControlSnapshot, LeagueAnalyticsSnapshot, DecisionOsAttentionSignal, PowerRankingsOutput }

interface SourceAttribution {
  source: string
  fetchedAt: string
  providerTimestamp: string | null
  freshness: 'fresh' | 'stale' | 'unknown'
  confidence: number
  missingDataReason: string | null
}

/** Formats with a confirmed real, live ranking engine vs a confirmed stub — never silently produce misleading output for the latter. */
type SpecialtyFormatSupport = 'supported' | 'specialty_adapter_required'

export interface FormatAwareness {
  leagueVariant: string | null
  isDynasty: boolean
  powerRankingSupport: SpecialtyFormatSupport
  /** Why powerRankingSupport is 'specialty_adapter_required', when applicable — e.g. "Best Ball power rankings are a confirmed preview-only stub (lib/bestball/ai/powerRankings.ts)." */
  reason: string | null
}

export interface CommissionerContext {
  leagueId: string
  generatedAt: string
  requestingUserRole: LeagueRole
  missionControl: MissionControlSnapshot
  leagueAnalytics: LeagueAnalyticsSnapshot
  formatAwareness: FormatAwareness
  /** Real Phase 5-9 shared-service enrichment — optional/best-effort. Each is null when the caller didn't supply the context needed to assemble it (e.g. no rosterId for Game Day), never fabricated. */
  gameDayAttentionItems: LineupAttentionItem[] | null
  managerTendencies: Record<string, ManagerTendencyContext>
}

export interface ManagerTendencyContext {
  status: 'ok' | 'gated' | 'unavailable'
  reason: string | null
  profile: ManagerBehaviorProfile | null
}

export type LeagueHealthCategory = 'healthy' | 'watch' | 'attention_required' | 'critical' | 'unavailable'

export interface LeagueHealthAssessment {
  leagueId: string
  category: LeagueHealthCategory
  /** Reused directly from monitorLeagueHealth()'s own score via resolveDecisionOsLeagueHealth — not recomputed. */
  score: number
  issues: string[]
  evidence: string[]
  confidence: number
  freshness: SourceAttribution['freshness']
  sourceAttribution: SourceAttribution
}

type CommissionerAttentionReasonCode =
  | 'legacy_signal'
  | 'lineup_attention_carryover'
  | 'stale_import_data'
  | 'unresolved_identity_mapping'

export interface CommissionerAttentionItem {
  reasonCode: CommissionerAttentionReasonCode
  category: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'informational'
  leagueId: string
  affectedManagerIds: string[]
  message: string
  evidence: string[]
  confidence: number
  freshness: SourceAttribution['freshness']
  risk: 'low' | 'medium' | 'high'
  recommendedAction: string | null
  actionAvailableInApp: boolean
  providerDeepLink: string | null
  permissionRequired: LeagueRole
}

export interface CommissionerPowerRanking {
  leagueId: string
  week: number
  mode: 'general_v2'
  formulaVersion: string
  support: SpecialtyFormatSupport
  teams: PowerRankingsOutput['teams']
  sourceAttribution: SourceAttribution
  explanation: string
}

export interface CommissionerBriefSection {
  key:
    | 'league_overview'
    | 'biggest_movers'
    | 'lineup_concerns'
    | 'waiver_activity'
    | 'trade_activity'
    | 'commissioner_actions'
    | 'data_quality_warnings'
  title: string
  facts: string[]
  evidence: string[]
}

export interface CommissionerBrief {
  leagueId: string
  week: number
  generatedAt: string
  sections: CommissionerBriefSection[]
  isHealthy: boolean
  confidence: number
}

