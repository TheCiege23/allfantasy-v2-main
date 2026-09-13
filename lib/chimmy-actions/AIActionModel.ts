/**
 * AI Action Object Model
 * Shared TypeScript types for the AllFantasy unified AI Actions system.
 * Every Chimmy recommendation can be bound to an AIAction that connects to a real app workflow.
 */

import type { SourceLink } from '@/lib/league-links/sourceLinkResolver'
import type { AIActionWriteScope, StagedWriteAuthority } from './AIActionWriteScope'

// ─── Action Types ──────────────────────────────────────────────────────────────

export type AIActionType =
  // Draft
  | 'queue_player'
  | 'auto_queue_best_3'
  | 'draft_player'
  | 'set_auction_bid'
  | 'bookmark_player'
  | 'compare_draft_options'
  // Waiver
  | 'claim_player'
  | 'add_to_watchlist'
  | 'set_faab_bid'
  | 'drop_player_for_claim'
  | 'compare_claims'
  | 'save_waiver_plan'
  // Lineup
  | 'start_player'
  | 'bench_player'
  | 'optimize_lineup'
  | 'optimize_bench'
  | 'swap_players'
  | 'save_lineup'
  // Trade
  | 'analyze_trade'
  | 'propose_trade'
  | 'generate_counter'
  | 'save_counter_draft'
  | 'ai_trade_review'
  | 'share_trade_summary'
  // Roster
  | 'drop_player'
  | 'move_to_bench'
  | 'move_to_ir'
  | 'move_to_il'
  | 'move_to_taxi'
  | 'move_to_devy'
  | 'compare_replacement'
  | 'flag_trade_block'
  | 'save_future_move'
  // Matchup
  | 'simulate_matchup'
  | 'try_alternate_starter'
  | 'optimize_ceiling'
  | 'optimize_floor'
  | 'optimize_categories'
  | 'save_matchup_strategy'
  // Commissioner
  | 'draft_announcement'
  | 'post_recap'
  | 'send_warning'
  | 'approve_issue'
  | 'generate_rule_update'
  | 'open_health_report'
  // Discovery
  | 'join_league'
  | 'save_league'
  | 'compare_leagues'
  | 'ask_why_fit'
  // General
  | 'open_deep_dive'
  | 'save_recommendation'
  | 'schedule_reminder'
  | 'compare_alternatives'
  | 'post_to_league_chat'
  | 'start_simulation'

// ─── Classification Types ───────────────────────────────────────────────────────

/** Controls how the action is executed in the UI */
export type AIActionSafetyClass =
  | 'instant'     // No confirmation; directly open modal, navigate, or save
  | 'confirmed'   // User must approve a confirm modal before execution
  | 'restricted'  // Role- or premium-gated; show upgrade / role message if denied

/** Permission level required to execute an action */
export type AIActionPermission =
  | 'member'
  | 'co_owner'
  | 'commissioner'
  | 'admin'
  | 'premium'
  | 'commissioner_subscription'

/** Surface the action originates from */
export type AIActionSurface =
  | 'dashboard'
  | 'league_home'
  | 'draft_room'
  | 'roster'
  | 'matchup'
  | 'waiver_wire'
  | 'trade_center'
  | 'player_page'
  | 'team_page'
  | 'league_chat'
  | 'chimmy_chat'
  | 'commissioner_panel'
  | 'notifications'
  | 'discovery'

/** Canonical workflow types that can receive AI prefill payloads */
export type AIWorkflowType =
  | 'draft_queue'
  | 'draft_pick'
  | 'auction_bid'
  | 'waiver_claim'
  | 'watchlist'
  | 'lineup_edit'
  | 'trade_compose'
  | 'trade_analysis'
  | 'chat_compose'
  | 'roster_move'
  | 'league_discovery'
  | 'simulation'
  | 'announcement'
  | 'saved_items'
  | 'deep_dive'

/** Structured prefill contract used by editable workflows before submit */
export interface AIWorkflowPrefill {
  workflowType: AIWorkflowType
  sport?: string | null
  leagueId?: string | null
  teamId?: string | null
  values: Record<string, unknown>
}

// ─── Core AIAction Object ───────────────────────────────────────────────────────

/**
 * The unified AI Action object — every Chimmy recommendation binds to one of these.
 */
