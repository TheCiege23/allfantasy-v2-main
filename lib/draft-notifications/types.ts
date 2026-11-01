/**
 * Draft notification event types. Deterministic, event-driven.
 * Supports NFL, NHL, NBA, MLB, NCAAB, NCAAF, Soccer.
 */

export const DRAFT_NOTIFICATION_EVENT_TYPES = [
  'draft_on_the_clock',
  'draft_three_picks_away',
  'draft_two_picks_away',
  'draft_next_pick',
  'draft_time_set',
  'draft_started',
  'draft_ended',
  'draft_approaching_timeout',
  'draft_auto_pick_fired',
  'draft_queue_player_unavailable',
  'draft_paused',
  'draft_resumed',
  'draft_trade_offer_received',
  'draft_ai_trade_review_available',
  'draft_orphan_ai_assigned',
  'draft_auction_outbid',
  'draft_slow_reminder',
  'draft_starting_soon',
  'draft_intel_queue_ready',
  'draft_intel_player_taken',
  'draft_intel_on_clock_urgent',
  'draft_intel_pick_confirmation',
  'draft_intel_tier_break',
  'draft_intel_orphan_team_pick',
  'draft_intel_post_draft_recap',
] as const

export type DraftNotificationEventType = (typeof DRAFT_NOTIFICATION_EVENT_TYPES)[number]

export interface DraftNotificationPayload {
  leagueId: string
  leagueName?: string
  pickLabel?: string
  round?: number
  slot?: number
  rosterId?: string
  displayName?: string
  playerName?: string
  source?: string
  /** Stable identity for this draft event, independent of the producing system. */
  eventKey?: string
  draftTime?: string
  tradeProposalId?: string
  /** For auction_outbid: previous bid amount. */
  previousBid?: number
  /** For slow_reminder: minutes until pick due. */
  minutesRemaining?: number
  availabilityProbability?: number
  playerNames?: string[]
  recap?: string
}
