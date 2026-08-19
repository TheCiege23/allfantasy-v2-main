/**
 * Game Day / Scoring Service — shadow-mode types, Fantasy OS Migration Plan,
 * Phase 9. Mirrors the architecture of lib/shared-services/{trade,waiver,draft}
 * but with one structural difference: this module reuses real ALREADY-LIVE
 * canonical engines directly rather than reimplementing anything — the audit
 * found ONE real matchup/scoring entry point (server/services/
 * matchupCenterService.ts's buildMatchupCenterPayload) and ONE real
 * cross-league lineup-issue engine (lib/lineup-actions/computeLineupActionsForUser)
 * already doing exactly this work, live, for real routes. This module's real,
 * additive contribution is: (1) cross-league player EXPOSURE aggregation
 * (genuinely new — no prior implementation existed), (2) a richer, provider-
 * neutral matchup-state enum, (3) new lineup-attention reasons the existing
 * engine does not cover, (4) game-window grouping, (5) an immutable
 * cross-league snapshot assembly. SHADOW MODE ONLY — nothing here is called
 * by any live route.
 */

import type { MatchupCenterPayload, MatchupPlayerSlot, MatchupSidePayload } from '@/lib/matchup-center/types'
import type { LineupActionItem } from '@/lib/lineup-actions/types'
import type { ManagerBehaviorProfile, PlayerExposure as KnowledgeGraphPlayerExposure } from '@/lib/shared-services/knowledge-graph/types'

export type { MatchupCenterPayload, MatchupPlayerSlot, MatchupSidePayload, LineupActionItem }
/** Re-exported under an unambiguous name — never conflate with this module's own UserPlayerExposure (private, per-user, unrelated persistence/privacy model). See README §"Private user exposure vs Knowledge Graph exposure". */
export type { KnowledgeGraphPlayerExposure }

/**
 * Richer, provider-neutral matchup state than MatchupCenterPayload's own
 * 'upcoming'|'live'|'final'|'unknown' — adds states the audit confirmed are
 * real provider/data possibilities (postponed/cancelled status strings can
 * flow through FantasyScheduleGame.status; bye is a real `resolveGenericMatchupContext`
 * outcome kind) plus honest failure/staleness states this module adds for
 * its own freshness contract. Never inferred purely from "scheduled time has
 * passed" — see MatchupStateNormalizer.ts's docstring.
 */
export type GameDayMatchupState =
  | 'upcoming'
  | 'live'
  | 'final'
  | 'postponed'
  | 'cancelled'
  | 'bye'
  | 'unsupported'
  | 'stale'
  | 'unavailable'

export interface SourceAttribution {
  source: string
  fetchedAt: string
  providerTimestamp: string | null
  freshness: 'fresh' | 'stale' | 'unknown'
  confidence: number
  missingDataReason: string | null
}

export interface NormalizedMatchupState {
  state: GameDayMatchupState
  attribution: SourceAttribution
  /**
   * Phase 5E-g: optional, additive certified GAME evidence (identity/status/finality/freshness). Present only
   * when a gated caller supplies it. Purely informational — it never influences `state`.
   */
  certifiedGameEvidence?: {
    available: boolean
    freshnessStatus: string
    snapshotVersion: string | null
    totalGames: number
    finalGames: number
    allGamesFinal: boolean
  }
}

/** One league's Game Day context for one viewing user — wraps buildMatchupCenterPayload's real output, does not recompute it. */
export interface LeagueGameDayContext {
  leagueId: string
  season: number
  week: number
  sport: string
  platform: string
  weekResolution: {
    source: string
    isPlayoffWeek: boolean
    playoffStartWeek: number | null
  }
  matchup: MatchupCenterPayload | null
  matchupState: NormalizedMatchupState
  /** Set when buildMatchupCenterPayload itself returned an error (league/roster not found, forbidden) — never silently dropped. */
  unavailableReason: string | null
}

export type ExposureSlotKind = 'starter' | 'bench' | 'ir' | 'taxi'

/**
 * PRIVATE, per-user, cross-LEAGUE exposure — genuinely new capability built in
 * this phase. NOT the Knowledge Graph's anonymized, privacy-gated, cross-USER
 * PlayerExposure aggregate (Phase 3) — never mixed into the same type or
 * store. See README for the full distinction.
 */
export interface UserPlayerExposure {
  playerId: string
  playerName: string | null
  position: string | null
  leagueCount: number
  rosterCount: number
  startingCount: number
  benchCount: number
  irTaxiCount: number
  /** startingCount+benchCount+irTaxiCount / connectedLeagueCount — 0 when the user has no connected leagues. */
  exposurePercent: number
  leaguesRequiringAttention: string[]
  injuryStatus: string | null
  gameWindow: GameWindowId | null
}

export type GameWindowId = string

export interface GameWindow {
  id: GameWindowId
  sport: string
  label: string
  startTime: string | null
  endTime: string | null
  gameCount: number
}

export type LineupAttentionReasonCode =
  | 'starter_ruled_out'
  | 'starter_inactive'
  | 'starter_suspended'
  | 'starter_questionable_or_doubtful'
  | 'game_already_locked'
  | 'empty_starting_slot'
  | 'invalid_lineup'
  | 'injured_player_on_bench'
  | 'healthy_player_on_ir'
  | 'starter_game_postponed_or_cancelled'
  | 'bench_out_projecting_starter'
  | 'missing_projection'
  | 'stale_player_status'
  | 'multi_league_exposure_risk'
  | 'lineup_deadline_approaching'
  | 'legacy_engine_reported_issue'

export interface LineupAttentionItem {
  reasonCode: LineupAttentionReasonCode
  severity: 'critical' | 'warning' | 'info'
  message: string
  leagueId: string
  leagueName: string | null
  rosterId: string | null
  playerId: string | null
  playerName: string | null
  evidence: string[]
  freshness: SourceAttribution['freshness']
  sourceAttribution: SourceAttribution
  confidence: number
  risk: 'low' | 'medium' | 'high'
  actionable: boolean
  providerDeepLink: string | null
}

export interface ManagerTendencyContext {
  status: 'ok' | 'gated' | 'unavailable'
  reason: string | null
  profile: ManagerBehaviorProfile | null
}

export interface GameDayDivergenceItem {
  category:
    | 'missing_league'
    | 'missing_roster'
    | 'missing_player'
    | 'starter_mismatch'
    | 'score_mismatch'
    | 'projection_mismatch'
    | 'status_mismatch'
    | 'game_state_mismatch'
    | 'freshness_mismatch'
    | 'alert_severity_mismatch'
  leagueId: string
  playerId: string | null
  primaryValue: string | null
  legacyValue: string | null
  notes: string[]
}

export interface GameDaySnapshot {
  snapshotId: string
  userId: string
  generatedAt: string
  includedLeagueIds: string[]
  leagues: LeagueGameDayContext[]
  exposures: UserPlayerExposure[]
  attentionItems: LineupAttentionItem[]
  gameWindows: GameWindow[]
  managerTendency: ManagerTendencyContext
  dataQuality: {
    leagueCount: number
    unavailableLeagueCount: number
    staleMatchupCount: number
  }
  freshnessSummary: {
    oldestFetchedAt: string | null
    newestFetchedAt: string | null
  }
  divergence: GameDayDivergenceItem[]
}