export interface AIAction {
  /** Unique identifier for this action instance */
  id: string
  /** The action category */
  type: AIActionType
  /** Short display label shown on the button */
  label: string
  /** One-sentence description of what will happen when executed */
  description: string
  /** Surface this action belongs to */
  surface: AIActionSurface | string
  /** Scoped league, if any */
  leagueId?: string | null
  /** Scoped team, if any */
  teamId?: string | null
  /** Sport context */
  sport?: string | null
  /** League format context */
  leagueType?: string | null
  /** How confirmation is handled */
  safetyClass: AIActionSafetyClass
  /** Should a confirmation modal appear before executing? */
  requiresConfirmation: boolean
  /** Is this action commissioner/co-owner only? */
  requiresCommissioner: boolean
  /** Is a premium subscription required? */
  requiresPremium: boolean
  /** All required permissions (checked by permission guard) */
  requiredPermissions: AIActionPermission[]
  /** Whether the action can presently be executed */
  isAvailable: boolean
  /** Human-readable reason the action is unavailable, or null if available */
  disabledReason: string | null
  /** Action-specific payload (player IDs, bid amounts, trade assets, etc.) */
  payload: Record<string, unknown>
  /** Optional chained action to trigger after this one completes */
  followUpAction?: Omit<AIAction, 'followUpAction'> | null
  /** Target workflow modal/page to open and prefill (e.g. 'waiver_claim_modal') */
  prefillTarget?: string | null
  /** Data to pre-populate into the target workflow */
  prefillData?: Record<string, unknown>
  /** Normalized prefill contract consumed by workflow launchers */
  workflowPrefill?: AIWorkflowPrefill | null
  /** Internal route to open for deep-dive (e.g. '/leagues/[id]/analysis') */
  deepDiveHref?: string | null
  /** Whether this action can cause irreversible changes (drop, claim with drop) */
  isDestructive?: boolean
  /** Label shown on the premium badge when action is locked */
  premiumBadgeLabel?: string
}

// ─── Context ────────────────────────────────────────────────────────────────────

/**
 * Runtime context provided to all action validation and binding operations.
 */
export interface AIActionContext {
  userId: string
  /** The user's role in this league (null for non-league surfaces) */
  role: 'member' | 'co-owner' | 'commissioner' | 'admin' | null
  sport: string
  leagueType: string
  leagueId?: string | null
  teamId?: string | null
  subscriptionState: {
    hasPremium: boolean
    hasCommissioner: boolean
    hasAdmin: boolean
  }
  leagueState: {
    /** Global lock (end-of-season, admin lock, etc.) */
    isLocked: boolean
    isWaiverOpen: boolean
    isLineupLocked: boolean
    isDraftActive: boolean
    isDraftComplete: boolean
    isTradeDeadlinePast: boolean
    isInPlayoffs: boolean
    currentWeek?: number
  }
  rosterState?: {
    hasIR: boolean
    hasIL: boolean
    hasTaxi: boolean
    hasDevy: boolean
  }
  /** Optional transaction legality flags resolved on the server */
  transactionState?: {
    canTransact?: boolean
    maxTransactionsReached?: boolean
    rosterMoveLocked?: boolean
    pendingCommissionerApproval?: boolean
  }
}

// ─── Result ─────────────────────────────────────────────────────────────────────

/** Result returned from executing or staging an AI action. */
export interface AIActionResult {
  success: boolean
  actionId: string
  actionType: AIActionType
  message: string
  error?: string
  /** Whether prefill data was applied to a workflow */
  prefillApplied?: boolean
  /** Route to navigate to, if any */
  navigateTo?: string | null
  /** Extra data returned from the workflow */
  data?: Record<string, unknown>
  /**
   * What actually happened. `executeAIAction` only ever STAGES: it validates and returns a
   * prefill, and the manager still has to submit it. Nothing here is a completed write.
   */
  outcome?: 'staged' | 'failed'
  /** Always false today — no AI action writes on the manager's behalf. */
  executed?: false
  /** What the action would change once submitted; null when it changes nothing. */
  writeScope?: AIActionWriteScope
  /** Where a submit would land. Null when the league's authority could not be resolved. */
  writeAuthority?: StagedWriteAuthority | null
  /** For an imported league: the host-platform page where the change has to be made. */
  sourceLink?: SourceLink | null
}

// ─── Telemetry Event ────────────────────────────────────────────────────────────

/** Lifecycle telemetry event emitted for AI action usage tracking. */
export interface AIActionEvent {
  id: string
  actionType: AIActionType
  surface: string
  userId: string
  leagueId?: string | null
  teamId?: string | null
  sport?: string | null
  /**
   * `staged` — validated and prefilled, not yet submitted. `completed` is reserved for a change
   * that actually happened; staging must never be logged as completion.
   */
  event: 'shown' | 'clicked' | 'confirmed' | 'staged' | 'completed' | 'dismissed' | 'saved' | 'failed'
  timestamp: number
  /** Time from click to completion in milliseconds */
  durationMs?: number
  metadata?: Record<string, unknown>
}

