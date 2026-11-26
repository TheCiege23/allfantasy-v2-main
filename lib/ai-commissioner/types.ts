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

/** `unknown`: the one grade was WITHHELD for this trade, so it is neither fine nor lopsided. */
export type TradeControversyLevel = 'low' | 'medium' | 'high' | 'unknown'

/**
 * A commissioner's fairness read of one completed trade — every value here is THE grade
 * (`lib/decision-os/trade/completedTradeGrade.ts`, through `loadGradedLeagueTradeRows`), never a rule of
 * this module's own. Withheld grades carry `graded: false`, null numbers and the grader's reason.
 */
export interface TradeFairnessInsight {
  /** The platform transaction id — one per trade (mirrored `LeagueTrade` copies are collapsed). */
  tradeId: string
  transactionId: string | null
  createdAt: string | null
  sport: LeagueSport
  graded: boolean
  /** The letter for the row's side (what it received against what it gave), on this league's values. */
  letter: 'A' | 'B' | 'C' | 'D' | 'F' | null
  /** The other side's letter — the exact mirror. */
  partnerLetter: 'A' | 'B' | 'C' | 'D' | 'F' | null
  /** 100 minus the one grade's value gap, for the existing "fairness N/100" readout. Null when withheld. */
  fairnessScore: number | null
  /** The one grade's absolute value gap, in percent. Null when withheld. */
  imbalancePct: number | null
  controversyLevel: TradeControversyLevel
  /** Why the grade was withheld, in the grader's words. Null when graded. */
  withheldReason: string | null
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
