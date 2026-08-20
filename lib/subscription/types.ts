/**
 * Subscription and entitlement types for gating (useEntitlement, LockedFeatureCard).
 * PROMPT 287 — Monetization QA; single source for feature IDs and plan mapping.
 */

/** Feature IDs used for hasAccess(featureId). Matches useEntitlement plan mapping. */
export type SubscriptionFeatureId =
  /** Enterprise Fantasy OS executive workspace access — gates the /fantasy-os route + nav. */
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
  | 'war_room_dynasty_projections'
  | 'war_room_devy_rankings'
  | 'war_room_draft_strategy'
  | 'war_room_pipeline_analysis'
  /** League hub AI Coaching tab + long-term coaching API (AF Pro — `af_pro_monthly` / `af_pro_yearly`). */
  | 'league_ai_coaching'
  /** Commissioner-level AI waiver tools: settings health, suspicious behavior, collusion risk (AF Commissioner). */
  | 'commissioner_waiver_ai'
  // /af-legacy deep-action gates (AF Legacy — war_room). Preview/description content on each
  // tab stays open to everyone; only the actual analysis-trigger button requires this.
  | 'legacy_trade_proposals'
  | 'legacy_trade_finder'
  | 'legacy_waiver_analysis'
  | 'legacy_manager_compare'
  | 'legacy_rankings_analysis'
  | 'legacy_social_pulse'

/** Plan slugs returned by entitlements API; used for hasAccess. */
export type SubscriptionPlanId =
  | 'pro'
  | 'commissioner'
  | 'war_room'
  /** Top tier: AF Supreme — includes the full Pro + Commissioner + Legacy stack + highest token allowances. */
  | 'supreme'
  /** Enterprise workspace tier — grants the Fantasy OS executive workspace (`fantasy_os_workspace` feature). */
  | 'enterprise'

/** Entitlement status from GET /api/subscription/entitlements */
export type EntitlementStatus = 'active' | 'grace' | 'past_due' | 'expired' | 'none'