// ─── Saved Recommendation ───────────────────────────────────────────────────────

/** Status lifecycle for a unified saved recommendation. */
export type SavedRecommendationStatus =
  | 'saved'
  | 'acted_on'
  | 'dismissed'
  | 'stale'

/** Category of recommendation, maps to sourceSurface content type. */
export type RecommendationCategory =
  | 'waiver'
  | 'trade'
  | 'lineup'
  | 'start_sit'
  | 'draft'
  | 'player_comparison'
  | 'matchup_simulation'
  | 'roster_strategy'
  | 'story_draft'
  | 'commissioner_announcement'
  | 'league_health'
  | 'general'

/** A saved AI recommendation the user can restore and act on later. */
export interface SavedAIRecommendation {
  id: string
  userId: string
  leagueId?: string | null
  sport: string
  leagueType: string
  surface: string
  recommendationText: string
  action: AIAction
  savedAt: number
  expiresAt?: number | null
  actedOn?: boolean
  actedOnAt?: number | null
}

/**
 * Unified rich saved recommendation — the canonical model for the Saved
 * Recommendations system. Extends the legacy SavedAIRecommendation shape with
 * the full structured payload required for comparison and actioning.
 */
export interface UnifiedSavedRecommendation {
  /** UUIDv4 */
  id: string
  userId: string
  /** League scope (null = global/cross-league) */
  leagueId: string | null
  sport: string
  leagueType: string
  /** Human-readable short title, e.g. "Start Jefferson over Cooper" */
  title: string
  /** 1-3 sentence summary shown in list view */
  summary: string
  /** Category driving display routing */
  recommendationType: RecommendationCategory
  /** Full structured Chimmy output — preserved for comparison */
  recommendationPayload: Record<string, unknown>
  /** Full explanation shown on detail view */
  explanation: string
  /** 0.0–1.0 */
  confidence: number
  riskLevel: 'low' | 'medium' | 'high' | 'critical' | null
  /** Bound AI actions that can be executed from the detail view */
  actions: AIAction[]
  /** Surface this rec was generated on (e.g. "waiver_wire", "trade_center") */
  sourceSurface: string
  createdAt: number
  updatedAt: number
  expiresAt: number | null
  isArchived: boolean
  status: SavedRecommendationStatus
  /** Commissioner-specific: was this saved by a commissioner for league use? */
  isCommissionerRec?: boolean
  /** Snapshot hash used for stale-detection comparison */
  payloadHash?: string | null
}

// ─── Binding Input ──────────────────────────────────────────────────────────────

/**
 * Input to the AIActionBindingService — either structured fields or raw text.
 */
export interface BindingInput {
  /** Raw recommendation text from Chimmy (used to infer action type if not structured) */
  recommendationText?: string
  /** Direct action type hint from a structured Chimmy response */
  recommendationType?: AIActionType
  sport: string
  leagueType: string
  leagueId?: string | null
  teamId?: string | null
  /** Entities referenced in the recommendation */
  entities?: {
    playerIds?: string[]
    playerNames?: string[]
    teamIds?: string[]
    tradeAssets?: string[]
    bidAmount?: number
    leagueIdTarget?: string
    slots?: string[]
  }
  /** Chimmy confidence level (0–100) */
  confidencePct?: number
  /** Surface this recommendation appeared on */
  surface: AIActionSurface | string
}

// ─── Feed Recommendation ────────────────────────────────────────────────────────

/**
 * A single recommendation item used by ChimmySurfaceActionFeed and
 * ChimmyActionRecommendationCard. Bridges Chimmy AI output to the action system.
 */
export interface ChimmyFeedRecommendation {
  /** Unique card key (must be stable for React keys) */
  id: string
  /** Main recommendation headline, e.g. "Start Jefferson over Cooper" */
  headline: string
  /** Short 1-2 sentence rationale shown below the headline */
  reason: string
  /** Confidence percentage 0–100 */
  confidencePct?: number
  /** Risk level for the risk badge */
  riskLevel?: 'low' | 'medium' | 'high' | 'critical'
  /** Optional tag label, e.g. "Waiver", "Lineup", "Trade" */
  actionType?: string
  /** The primary recommended action */
  primaryAction?: AIAction
  /** Supporting secondary actions */
  secondaryActions?: AIAction[]
  /** Full analysis shown in the deep dive panel */
  detailedAnalysis?: string
  /** Supporting data description */
  evidence?: string
  /** Caveats / uncertainty notes */
  caveats?: string[]
  /** Alternative options to surface in the deep dive */
  alternatives?: string[]
  /** Whether this recommendation has been saved by the user */
  isSaved?: boolean
  /** Whether this recommendation has been dismissed */
  isDismissed?: boolean
}
