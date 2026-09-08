import { lookbackDays } from '@/lib/decision-os/behavioral/api/real-data-provider'
import {
  latestScoredSeason,
  readActivityMix,
  readAllTimeRecords,
  readManagerActivity,
  readManagerFingerprints,
  readMargins,
  readSeasonPoints,
  readSeasonPointTotals,
  readSeasonPointsForDistribution,
  readSeasonSpread,
  readTitles,
  readTransactionsByWeek,
} from '@/lib/league-history/leagueWarehouseReads'
import type {
  ActivityMixEntry,
  AllTimeRecordEntry,
  CompetitiveBalanceMetric,
  ManagerActivityEntry,
  ManagerFingerprintEntry,
  ScoringDistributionBucket,
  SeasonComparisonPoint,
  TeamPointsEntry,
  TransactionWeek,
} from './decision-os-client/types'

/**
 * The season-history half of League Analytics: shapes what `lib/league-history/` reads into what
 * the Analytics view renders.
 *
 * 🛑 THE PANELS THIS FILLS WERE BLANK WHILE THE DATA SAT IN THE SAME DATABASE. Decision OS's
 * behavioural pipeline tracks engagement and never scoring, so `analytics/live.ts` returned a
 * literal `[]` for every scoring, standings and history field. That was honest about Decision OS
 * and wrong about AllFantasy: the importer populates a six-season warehouse per league —
 * `dw_matchup_facts` covers 213 of 287 leagues, `season_results` 241.
 *
 * ⚠ THE COMMENT IN `analytics/live.ts` NAMED THE WRONG TABLES. It proposed `AfLeagueTrade`/
 * `WaiverClaim` for transactions and `WeeklyScore`/`WeeklyMatchup` for scoring. All four hold zero
 * rows for an imported league — imported leagues never touch AF-native tables.
 *
 * ⚠ NO PRISMA, NO RAW SQL, NO `findUnique` IN THIS FILE. All three are restricted across
 * `lib/commissioner-ui/**` by Commissioner OS invariants 1 and 2, and the first version of this
 * file broke all three — including `findUnique`, which cannot be soft-delete filtered and would
 * have read a deleted league's provider identity. The queries moved to `lib/league-history/`,
 * which is where the other readers of this warehouse already live.
 */

/** Every field is independently degradable: one empty array never blanks the others. */
export interface WarehouseAnalytics {
  /**
   * The season the season-scoped panels describe.
   *
   * 🛑 NOT ALWAYS THE CURRENT SEASON, AND SAYING SO IS THE POINT. A league in preseason has a full
   * fixture list with no scores — the test league carries 108 scheduled 2026 matchups and zero
   * points. Rendering that would draw twelve bars at zero under "Season totals per team", which
   * reads as "your league scored nothing". The panels show the newest season that actually has
   * scores and NAME it.
   */
  seasonLabel: string | null
  pointsForAgainst: TeamPointsEntry[]
  scoringDistribution: ScoringDistributionBucket[]
  competitiveBalance: CompetitiveBalanceMetric[]
  seasonComparison: SeasonComparisonPoint[]
  transactionsByWeek: TransactionWeek[]
  managerActivity: ManagerActivityEntry[]
  activityMix: ActivityMixEntry[]
  managerFingerprints: ManagerFingerprintEntry[]
  allTimeRecords: AllTimeRecordEntry[]
}

const EMPTY: WarehouseAnalytics = {
  seasonLabel: null,
  pointsForAgainst: [],
  scoringDistribution: [],
  competitiveBalance: [],
  seasonComparison: [],
  transactionsByWeek: [],
  managerActivity: [],
  activityMix: [],
  managerFingerprints: [],
  allTimeRecords: [],
}

/**
 * `draft_pick` → "Draft pick". Humanised here rather than in the view so the chart component takes
 * a label it can render verbatim and never has to know the provider's vocabulary.
 */
function humaniseActivityType(activityType: string): string {
  const words = activityType.replace(/_/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : activityType
}

/**
 * Runs one panel's read, containing its failure to that panel.
 *
 * 🛑 THIS EXISTS BECAUSE THE FIRST VERSION DID NOT HAVE IT AND ITS DOC COMMENT SAID IT DID. A
 * single outer try/catch around `Promise.all` meant one bad query blanked all six panels — and the
 * failure that proved it was real, so the page went from six populated panels to six "not wired"
 * notes with nothing in the UI to say why. A containment claim that exists only in a comment is
 * worse than no claim: it stops the next person looking.
 */
async function panel<T>(label: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run()
  } catch (error) {
    console.error(`[warehouseAnalytics] ${label} failed; other panels unaffected`, error)
    return fallback
  }
}

function round(value: number, dp = 1): number {
  const f = 10 ** dp
  return Math.round(value * f) / f
}

/**
 * Teams grouped into bands of season points, derived from this league's own range.
 *
 * Fixed bands cannot work: scoring settings differ so wildly between formats (the test league is
 * superflex TE-premium and averages ~2,050 a season; a standard league is far lower) that any
 * hard-coded set puts every team in one bucket for most leagues.
 */
function bucketPoints(points: number[]): ScoringDistributionBucket[] {
  if (points.length === 0) return []
  const lo = Math.min(...points)
  const hi = Math.max(...points)
  // One band when every team landed inside 100 points — a five-band axis over a 40-point spread
  // would invent precision the data does not have.
  const width = Math.max(100, Math.ceil((hi - lo) / 5 / 100) * 100)
  const base = Math.floor(lo / width) * width

  const buckets = new Map<number, number>()
  for (const p of points) {
    const start = base + Math.floor((p - base) / width) * width
    buckets.set(start, (buckets.get(start) ?? 0) + 1)
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, teamCount]) => ({
      rangeLabel: `${start.toLocaleString()}–${(start + width - 1).toLocaleString()}`,
      teamCount,
    }))
}

