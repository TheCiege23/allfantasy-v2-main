import { callDecisionOS } from '../../adapter/transport'
import { isLiveReady } from '../../liveReadiness'
import { canAccessLiveDecisionOSData } from '../../liveModeAccess'
import { resolveActiveLeagueId } from '../../resolveActiveLeagueId'
import type { AnalyticsClient, AnalyticsKpi, AnalyticsTrendSeries, LeagueAnalyticsSnapshot } from './types'

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

/** Real KPIs only — every value traces directly to a `LeagueIntelligenceV1` field, no derived scoring. */
function buildKpis(intel: LeagueIntelligenceAnalyticsShape['data'], trend: LeagueTrendShape['data']): AnalyticsKpi[] {
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
      id: 'kpi-active-managers',
      label: 'Active Managers',
      value: `${intel.participationDistribution.activeManagers} of ${intel.participationDistribution.totalManagers}`,
    },
    { id: 'kpi-trade-activity', label: 'Trade Activity', value: capitalize(intel.tradeActivity.tier) },
    { id: 'kpi-waiver-activity', label: 'Waiver Activity', value: capitalize(intel.waiverActivity.tier) },
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
    if (!(await canAccessLiveDecisionOSData())) {
      return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
    }
    const timestamp = new Date().toISOString()
    const leagueId = await resolveActiveLeagueId()
    if (!leagueId) {
      return { data: null, error: notYetIntegrated(), source: 'live', timestamp }
    }

    const [leagueResult, trendResult] = await Promise.all([
      callDecisionOS<LeagueIntelligenceAnalyticsShape>('analytics', `/api/v1/intelligence/league?leagueId=${encodeURIComponent(leagueId)}`),
      callDecisionOS<LeagueTrendShape>('analytics', `/api/v1/intelligence/league/trend?leagueId=${encodeURIComponent(leagueId)}`),
    ])

    if (leagueResult.error || !leagueResult.data) {
      return { data: null, error: leagueResult.error ?? notYetIntegrated(), source: 'live', timestamp }
    }

    const intel = leagueResult.data.data
    const trend: LeagueTrendShape['data'] = trendResult.data?.data ?? { available: false, reason: 'insufficient_historical_data', snapshotCount: 0 }

    const snapshot: LeagueAnalyticsSnapshot = {
      kpis: buildKpis(intel, trend),
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
      generatedAt: timestamp,
    }

    return { data: snapshot, error: null, source: 'live', timestamp }
  },

  async getSummary() {
    if (!(await isLiveReady('analytics'))) {
      return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
    }
    if (!(await canAccessLiveDecisionOSData())) {
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
    const headline = `League engagement score ${intel.leagueEngagementScore} — ${intel.participationDistribution.activeManagers} of ${intel.participationDistribution.totalManagers} managers active`

    return { data: { headline, kpiCount }, error: null, source: 'live', timestamp }
  },
}
