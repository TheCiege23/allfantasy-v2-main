import type { CommissionerPlatformResponse } from '../../contracts'

/**
 * League Analytics owns executive KPI dashboards, trends, participation,
 * competitive balance, scoring distributions, transaction analytics,
 * roster utilization, and season-over-season comparisons. It is
 * distinct from League Health: League Health explains the league's
 * *current* condition (score, active risks); League Analytics is the
 * open-ended workbench for how the league has *evolved* — history,
 * benchmarking, trend lines — per the module's own placeholder
 * description carried into this implementation.
 */
export interface AnalyticsKpi {
  id: string
  label: string
  value: string
  trend?: { direction: 'up' | 'down' | 'flat'; label: string }
}

export interface AnalyticsTrendPoint {
  label: string
  value: number
}

export interface AnalyticsTrendSeries {
  id: string
  name: string
  points: AnalyticsTrendPoint[]
}

export interface CompetitiveBalanceMetric {
  label: string
  value: string
  interpretation: string
}

export interface ScoringDistributionBucket {
  rangeLabel: string
  teamCount: number
}

export interface TransactionWeek {
  weekLabel: string
  tradeCount: number
  waiverClaimCount: number
}

export interface RosterUtilizationEntry {
  teamName: string
  utilizationPercent: number
}

export interface SeasonComparisonPoint {
  seasonLabel: string
  value: number
}

/**
 * 30a — league health by week, this season against last, for the line chart
 * that carries a labelled target overlay.
 *
 * `lastSeason` is nullable per point on purpose: a league in its first season
 * has no comparison, and a zero would draw a line along the floor that reads as
 * "last season was catastrophic" rather than "there was no last season".
 */
export interface LeagueHealthWeek {
  weekLabel: string
  thisSeason: number
  lastSeason: number | null
}

/**
 * 30a — the manager-activity leaderboard. `priorActionsPerWeek` is what makes
 * the call-out comparative ("both were above 12 in September") rather than a
 * bare ranking, so it is required, not optional.
 */
export interface ManagerActivityEntry {
  managerName: string
  actionsPerWeek: number
  priorActionsPerWeek: number
}

/** 30a — points for and against per team, drawn as grouped columns. */
export interface TeamPointsEntry {
  teamName: string
  pointsFor: number
  pointsAgainst: number
}

/**
 * One cohesive snapshot rather than eight separate fetches — this is one
 * executive dashboard page conceptually, the same reasoning Mission
 * Control's own `MissionControlKpis` already applies to bundle several
 * numbers into a single call.
 */
export interface LeagueAnalyticsSnapshot {
  kpis: AnalyticsKpi[]
  /** Multiple named series (engagement, participation) rendered together as "league trends," plural. */
  trends: AnalyticsTrendSeries[]
  competitiveBalance: CompetitiveBalanceMetric[]
  scoringDistribution: ScoringDistributionBucket[]
  transactionsByWeek: TransactionWeek[]
  rosterUtilization: RosterUtilizationEntry[]
  seasonComparison: SeasonComparisonPoint[]
  /**
   * 30a additions. Arrays and a nullable scalar, so a client with no analog can
   * return `[]` / `null` honestly rather than fabricating — the same rule the
   * five fields above already follow (see live.ts's top comment).
   */
  healthByWeek: LeagueHealthWeek[]
  /** The league-health target drawn as a labelled overlay. Null = no target set. */
  healthTarget: number | null
  managerActivity: ManagerActivityEntry[]
  pointsForAgainst: TeamPointsEntry[]
  generatedAt: string
}

/** The only shape Mission Control ever sees — computed by League Analytics over its own snapshot, never by Mission Control. */
export interface AnalyticsSummary {
  headline: string
  kpiCount: number
}

export interface AnalyticsClient {
  getSnapshot(): Promise<CommissionerPlatformResponse<LeagueAnalyticsSnapshot>>
  getSummary(): Promise<CommissionerPlatformResponse<AnalyticsSummary>>
}