/**
 * Balance metrics, each a count of real games rather than an index.
 *
 * Deliberately no parity score: a single synthesised number is unarguable on a dashboard and
 * unexplainable in a league chat. "56 of 98 games were decided by 30+" is a fact a commissioner can
 * check against their own memory of the season, which is the standard the rest of this page is held
 * to.
 */
async function buildCompetitiveBalance(leagueId: string, season: number): Promise<CompetitiveBalanceMetric[]> {
  const [margins, spread, titles] = await Promise.all([
    readMargins(leagueId, season),
    readSeasonSpread(leagueId, season),
    readTitles(leagueId),
  ])

  const metrics: CompetitiveBalanceMetric[] = []
  if (margins.games > 0) {
    metrics.push({
      label: 'Blowouts',
      value: `${margins.blowouts} of ${margins.games}`,
      interpretation: `${Math.round((margins.blowouts / margins.games) * 100)}% of games were decided by 30 points or more.`,
    })
    metrics.push({
      label: 'One-score games',
      value: `${margins.oneScore} of ${margins.games}`,
      interpretation: `${Math.round((margins.oneScore / margins.games) * 100)}% were decided by under 10 points.`,
    })
    metrics.push({
      label: 'Average margin',
      value: `${margins.averageMargin} pts`,
      interpretation: 'Mean winning margin across every completed matchup this season.',
    })
  }
  if (spread) {
    metrics.push({
      label: 'Scoring spread',
      value: `${round(spread.high - spread.low).toLocaleString()} pts`,
      interpretation: `Between the highest-scoring team (${spread.high.toLocaleString()}) and the lowest (${spread.low.toLocaleString()}).`,
    })
  }
  if (titles.titleSeasons > 0) {
    metrics.push({
      label: 'Title spread',
      value: `${titles.distinctChampions} of ${titles.titleSeasons}`,
      interpretation:
        titles.distinctChampions === titles.titleSeasons
          ? `A different team has won each of the last ${titles.titleSeasons} seasons.`
          : `${titles.distinctChampions} different ${titles.distinctChampions === 1 ? 'team has' : 'teams have'} won the last ${titles.titleSeasons} seasons.`,
    })
  }
  return metrics
}

/**
 * Transactions bucketed by CALENDAR week, not NFL week.
 *
 * A dynasty league's imported activity is mostly offseason — the test league's runs January to
 * August — and there is no NFL week 34. Labelling these "Wk 1…" would file draft-season trades
 * under regular-season week numbers, a worse lie than a plain date.
 */
function labelWeeks(weeks: Awaited<ReturnType<typeof readTransactionsByWeek>>): TransactionWeek[] {
  return weeks.map((w) => ({
    // UTC on purpose: the bucket boundary was computed in UTC, so formatting in the server's local
    // zone would label a Monday-anchored week with the previous Sunday's date.
    weekLabel: w.weekStart.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' }),
    tradeCount: w.tradeCount,
    waiverClaimCount: w.waiverCount,
  }))
}

export async function readWarehouseAnalytics(leagueId: string): Promise<WarehouseAnalytics> {
  try {
    const days = lookbackDays()
    const weeks = days / 7
    const season = await panel('latestScoredSeason', () => latestScoredSeason(leagueId), null)

    const [
      pointsForAgainst,
      distributionPoints,
      competitiveBalance,
      seasonTotals,
      transactionWeeks,
      managerCounts,
      activityMix,
      fingerprints,
      allTimeRecords,
    ] = await Promise.all([
      season == null ? [] : panel('pointsForAgainst', () => readSeasonPoints(leagueId, season), []),
      season == null ? [] : panel('scoringDistribution', () => readSeasonPointsForDistribution(leagueId, season), []),
      season == null ? [] : panel('competitiveBalance', () => buildCompetitiveBalance(leagueId, season), []),
      panel('seasonComparison', () => readSeasonPointTotals(leagueId), []),
      panel('transactionsByWeek', () => readTransactionsByWeek(leagueId), []),
      panel('managerActivity', () => readManagerActivity(leagueId, days), []),
      panel('activityMix', () => readActivityMix(leagueId), []),
      panel('managerFingerprints', () => readManagerFingerprints(leagueId), []),
      panel('allTimeRecords', () => readAllTimeRecords(leagueId), []),
    ])

    return {
      seasonLabel: season == null ? null : String(season),
      pointsForAgainst,
      scoringDistribution: bucketPoints(distributionPoints),
      competitiveBalance,
      seasonComparison: seasonTotals.map((s) => ({ seasonLabel: s.season, value: s.averagePointsFor })),
      transactionsByWeek: labelWeeks(transactionWeeks),
      managerActivity: managerCounts.map((m) => ({
        managerName: m.managerName,
        actionsPerWeek: round(m.currentCount / weeks, 2),
        priorActionsPerWeek: round(m.priorCount / weeks, 2),
      })),
      activityMix: activityMix.map((a) => ({ label: humaniseActivityType(a.activityType), count: a.count })),
      managerFingerprints: fingerprints,
      allTimeRecords,
    }
  } catch {
    // Never let the history half break the KPI half — the page degrades to what it showed before.
    return EMPTY
  }
}
