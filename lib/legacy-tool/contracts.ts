export type LegacyTaskType =
  | 'trade_analysis'
  | 'trade_counter'
  | 'waiver_analysis'
  | 'add_drop_analysis'
  | 'lineup_optimization'
  | 'start_sit'
  | 'draft_pick'
  | 'ranking_explanation'
  | 'roster_strategy'
  | 'league_fairness_review'
  | 'commissioner_review'
  | 'admin_risk_review'
  | 'notification_generation'

export type LegacyPriority = 'low' | 'medium' | 'high'

export interface LegacyOrchestratorPlan {
  task_types: LegacyTaskType[]
  required_context: string[]
  engines: string[]
  priority: LegacyPriority
  needs_grok_overlay: boolean
  needs_simulation: boolean
  needs_commissioner_alert_check: boolean
}

export interface PlayerState {
  player_id: string
  name: string
  sport: string
  position: string
  team: string
  status: string
  injury_level: number
  depth_chart_role: string | null
  special_teams_role: string | null
  defensive_role: string | null
  snap_share_trend: number
  route_share_trend: number
  usage_trend: number
  red_zone_trend: number
  projection_weekly: number
  projection_ros: number
  projection_dynasty: number
  market_value: number
  x_sentiment_score: number
  x_volatility_score: number
  news_confidence: number
  last_news_at: string
  cluster_profile: string
}

export interface CommissionerAlert {
  required: boolean
  severity: 'low' | 'medium' | 'high'
  reason_codes: string[]
}

export type GrokCriticalEventType =
  | 'injury_update'
  | 'trade_update'
  | 'suspension'
  | 'depth_chart_change'
  | 'role_change'
  | 'signing_update'
  | 'coach_signal'
  | 'sentiment_surge'
  | 'special_teams_role_change'
  | 'defensive_role_change'
