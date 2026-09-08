import { callDecisionOS } from '../../adapter/transport'
import { isLiveReady } from '../../liveReadiness'
import { resolveActiveLeagueId } from '../../resolveActiveLeagueId'
import { readAnalyticsDataWindow } from '../dataWindow'
import { readWarehouseAnalytics } from '../warehouseReads'
import type {
  AnalyticsClient,
  AnalyticsDataWindow,
  AnalyticsKpi,
  AnalyticsTrendSeries,
  LeagueAnalyticsSnapshot,
} from './types'

/**
 * Phase 3.10 — League Analytics is the first module in this program with a
 * genuinely **partial** real outcome: unlike Workspace (3.8) and Automation
 * Center (3.9), which had zero real fields to attempt, `LeagueIntelligenceV1`
 * and `LeagueTrendV1` (both already-ported, already consumed by other
 * modules) map onto real `kpis`/`trends` content here. The other five
 * fields — `competitiveBalance`, `scoringDistribution`, `transactionsByWeek`,
 * `rosterUtilization`, `seasonComparison` — have no Decision OS analog
 * (behavioral intelligence tracks engagement/activity, never fantasy
 * scoring outcomes, standings, or roster-slot fill state), so they're left
 * as honestly-empty arrays rather than a whole-method placeholder error —
 * which is only possible here because every one of those fields is an
 * *array*, and `[]` is a genuine, non-fabricated value ("nothing to show"),
 * unlike a required *scalar* with no analog (e.g. Manager Intelligence's
 * `archetype` in Phase 3.6), which has no honest empty state and forces the
 * whole record to fail.
 *
 * ── SUPERSEDED 2026-09-07: SIX OF THOSE FIELDS NOW CARRY REAL DATA ──────────
 *
 * The paragraph above is kept because its reasoning about DECISION OS is still
 * correct — behavioural intelligence genuinely has no scoring or standings
 * analog. What it got wrong is the conclusion, by treating "Decision OS cannot
 * answer this" as "AllFantasy cannot answer this". The Sleeper importer writes a
 * six-season warehouse per league (`dw_matchup_facts`, `season_results`,
 * `league_teams`, `dw_roster_snapshots`), covering **213 of 287 leagues**, and
 * nothing on this page was reading any of it. `competitiveBalance`,
 * `scoringDistribution`, `transactionsByWeek`, `seasonComparison`,
 * `managerActivity` and `pointsForAgainst` now come from Postgres via
 * `../warehouseReads`.
 *
 * 🛑 AND THE TABLES THIS COMMENT NAMED WERE THE WRONG ONES. It proposed
 * `AfLeagueTrade`/`WaiverClaim` for transactions and `WeeklyScore`/`WeeklyMatchup`
 * for scoring. Measured on a real imported league, **all four hold zero rows** —
 * an imported league never touches AF-native tables. Anyone who had followed this
 * comment would have shipped a page that stays blank and looks correct, which is
 * why the replacement records where the data actually lives.
 *
 * The "new backend capability in spirit" objection does not apply: this is a
 * read-only Postgres query from a DB-first module, which is exactly the
 * architecture the repo's own boundary guard asks for — not a provider call.
 * `healthByWeek`, `healthTarget` and `rosterUtilization` remain empty, each for
 * its own specific reason recorded at the assignment site below.
 */
function notYetIntegrated() {
  return {
    category: 'upstream_unavailable' as const,
    message: 'The live Decision OS backend is not yet integrated in this environment.',
    moduleId: 'analytics' as const,
    retryable: false,
    timestamp: new Date().toISOString(),
  }
}

interface LeagueIntelligenceAnalyticsShape {
  data: {
    leagueEngagementScore: number
    participationDistribution: {
      totalManagers: number
      activeManagers: number
      inactiveManagers: number
      activePercent: number
      inactivePercent: number
    }
    tradeActivity: { tier: 'high' | 'moderate' | 'low' | 'none'; perManagerRate: number }
    waiverActivity: { tier: 'high' | 'moderate' | 'low' | 'none'; perManagerRate: number }
  }
}

type LeagueTrendShape =
  | {
      data: {
        available: true
        direction: 'up' | 'down' | 'flat'
        magnitude: number
        scoreDelta: number
        previousScore: number
        currentScore: number
        capturedAt: string
        comparedToCapturedAt: string
      }
    }
  | { data: { available: false; reason: string; snapshotCount: number } }

function capitalize(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1)
}

/**
 * The window every KPI below is measured over, written the way a commissioner reads it.
 *
 * Taken from `dataWindow` rather than restated, so the label can never drift from the window
 * the numbers were actually computed over.
 */
function windowSuffix(dataWindow: AnalyticsDataWindow | null): string {
  return dataWindow ? ` (last ${dataWindow.lookbackDays}d)` : ''
}

