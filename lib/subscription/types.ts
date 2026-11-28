/**
 * Subscription and entitlement types for gating (useEntitlement, LockedFeatureCard).
 * PROMPT 287 — Monetization QA; single source for feature IDs and plan mapping.
 */

/** Feature IDs used for hasAccess(featureId). Matches useEntitlement plan mapping. */
export type SubscriptionFeatureId =
  /** Enterprise Fantasy OS executive workspace — gates /fantasy-os and /fantasy-os/executive. No nav
   *  entry consumes it; that half of this comment was untrue and is not restored. */
  | 'fantasy_os_workspace'
  | 'trade_analyzer'
  | 'manager_psychology'
  | 'ai_chat'
  | 'ai_waivers'
  | 'planning_tools'
  | 'player_ai_recommendations'
  | 'matchup_explanations'
  | 'player_comparison_explanations'
  | 'advanced_scoring'
  | 'advanced_playoff_setup'
  | 'ai_collusion_detection'
  | 'ai_tanking_detection'
  | 'storyline_creation'
  | 'league_rankings'
  | 'draft_rankings'
  | 'ai_team_managers'
  | 'commissioner_automation'
  | 'draft_strategy_build'
  | 'draft_prep'
  /** The draft room's Chimmy pick explanation (POST /api/draft/recommend with includeAIExplanation; DraftHelperPanel, DraftHelperRedraftLayout). AF Pro, AF Legacy or AF Supreme (owner, 2026-11-28). The War Room's draft-planning card keeps `draft_prep` (AF Legacy). */
  | 'draft_room_ai_explanation'
  | 'future_planning'
  | 'multi_year_strategy'
  | 'draft_board_intelligence'
  | 'roster_construction_planning'
  | 'ai_planning_3_5_year'
  | 'guillotine_ai'
  | 'salary_cap_ai'
  | 'survivor_ai'
  /** Host / commissioner Survivor automation — Chimmy ops, grading, fairness (AF Commissioner or Supreme). */
  | 'survivor_host_ai'
  | 'big_brother_ai'
  | 'big_brother_host_ai'
  | 'zombie_ai'
  // UI / monetization catalog keys (same strings as former FeatureKey — unified with matrix IDs)
  | 'commissioner_ai_tools'
  | 'commissioner_draft_as_me'
  | 'commissioner_ai_narration'
  | 'commissioner_ai_recap'
  | 'commissioner_ai_copilot'
  | 'commissioner_ai_jury_briefing'
  | 'commissioner_nomination_analysis'
  | 'commissioner_pov_analysis'
  | 'commissioner_power_rankings'
  | 'commissioner_fairness_audit'
  | 'commissioner_constitution_generator'
  | 'commissioner_devy_scouting'
  | 'commissioner_idp_analysis'
  | 'commissioner_cap_advice'
  | 'commissioner_c2c_scouting'
  | 'commissioner_weather_projections'
  | 'commissioner_dispersal_draft'
  | 'commissioner_integrity_monitoring'
  | 'commissioner_chimmy_autopilot'
  | 'pro_draft_ai'
  | 'pro_waiver_ai'
  | 'pro_trade_ai'
  | 'pro_lineup_optimizer'
  | 'pro_start_sit'
  | 'pro_matchup_analysis'
  | 'pro_player_comparison'
  | 'pro_af_projections'
  | 'pro_snap_analysis'
  | 'pro_autocoach'
  /** AF Intelligence (owner, 2026-11-22): AF projections, AF ADP, the full trade breakdown and Chimmy's deep answers — AF Pro, AF Commissioner or AF Supreme. */
  | 'af_intelligence'
  | 'war_room_dynasty_projections'
  | 'war_room_devy_rankings'
  | 'war_room_draft_strategy'
  | 'war_room_pipeline_analysis'
  /** League hub AI Coaching tab + long-term coaching API (AF Pro — `af_pro_monthly` / `af_pro_yearly`). */
  | 'league_ai_coaching'
  /** /core/decisions — your logged decisions with their trade and outcome grades, and GET /api/legacy/decision-log. AF Pro (Supreme inherits it); not AF Commissioner alone. 2026-11-26. */
  | 'decision_log_history'
  /** Commissioner-level AI waiver tools: settings health, suspicious behavior, collusion risk (AF Commissioner). */
  | 'commissioner_waiver_ai'
  // /af-legacy deep-action gates (AF Legacy — war_room). Preview/description content on each
  // tab stays open to everyone; only the actual analysis-trigger button requires this.
  | 'legacy_trade_proposals'
  | 'legacy_trade_finder'
  /** The Trade Finder + Partner Match INSIDE /af-legacy (TradeFinderV2, /api/trade-finder, /matchmaking): the Trade Finder rule (AF Pro, AF Supreme) plus AF Legacy, so a Legacy buyer is not shown an AF Pro lock in their own product. 2026-11-27. */
  | 'legacy_tab_trade_finder'
  | 'legacy_waiver_analysis'
  | 'legacy_manager_compare'
  | 'legacy_rankings_analysis'
  | 'legacy_social_pulse'
  /** /af-legacy Trade Hub report + /af-legacy/trade-analyzer (POST /api/legacy/trade/analyze). AF Legacy, 2026-11-17. */
  | 'legacy_trade_hub'
  /** /af-legacy "Chimmy Analysis" career report (POST /api/legacy/ai/run). AF Legacy, 2026-11-17. */
  | 'legacy_ai_report'
  /** /af-legacy trade history: Chimmy's write-up on a graded trade ("grade") and "What could I have done instead?" (trade-alternatives). AF Legacy, 2026-11-27. */
  | 'legacy_trade_lookback'
  /** /af-legacy Transfer tab: Chimmy's storylines and rivalry narratives on the league preview (POST /api/legacy/transfer). AF Legacy, 2026-11-27. */
  | 'legacy_league_transfer'
  /** /af-legacy community insights: Chimmy's news summary (GET /api/legacy/community-insights?summarize=true). AF Legacy, 2026-11-27. */
  | 'legacy_community_insights'
  /** /af-legacy "Portfolio Over Time" chart (GET /api/legacy/portfolio/history): sign-in, then AF Legacy (Supreme inherits it). Owner, 2026-11-28. */
  | 'legacy_portfolio_history'

/** Plan slugs returned by entitlements API; used for hasAccess. */
export type SubscriptionPlanId =
  | 'pro'
  | 'commissioner'
  | 'war_room'
  /** AF Supreme — bundles AF Pro + AF Commissioner + AF Legacy (SUPREME_INCLUDED_PLAN_IDS; Legacy again since 2026-11-27). */
  | 'supreme'
  /** Enterprise workspace tier — grants the Fantasy OS executive workspace (`fantasy_os_workspace` feature). */
  | 'enterprise'

/** Entitlement status from GET /api/subscription/entitlements */
export type EntitlementStatus = 'active' | 'grace' | 'past_due' | 'expired' | 'none'
