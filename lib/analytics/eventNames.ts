/** Canonical analytics event names (stored in `AnalyticsEvent.event`). */

export const ANALYTICS_TOOL_PRODUCT = 'af_product'
export const ANALYTICS_TOOL_ENGINE = 'af_engine'

/** Create-league funnel (client beacon + server confirmation). */
export const CREATE_LEAGUE = {
  FUNNEL_OPEN: 'product.create_league.funnel_open',
  STEP_ENTER: 'product.create_league.step_enter',
  STEP_DURATION: 'product.create_league.step_duration',
  SUBMIT: 'product.create_league.submit',
  SUCCESS_CLIENT: 'product.create_league.success_client',
  FAIL_CLIENT: 'product.create_league.fail_client',
  FUNNEL_ABANDON: 'product.create_league.funnel_abandon',
  SERVER_SUCCESS: 'product.create_league.server_success',
  SERVER_FAIL: 'product.create_league.server_fail',
} as const

/** Engagement (server or client). */
export const ENGAGEMENT = {
  DRAFT_COMPLETED: 'engagement.draft_completed',
  WAIVER_RUN: 'engagement.waiver_run_completed',
  TRADE_PROCESSED: 'engagement.trade_processed',
  MATCHUP_CENTER_VIEW: 'engagement.matchup_center_view',
  COMMISSIONER_SETTINGS: 'engagement.commissioner_settings_save',
  /** User claimed an open team via invite link (`/join/[token]`). */
  JOIN_INVITE_TEAM_CLAIM: 'engagement.join_invite.team_claim',
} as const

export const AI_USAGE = {
  MATCHUP_ANALYSIS: 'ai.matchup_analysis',
  START_SIT: 'ai.start_sit',
} as const

/** Live draft room (client beacons — complements server draft lifecycle). */
export const DRAFT_ROOM = {
  START_DRAFT: 'engagement.draft_room.start_draft',
  PICK: 'engagement.draft_room.pick',
  QUEUE_ADD: 'engagement.draft_room.queue_add',
  NOMINATE: 'engagement.draft_room.nominate',
  CHAT_SEND: 'engagement.draft_room.chat_send',
  MOBILE_TAB: 'engagement.draft_room.mobile_tab',
  FILTER_POSITION: 'engagement.draft_room.filter_position',
  FILTER_TEAM: 'engagement.draft_room.filter_team',
  POOL_FILTER: 'engagement.draft_room.pool_filter',
  SORT: 'engagement.draft_room.sort',
  SEARCH: 'engagement.draft_room.search',
  AUTOPICK_QUEUE: 'engagement.draft_room.autopick_queue',
  AWAY_MODE: 'engagement.draft_room.away_mode',
  AI_ADP_SORT: 'engagement.draft_room.ai_adp_sort',
  AI_QUEUE_REORDER: 'engagement.draft_room.ai_queue_reorder',
  AI_REORDER_EXPLAIN_TOGGLE: 'engagement.draft_room.ai_reorder_explain_toggle',
  /** Successful copy of invite link from draft top bar (inline or menu). */
  INVITE_COPY: 'engagement.draft_room.invite_copy',
  /** Commissioner toggles league-wide auto-pick (Draft UI settings). */
  COMMISSIONER_AUTOPICK_LEAGUE: 'engagement.draft_room.commissioner_autopick_league',
  /** Commissioner toggles “force auto-pick” for orphan/expired flows. */
  COMMISSIONER_FORCE_AUTOPICK: 'engagement.draft_room.commissioner_force_autopick',
  /** Member without a roster claims a placeholder team from the draft manager strip. */
  CLAIM_SLOT: 'engagement.draft_room.claim_slot',
  /** Opened draft pick trade modal from a board cell (prefilled offer). */
  TRADE_OPEN_FROM_BOARD: 'engagement.draft_room.trade_open_from_board',
} as const

/** World Cup AI CTA panel events (client-side beacons). */
export const WORLD_CUP_CTA = {
  /** Panel mounted and chips became visible (fires once per mount). */
  VIEWED: 'wc.ai_cta.viewed',
  /** User clicked an unlocked CTA chip. */
  CLICKED: 'wc.ai_cta.clicked',
  /** User clicked a locked CTA chip (shows they noticed it but aren't entitled). */
  LOCKED_CLICKED: 'wc.ai_cta.locked_clicked',
  /** User clicked an upgrade/unlock link next to a tier row label. */
  UPGRADE_CLICKED: 'wc.ai_cta.upgrade_clicked',
  /** API call completed successfully and a result was rendered. */
  SUCCESS: 'wc.ai_cta.success',
  /** API call failed or returned an error. */
  ERROR: 'wc.ai_cta.error',
  /** Token-confirmation dialog was surfaced to the user (status 409). */
  TOKEN_CONFIRM_OPENED: 'wc.ai_cta.token_confirm_opened',
  /** User accepted the token-confirmation dialog. */
  TOKEN_CONFIRM_ACCEPTED: 'wc.ai_cta.token_confirm_accepted',
} as const

