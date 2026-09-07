import { callDecisionOS } from '../../adapter/transport'
import { isLiveReady } from '../../liveReadiness'
import { resolveActiveLeagueId } from '../../resolveActiveLeagueId'
import { readAnalyticsDataWindow } from '../dataWindow'
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
 * Two of the five array fields are backed by real Commissioner-OS/
 * application-layer data that simply isn't Decision OS's concern:
 * `transactionsByWeek` could be computed from `AfLeagueTrade`/`WaiverClaim`,
 * `scoringDistribution` from `WeeklyScore`/`WeeklyMatchup`. Wiring either
 * would mean building new aggregation logic directly in `live.ts` against
 * raw application tables — a materially different pattern from every prior
 * `live.ts` in this program (which only ever touch Prisma for league/user
 * resolution, never for the substantive intelligence payload itself) and a
 * new backend capability in spirit even if not in name. Left as placeholder
 * data, documented precisely in
 * LEAGUE_ANALYTICS_LIVE_INTEGRATION_REPORT.md — not wired this phase.
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

    const [leagueResult, trendResult, dataWindow] = await Promise.all([
      callDecisionOS<LeagueIntelligenceAnalyticsShape>('analytics', `/api/v1/intelligence/league?leagueId=${encodeURIComponent(leagueId)}`),
      callDecisionOS<LeagueTrendShape>('analytics', `/api/v1/intelligence/league/trend?leagueId=${encodeURIComponent(leagueId)}`),
      // Runs alongside the two intelligence calls rather than after them: it is provenance for
      // their output, not a dependency of it, and it must not add latency to the page.
      readAnalyticsDataWindow(leagueId),
    ])

    if (leagueResult.error || !leagueResult.data) {
      return { data: null, error: leagueResult.error ?? notYetIntegrated(), source: 'live', timestamp }
    }

    const intel = leagueResult.data.data
    const trend: LeagueTrendShape['data'] = trendResult.data?.data ?? { available: false, reason: 'insufficient_historical_data', snapshotCount: 0 }

    const snapshot: LeagueAnalyticsSnapshot = {
      kpis: buildKpis(intel, trend, dataWindow),
      trends: buildTrends(trend),
      // No Decision OS (or honestly-wireable application-layer) analog exists for these — see this
      // file's top comment and LEAGUE_ANALYTICS_LIVE_INTEGRATION_REPORT.md. Left honestly empty
      // rather than fabricated, since every one of these fields is an array (a legitimate "nothing
      // to show" value), not a required scalar that would force the whole snapshot to fail.
      competitiveBalance: [],
      scoringDistribution: [],
      transactionsByWeek: [],
      rosterUtilization: [],
      seasonComparison: [],
      /*
       * 30a's four fields, on the same rule as the five above: Decision OS
       * tracks behavioural engagement, never fantasy scoring outcomes or
       * standings, so there is no analog for points-for/against or a
       * per-week health series here. Empty arrays and a null target are
       * genuine "nothing to show" values; the view renders an explicit
       * not-wired panel for each rather than an empty chart frame.
       */
      healthByWeek: [],
      healthTarget: null,
      managerActivity: [],
      pointsForAgainst: [],
      dataWindow,
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
