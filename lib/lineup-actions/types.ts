import type { LeagueSport } from '@prisma/client'
import type { SourceLink } from '@/lib/league-links/sourceLinkResolver'

/** How the dashboard should phrase the primary number (label must match). */
export type LineupActionDisplayMode = 'unresolved_slots' | 'leagues' | 'lineups'

export type LineupActionUrgency = 'urgent' | 'soon' | 'normal' | 'low'

export type LineupActionReasonType =
  | 'empty_starter'
  | 'injured_starter'
  | 'questionable_starter'
  | 'doubtful_starter'
  | 'illegal_slot'
  | 'fetch_error'
  | 'native_starter_gap'
  | 'ai_start_sit'
  | 'ai_waiver'
  | 'matchup_prep'
  | 'injury_impact'
  | 'war_room'
  | 'weather_risk'

export type LineupActionSourceModule =
  | 'lineup_scan'
  | 'StartSit'
  | 'Waiver'
  | 'MatchupPrep'
  | 'InjuryImpact'
  | 'AFWarRoom'
  | 'unknown'

export type LineupActionItem = {
  leagueId: string
  leagueName: string
  sport: LeagueSport
  platform: string
  teamId: string | null
  slotIndex: number | null
  slotId: string | null
  slotLabel: string | null
  playerId: string | null
  playerName: string | null
  reasonType: LineupActionReasonType
  urgency: LineupActionUrgency
  lockTime: string | null
  recommendedAction: string | null
  suggestedReplacementPlayerId: string | null
  confidence: number | null
  expectedGain: number | null
  sourceModule: LineupActionSourceModule
  message: string
  severity: 'critical' | 'warning' | 'info'
  /**
   * Decision OS deep-link actions, resolved SERVER-SIDE from the canonical League row (never from
   * anything this item carries — the item holds no navigation URL). Optional for back-compat.
   */
  actionLinks?: DecisionOsActionLinks
}

/** Internal AllFantasy analysis + external source-platform action for a Decision OS card. */
export type DecisionOsActionLinks = {
  /** True if this signal warrants an external "complete on the source platform" action (else info-only). */
  actionable: boolean
  /** True if the league is imported (non-native) → surface the read-only disclosure. */
  imported: boolean
  /** League data freshness (League.lastSyncedAt ISO) when available. */
  dataAsOf: string | null
  /** Internal AllFantasy analysis link (available for native + imported leagues). */
  internal: { href: string; label: string } | null
  /** External source-platform link — pre-resolved + validated server-side; `label` is the display CTA. */
  external: { link: SourceLink; label: string } | null
}

export type LineupCheckLeagueBlock = {
  leagueId: string
  leagueName: string
  leagueAvatar: string | null
  sport: string
  platform: string
  issues: Array<{
    type: string
    message: string
    playerName?: string
    position?: string
    severity: 'critical' | 'warning' | 'info'
  }>
  chimmyAdvice: string
  /** Structured actions for this league (subset of global `actions`). */
  actions?: LineupActionItem[]
  scanIncomplete?: boolean
}

export type LineupActionSummaryPayload = {
  /** @deprecated use totalUnresolvedSlotActions — kept for older clients */
  totalIssues: number
  totalUnresolvedSlotActions: number
  /** Leagues where live lineup data could not be fully verified (e.g. provider fetch). */
  scanWarningLeagues: number
  leaguesNeedingAttention: number
  /** User teams with at least one issue (usually same as leaguesNeedingAttention). */
  lineupsNeedingAttention: number
  urgentLineupActions: number
  /** Locks passed — informational only when derivable from real timestamps. */
  lockedMissedActions: number
  displayMode: LineupActionDisplayMode
  displayCount: number
  displayLabelKey: string
  displayLabelParams: Record<string, string | number>
  displaySubtextKey: string | null
  displaySubtextParams: Record<string, string | number> | null
  urgentSubtextKey: string | null
  urgentSubtextParams: Record<string, string | number> | null
  actions: LineupActionItem[]
  leagues: LineupCheckLeagueBlock[]
  scannedLeagues: number
  scannedSleeperLeagues: number
  scannedNativeLeagues: number
  lastUpdatedAt: string
}