/**
 * Says what a zero actually is.
 *
 * 🛑 "None" WAS READ AS "THIS LEAGUE HAS NEVER TRADED". On the league that prompted this, the
 * tier was `none` because all 7 of its real trades fell outside the 90-day window — so the one
 * word on the card was true about the window and false about the league. Where all-time is
 * greater than the window's zero, the card now carries both numbers; where all-time is also
 * zero, nothing is appended, because "None" is then the whole truth.
 */
function activityValue(tier: string, allTimeCount: number): string {
  const label = capitalize(tier)
  if (tier !== 'none' || allTimeCount <= 0) return label
  return `${label} · ${allTimeCount} all-time`
}

/** Real KPIs only — every value traces directly to a `LeagueIntelligenceV1` field, no derived scoring. */
function buildKpis(
  intel: LeagueIntelligenceAnalyticsShape['data'],
  trend: LeagueTrendShape['data'],
  dataWindow: AnalyticsDataWindow | null,
): AnalyticsKpi[] {
  const win = windowSuffix(dataWindow)
  const kpis: AnalyticsKpi[] = [
    {
      id: 'kpi-engagement',
      label: 'League Engagement Score',
      value: String(intel.leagueEngagementScore),
      ...(trend.available
        ? { trend: { direction: trend.direction, label: `${trend.scoreDelta >= 0 ? '+' : ''}${trend.scoreDelta} vs previous capture` } }
        : {}),
    },
    {
      /*
       * 🛑 "of N" IS NOT THE LEAGUE'S TEAM COUNT, AND THE OLD LABEL IMPLIED IT WAS.
       *
       * `totalManagers` is `managerIntelligences.length`, which the behavioural
       * pipeline derives from managers holding at least one EVENT inside
       * `INTELLIGENCE_LOOKBACK_DAYS` (90 by default) — see real-data-provider.ts's
       * own "events-derived managerIds: silent managers are not surfaced" note.
       * A manager who did nothing in the window is not counted at all, so the
       * denominator is smaller than the roster count and moves on its own as the
       * window slides.
       *
       * Measured on a real 12-team league: 12 rosters, 12 managers with activity
       * ever, but only 7 inside 90 days — rendered as "0 of 7" under a label that
       * reads as "0 of your 12 teams". Every number was right and the sentence
       * was wrong, which is the worst combination to leave on a dashboard.
       *
       * Naming the denominator is the honest fix and costs nothing. Changing what
       * `totalManagers` MEANS is a different, much larger decision — it is shared
       * with Manager Intelligence, Recommendations, League Health and Mission
       * Control, and it is the denominator of every per-manager rate in
       * league-intelligence.ts — so it is deliberately NOT done here.
       */
      id: 'kpi-active-managers',
      /*
       * The window is no longer hard-coded here. It read `(last 90d)` while the window itself
       * comes from `INTELLIGENCE_LOOKBACK_DAYS` — true today, and silently a lie the first time
       * anyone tunes that env var. `windowSuffix` takes it from the same place the numbers do.
       */
      label: `Active Managers${win}`,
      value: `${intel.participationDistribution.activeManagers} of ${intel.participationDistribution.totalManagers}`,
    },
    {
      id: 'kpi-trade-activity',
      label: `Trade Activity${win}`,
      value: activityValue(intel.tradeActivity.tier, dataWindow?.allTime.tradeCount ?? 0),
    },
    {
      id: 'kpi-waiver-activity',
      label: `Waiver Activity${win}`,
      value: activityValue(intel.waiverActivity.tier, dataWindow?.allTime.waiverCount ?? 0),
    },
  ]
  return kpis
}

/** Exactly the real, stored comparison points — never interpolated to fill a weekly chart. */
function buildTrends(trend: LeagueTrendShape['data']): AnalyticsTrendSeries[] {
  if (!trend.available) return []
  return [
    {
      id: 'trend-engagement',
      name: 'League Engagement',
      points: [
        { label: trend.comparedToCapturedAt, value: trend.previousScore },
        { label: trend.capturedAt, value: trend.currentScore },
      ],
    },
  ]
}

