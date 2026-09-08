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

/** All-time share of each kind of league action — the part-to-whole the donut draws. */
export interface ActivityMixEntry {
  /** Already humanised ("Draft pick", not "draft_pick") — the view formats nothing. */
  label: string
  count: number
}

/**
 * A manager's behavioural fingerprint: four 0–100 axes from `manager_psych_profiles`.
 *
 * ⚠ FOUR, NOT FIVE. The source table also carries `waiverFocusScore`, which is constant zero
 * across all 2,611 rows platform-wide. It is dropped in the read layer so no chart can plot a
 * permanently-collapsed spoke that reads as "nobody here uses the waiver wire".
 */
export interface ManagerFingerprintEntry {
  managerName: string
  aggression: number
  activity: number
  tradeFrequency: number
  riskTolerance: number
  labels: string[]
}

/**
 * The highest each fingerprint measure reaches platform-wide — the radar's ring, per axis.
 *
 * Needed because the four measures are NOT commensurate (they top out at 45 / 38 / 100 / 63), so a
 * shared 0–100 ring squeezed three of them into the inner fifth and every manager drew the same
 * sliver. Platform-wide, never this league's: a fixed denominator means a full spoke reads as "as
 * high as this has ever been recorded", and two leagues stay comparable.
 */
export interface FingerprintAxisMaxEntry {
  aggression: number
  activity: number
  tradeFrequency: number
  riskTolerance: number
}

/** All-time record per franchise across every season the import captured. */
export interface AllTimeRecordEntry {
  teamName: string
  wins: number
  losses: number
  seasons: number
  titles: number
}

/**
 * How old the data behind the window-derived KPIs actually is.
 *
 * 🛑 EVERY KPI ON THIS PAGE IS A ROLLING-WINDOW MEASUREMENT, AND WITHOUT THIS THE PAGE READS AS
 * A STATEMENT ABOUT THE LEAGUE. Measured on a real 12-team Sleeper league on 2026-09-07: the
 * page said "Active Managers 0 of 7" and "Trade Activity: None". Both were arithmetically
 * correct and both were understood as facts about the league. What they actually meant was
 * that the league's newest imported event was 18 days old — past the 14-day inactivity
 * threshold, so every manager flipped inactive — and that its 7 real trades all landed outside
 * the 90-day window. The league had 12 rostered teams and a six-season history.
 *
 * A commissioner cannot tell those two situations apart from the numbers, and the difference
 * between "your league is dead" and "we stopped receiving your data" is the whole product.
 *
 * `null` when the client genuinely cannot establish the window (stub/demo, or an unresolvable
 * league) — the view then renders exactly as it did before, with no invented reassurance.
 */
export interface AnalyticsDataWindow {
  /** Rolling window every KPI on this page is computed over. */
  lookbackDays: number
  /** Days without an event after which a manager counts as inactive. */
  inactiveAfterDays: number
  /** Newest event of any kind for this league, all-time. Null = nothing has ever been recorded. */
  lastActivityAt: string | null
  /** Whole days between `lastActivityAt` and now. Null when `lastActivityAt` is null. */
  daysSinceLastActivity: number | null
  /**
   * All-time counts, so a zero inside the window can say what it is instead of reading as
   * "this has never happened". Deliberately all-time rather than a second window: the whole
   * point is to contrast the window against everything we hold.
   */
  allTime: { tradeCount: number; waiverCount: number; eventCount: number }
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
  /**
   * Three history views the KPI row cannot express. All-time on purpose: they answer "what kind of
   * league is this" and "who has been good", which are standing characteristics, not 90-day
   * readings that collapse every offseason.
   */
  activityMix: ActivityMixEntry[]
  managerFingerprints: ManagerFingerprintEntry[]
  /** Null when no fingerprints are shown; the radar needs it to scale each axis. */
  fingerprintAxisMax: FingerprintAxisMaxEntry | null
  allTimeRecords: AllTimeRecordEntry[]
  /** Provenance for every window-derived KPI above. Null when the window cannot be established. */
  dataWindow: AnalyticsDataWindow | null
  /**
   * The season the season-scoped panels (points, scoring distribution, competitive balance)
   * describe — which is the newest season with SCORES, not necessarily the current one.
   *
   * A preseason league has a full fixture list and no points; showing that as twelve bars at zero
   * would read as "your league scored nothing". Naming the season lets the panels show the last
   * real one instead of an empty current one. Null when no season has been scored yet.
   */
  seasonLabel: string | null
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