/** World Cup Daily Edge Report events (client-side beacons). */
export const WORLD_CUP_EDGE_REPORT = {
  /** Card mounted and deterministic sections became visible. */
  VIEWED: 'wc.edge_report.viewed',
  /** User clicked the "Unlock coaching" button. */
  UNLOCK_CLICKED: 'wc.edge_report.unlock_clicked',
  /** User confirmed the token spend dialog. */
  TOKEN_CONFIRMED: 'wc.edge_report.token_confirmed',
  /** Coaching was served from cache (same-day free repeat access). */
  CACHE_HIT: 'wc.edge_report.cache_hit',
  /** Coaching block successfully rendered (after POST returns coaching data). */
  COACHING_LOADED: 'wc.edge_report.coaching_loaded',
  /** Fetch or coaching generation returned an error. */
  ERROR: 'wc.edge_report.error',
  /** Commissioner clicked "Post to pool chat" on the coaching post idea. */
  POST_TO_CHAT_CLICKED: 'wc.edge_report.post_to_chat_clicked',
  /** User clicked a feedback button (👍/👎 + optional not-helpful reason). */
  FEEDBACK_CLICKED: 'wc.edge_report.feedback_clicked',
} as const

/** Engine / ops (often sampled before persist). */
export const ENGINE = {
  JOB: 'engine.job',
  API_FAILURE: 'engine.api_failure',
  NOTIFICATION_DISPATCH: 'engine.notification_dispatch',

  // ── Draft room server-side telemetry ───────────────────────────────────────
  // These events are written at 10 % sample rate (AF_ANALYTICS_ENGINE_SAMPLE_RATE)
  // so they don't overwhelm the AnalyticsEvent table at peak draft volume.

  /** A draft pick was accepted and persisted. */
  DRAFT_PICK_SUBMITTED: 'engine.draft.pick_submitted',
  /**
   * A pick returned DRAFT_PICK_RACE_RETRY (P2002 unique-constraint collision or
   * optimistic-lock sentinel mismatch). Track rate to decide if pessimistic
   * Redis locking is warranted (threshold: >2 % of picks in prod).
   */
  DRAFT_PICK_RACE: 'engine.draft.pick_race',
  /** GET /api/leagues/[id]/draft/session (state poll). */
  DRAFT_STATE_POLL: 'engine.draft.state_poll',
  /** POST /api/draft/[draftId]/pusher-auth (Pusher channel auth). */
  PUSHER_AUTH: 'engine.draft.pusher_auth',

  // ── Distributed lock telemetry ─────────────────────────────────────────────
  /**
   * Another Vercel instance held the per-league draft lock when this instance
   * tried to acquire it. Signals a genuine concurrent write; client should 409.
   */
  DRAFT_LOCK_CONTENDED: 'engine.draft.lock_contended',
  /**
   * Redis + Postgres lock infrastructure both unavailable. Request proceeded
   * without a lock (fail-open) — DB constraints remain the safety layer.
   */
  DRAFT_LOCK_TIMEOUT: 'engine.draft.lock_timeout',
} as const

/**
 * Legacy Honesty Pack — states where the UI told the user the truth about data quality.
 * Payloads must never contain Sleeper usernames, emails, league names, or provider data.
 */
export const LEGACY_HONESTY = {
  // `product.` prefix keeps these inside the client beacon's allowlist
  // (app/api/analytics/beacon) so impressions fire client-side ONCE per notice, never
  // per status poll.
  AUTH_REQUIRED_SHOWN: 'product.legacy_honesty.auth_required_shown',
  LINK_REQUIRED_SHOWN: 'product.legacy_honesty.link_required_shown',
  IMPORT_PARTIAL_SHOWN: 'product.legacy_honesty.import_partial_shown',
  IMPORT_FAILED_SHOWN: 'product.legacy_honesty.import_failed_shown',
  DATA_STALE_SHOWN: 'product.legacy_honesty.data_stale_shown',
  EXTERNAL_PLATFORM_REDIRECT_CLICKED: 'product.legacy_honesty.external_platform_redirect_clicked',
  INTELLIGENCE_LOW_CONFIDENCE_SHOWN: 'product.legacy_honesty.intelligence_low_confidence_shown',
  RETRY_CLICKED: 'product.legacy_honesty.retry_clicked',
} as const