export const liveAnalyticsClient: AnalyticsClient = {
  async getSnapshot() {
    if (!(await isLiveReady('analytics'))) {
      return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
    }
    const timestamp = new Date().toISOString()
    const leagueId = await resolveActiveLeagueId()
    if (!leagueId) {
      return { data: null, error: notYetIntegrated(), source: 'live', timestamp }
    }

    const [leagueResult, trendResult, dataWindow, warehouse] = await Promise.all([
      callDecisionOS<LeagueIntelligenceAnalyticsShape>('analytics', `/api/v1/intelligence/league?leagueId=${encodeURIComponent(leagueId)}`),
      callDecisionOS<LeagueTrendShape>('analytics', `/api/v1/intelligence/league/trend?leagueId=${encodeURIComponent(leagueId)}`),
      // Runs alongside the two intelligence calls rather than after them: it is provenance for
      // their output, not a dependency of it, and it must not add latency to the page.
      readAnalyticsDataWindow(leagueId),
      // The season-history half, straight from Postgres. Independent of Decision OS entirely — a
      // league whose intelligence call fails still has six seasons of scoring, and vice versa.
      readWarehouseAnalytics(leagueId),
    ])

    if (leagueResult.error || !leagueResult.data) {
      return { data: null, error: leagueResult.error ?? notYetIntegrated(), source: 'live', timestamp }
    }

    const intel = leagueResult.data.data
    const trend: LeagueTrendShape['data'] = trendResult.data?.data ?? { available: false, reason: 'insufficient_historical_data', snapshotCount: 0 }

    const snapshot: LeagueAnalyticsSnapshot = {
      kpis: buildKpis(intel, trend, dataWindow),
      trends: buildTrends(trend),
      /*
       * These six were hard-coded `[]` with a comment explaining that Decision OS's behavioural
       * pipeline has no analog for scoring or standings. That was true of Decision OS and beside
       * the point: the Sleeper importer writes a six-season warehouse per league, covering 213 of
       * 287 leagues, and nothing was reading it. They now come from Postgres directly — see
       * `warehouseReads.ts`, which also records why the tables the old comment NAMED are the
       * wrong ones (they hold zero rows for an imported league).
       */
      competitiveBalance: warehouse.competitiveBalance,
      scoringDistribution: warehouse.scoringDistribution,
      transactionsByWeek: warehouse.transactionsByWeek,
      seasonComparison: warehouse.seasonComparison,
      managerActivity: warehouse.managerActivity,
      pointsForAgainst: warehouse.pointsForAgainst,
      activityMix: warehouse.activityMix,
      managerFingerprints: warehouse.managerFingerprints,
      allTimeRecords: warehouse.allTimeRecords,
      /*
       * These three stay empty, and the reasons are specific rather than "no analog":
       *
       * - `healthByWeek` — a weekly engagement series IS computable from the activity table, and
       *   it would be actively misleading. A dynasty league's imported activity is mostly
       *   offseason (this one runs January to August, 137 events over 17 weeks with a draft spike
       *   in May), so the series would show a near-zero line for most of the year and read as a
       *   collapsing league rather than a normal offseason. That is the same "measuring our data,
       *   not your league" failure the freshness banner exists to stop; wiring it here would
       *   reintroduce it in chart form.
       * - `healthTarget` — no league sets one anywhere in the schema. A default would be invented.
       * - `rosterUtilization` — `dw_roster_snapshots` carries starters and bench, but starters is
       *   a fixed lineup size, so "utilisation" would be the same ratio for all twelve teams every
       *   week. A chart of twelve identical bars is not a measurement.
       */
      healthByWeek: [],
      healthTarget: null,
      rosterUtilization: [],
      dataWindow,
      seasonLabel: warehouse.seasonLabel,
      generatedAt: timestamp,
    }

    return { data: snapshot, error: null, source: 'live', timestamp }
  },

  async getSummary() {
    if (!(await isLiveReady('analytics'))) {
      return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
    }
    const timestamp = new Date().toISOString()
    const leagueId = await resolveActiveLeagueId()
    if (!leagueId) {
      return { data: null, error: notYetIntegrated(), source: 'live', timestamp }
    }

    const { data, error } = await callDecisionOS<LeagueIntelligenceAnalyticsShape>(
      'analytics',
      `/api/v1/intelligence/league?leagueId=${encodeURIComponent(leagueId)}`,
    )
    if (error || !data) {
      return { data: null, error: error ?? notYetIntegrated(), source: 'live', timestamp }
    }

    const intel = data.data
    const kpiCount = 4

    /*
     * Mission Control renders this sentence with no room for a banner, so the caveat has to be
     * inside the sentence or it does not exist. "0 of 7 managers active" on 18-day-old data is
     * the exact claim this whole change exists to stop making unqualified.
     */
    const dataWindow = await readAnalyticsDataWindow(leagueId)
    const stale =
      dataWindow?.daysSinceLastActivity != null &&
      dataWindow.daysSinceLastActivity > dataWindow.inactiveAfterDays
    const caveat = stale ? ` (no league activity recorded in ${dataWindow.daysSinceLastActivity} days)` : ''
    const headline = `League engagement score ${intel.leagueEngagementScore} — ${intel.participationDistribution.activeManagers} of ${intel.participationDistribution.totalManagers} managers active${caveat}`

    return { data: { headline, kpiCount }, error: null, source: 'live', timestamp }
  },
}
