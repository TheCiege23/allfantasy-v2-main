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
