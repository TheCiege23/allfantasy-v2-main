import type { LeagueSport } from '@prisma/client'

/** How the dashboard should phrase the primary number (label must match). */
export type LineupActionDisplayMode = 'unresolved_slots' | 'leagues' | 'lineups'

type LineupActionUrgency = 'urgent' | 'soon' | 'normal' | 'low'

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

type LineupActionSourceModule =
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
