import type { LeagueSport } from '@prisma/client'

export const AI_COMMISSIONER_ALERT_TYPES = [
  'LINEUP_REMINDER',
  'TRADE_REVIEW_FLAG',
  'COLLUSION_SIGNAL',
  'DISPUTE_CONTEXT',
  'VOTE_RECOMMENDATION',
  'INACTIVE_MANAGER_WARNING',
  'PLAYOFF_DEADLINE_REMINDER',
  'RULE_CONFLICT_NOTICE',
] as const

export type AICommissionerAlertType = (typeof AI_COMMISSIONER_ALERT_TYPES)[number]

export type AICommissionerSeverity = 'low' | 'medium' | 'high' | 'critical'
export type AICommissionerNotificationMode = 'off' | 'in_app' | 'chat' | 'both'
export type AICommissionerAlertStatus = 'open' | 'approved' | 'dismissed' | 'resolved' | 'snoozed'

export interface AICommissionerConfigView {
  configId: string
  leagueId: string
  sport: LeagueSport
  remindersEnabled: boolean
  disputeAnalysisEnabled: boolean
  collusionMonitoringEnabled: boolean
  voteSuggestionEnabled: boolean
  inactivityMonitoringEnabled: boolean
  commissionerNotificationMode: AICommissionerNotificationMode
  updatedAt: string
}

export interface AICommissionerAlertView {
  alertId: string
  leagueId: string
  sport: LeagueSport
  alertType: AICommissionerAlertType
  severity: AICommissionerSeverity
  headline: string
  summary: string
  relatedManagerIds: string[]
  relatedTradeId: string | null
  relatedMatchupId: string | null
  status: AICommissionerAlertStatus
  snoozedUntil: string | null
  createdAt: string
  resolvedAt: string | null
}

export interface AICommissionerActionLogView {
  actionId: string
  leagueId: string
  sport: LeagueSport
  actionType: string
  source: string
  summary: string
  relatedAlertId: string | null
  createdAt: string
}

export interface GovernanceSignal {
  alertType: AICommissionerAlertType
  severity: AICommissionerSeverity
  headline: string
  summary: string
  relatedManagerIds?: string[]
  relatedTradeId?: string | null
  relatedMatchupId?: string | null
}

export interface GovernanceAnalysis {
  leagueId: string
  sport: LeagueSport
  season: number
  /**
   * Lineups set themselves (`isBestBallLeagueRow`, lib/core-app/leagueBestBall.ts — the test Chimmy's lineup
   * alerts skip by): a Best Ball league or a best ball Guilly league. No lineup reminder is generated.
   */
  bestBall?: boolean
  pendingWaiverClaims: number
  inactiveManagers: Array<{ managerId: string; daysSinceActivity: number }>
  tradeDisputes: Array<{ tradeId: string; severity: AICommissionerSeverity; summary: string; managerIds: string[] }>
  collusionSignals: Array<{ signalKey: string; severity: AICommissionerSeverity; summary: string; managerIds: string[]; tradeId?: string | null }>
  ruleConflicts: Array<{ key: string; severity: AICommissionerSeverity; summary: string }>
  scheduleContext: {
    currentPeriod: number | null
    playoffStartPeriod: number
    periodsUntilPlayoffs: number | null
    lockReminderHours: number
  }
}

export interface AICommissionerOverview {
  leagueId: string
  sport: LeagueSport
  season: number
  config: AICommissionerConfigView
  alerts: AICommissionerAlertView[]
  actionLogs: AICommissionerActionLogView[]
}

export type TradeControversyLevel = 'low' | 'medium' | 'high'

export interface TradeFairnessInsight {
  tradeId: string
  transactionId: string | null
  createdAt: string
  sport: LeagueSport
  fairnessScore: number
  imbalancePct: number
  controversyLevel: TradeControversyLevel
  summary: string
  relatedManagerIds: string[]
}

export interface WeeklyRecapPost {
  title: string
  body: string
  bullets: string[]
  actionHref: string
  actionLabel: string
}

export interface MatchupInsight {
  matchupId: string
  weekOrPeriod: number
  summary: string
}

export interface WaiverInsight {
  claimId: string | null
  summary: string
  processedAt: string | null
}

export interface DraftInsight {
  pickId: string
  summary: string
  createdAt: string
}

export interface LeagueInsightReport {
  leagueId: string
  sport: LeagueSport
  season: number
  generatedAt: string
  weeklyRecapPost: WeeklyRecapPost
  matchupSummaries: MatchupInsight[]
  waiverHighlights: WaiverInsight[]
  draftCommentary: DraftInsight[]
  controversialTrades: TradeFairnessInsight[]
  suggestedRuleAdjustments: string[]
}
