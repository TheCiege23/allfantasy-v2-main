import type { DraftAutomationFeature, DraftFeaturePolicy } from './types'

const CATALOG: Record<DraftAutomationFeature, DraftFeaturePolicy> = {
  timer_engine: {
    feature: 'timer_engine',
    lane: 'deterministic_required',
    aiOptional: false,
    description: 'Server-authoritative draft timer progression.',
  },
  draft_order_engine: {
    feature: 'draft_order_engine',
    lane: 'deterministic_required',
    aiOptional: false,
    description: 'Pick order resolution for snake/linear/3RR.',
  },
  pick_ownership_resolver: {
    feature: 'pick_ownership_resolver',
    lane: 'deterministic_required',
    aiOptional: false,
    description: 'Current owner resolution for traded picks.',
  },
  draft_queue_reorder_engine: {
    feature: 'draft_queue_reorder_engine',
    lane: 'rules_engine',
    aiOptional: false,
    description: 'Deterministic queue reorder by need/availability.',
  },
  cpu_draft_baseline_mode: {
    feature: 'cpu_draft_baseline_mode',
    lane: 'rules_engine',
    aiOptional: false,
    description: 'Rules-based CPU pick baseline for auto drafting.',
  },
  player_filter_sort_search: {
    feature: 'player_filter_sort_search',
    lane: 'deterministic_required',
    aiOptional: false,
    description: 'Player search/filter/sort actions.',
  },
  bye_week_display: {
    feature: 'bye_week_display',
    lane: 'deterministic_required',
    aiOptional: false,
    description: 'Bye-week display from deterministic player data.',
  },
  roster_position_validation: {
    feature: 'roster_position_validation',
    lane: 'deterministic_required',
    aiOptional: false,
    description: 'Roster slot and position legality checks.',
  },
  player_availability_state: {
    feature: 'player_availability_state',
    lane: 'deterministic_required',
    aiOptional: false,
    description: 'Availability from drafted state and pool.',
  },
  sport_specific_eligibility: {
    feature: 'sport_specific_eligibility',
    lane: 'deterministic_required',
    aiOptional: false,
    description: 'Sport-aware eligibility and round gating.',
  },
  pick_trade_ownership_resolution: {
    feature: 'pick_trade_ownership_resolution',
    lane: 'deterministic_required',
    aiOptional: false,
    description: 'Trade acceptance and ownership transfer logic.',
  },
  commissioner_automation_controls: {
    feature: 'commissioner_automation_controls',
    lane: 'deterministic_required',
    aiOptional: false,
    description: 'Commissioner controls with permission checks.',
  },
  ai_adp_aggregation_job: {
    feature: 'ai_adp_aggregation_job',
    lane: 'scheduled_cached',
    aiOptional: false,
    description: 'Scheduled ADP aggregation and snapshot persistence.',
  },
  asset_ingestion_caching: {
    feature: 'asset_ingestion_caching',
    lane: 'scheduled_cached',
    aiOptional: false,
    description: 'Image/logo/stat ingestion and cache lifecycle.',
  },
  post_draft_summary_calculations: {
    feature: 'post_draft_summary_calculations',
    lane: 'scheduled_cached',
    aiOptional: false,
    description: 'Deterministic post-draft summary calculations.',
  },
  draft_helper_recommendation_engine: {
    feature: 'draft_helper_recommendation_engine',
    lane: 'rules_engine',
    aiOptional: false,
    description: 'Deterministic best-pick recommendation engine.',
  },
  explain_best_pick: {
    feature: 'explain_best_pick',
    lane: 'ai_optional',
    aiOptional: true,
    description: 'Human-style explanation for recommended pick.',
  },
  explain_reach_vs_value: {
    feature: 'explain_reach_vs_value',
    lane: 'ai_optional',
    aiOptional: true,
    description: 'Narrative interpretation of reach/value context.',
  },
  explain_positional_need: {
    feature: 'explain_positional_need',
    lane: 'ai_optional',
    aiOptional: true,
    description: 'Narrative explanation for positional needs.',
  },
  private_trade_review: {
    feature: 'private_trade_review',
    lane: 'ai_optional',
    aiOptional: true,
    description: 'Private trade reasoning narrative for receiver.',
  },
  counter_trade_suggestion: {
    feature: 'counter_trade_suggestion',
    lane: 'ai_optional',
    aiOptional: true,
    description: 'Counter-trade strategy synthesis.',
  },
  explain_draft_recap: {
    feature: 'explain_draft_recap',
    lane: 'ai_optional',
    aiOptional: true,
    description: 'Post-draft recap narration.',
  },
  explain_ai_queue_reorder_rationale: {
    feature: 'explain_ai_queue_reorder_rationale',
    lane: 'ai_optional',
    aiOptional: true,
    description: 'Optional Chimmy wording for queue reorder rationale.',
  },
  narrative_league_story_recap: {
    feature: 'narrative_league_story_recap',
    lane: 'ai_optional',
    aiOptional: true,
    description: 'Narrative league story recap.',
  },
  premium_coach_style_advice: {
    feature: 'premium_coach_style_advice',
    lane: 'ai_optional',
    aiOptional: true,
    description: 'Premium coaching style advisory output.',
  },
}

export function getDraftFeatureCatalog(): DraftFeaturePolicy[] {
  return Object.values(CATALOG)
}

export function getDraftFeaturePolicy(feature: DraftAutomationFeature): DraftFeaturePolicy {
  return CATALOG[feature]
}
