/**
 * Canonical league fan-out event types for notifications + activity feed + realtime hints.
 * Keep strings stable — stored in ActivityEvent.type and PlatformNotification.type.
 */

const LEAGUE_FANOUT_EVENT_TYPES = [
  'league_created',
  'settings_changed',
  'lifecycle_transition',
  'draft_started',
  'draft_pick',
  'draft_paused',
  'draft_resumed',
  'draft_completed',
  'trade_proposed',
  'trade_countered',
  'trade_accepted',
  'trade_rejected',
  'trade_vetoed',
  'trade_processed',
  'af_trade_proposed',
  'af_trade_awaiting_commissioner',
  'af_trade_veto_window',
  'af_trade_processed',
  'waiver_claim_submitted',
  'waiver_processed',
  'lineup_updated',
  'lineup_lock_warning',
  'matchup_updated',
  /** Debounced SSE hint — score/projection tick (no guaranteed DB row; see realtime-event service). */
  'matchup_live_tick',
  'score_finalized',
  'score_milestone',
  'standings_updated',
  'playoff_seeds_updated',
  'playoff_advancement',
  'player_injury_update',
  'player_news_update',
  'specialty_automation',
  'commissioner_override',
  'import_completed',
  'import_needs_review',
] as const

export type LeagueFanoutEventType = (typeof LEAGUE_FANOUT_EVENT_TYPES)[number]

export type LeagueEventVisibility = 'all_members' | 'commissioners_only'
