import { callDecisionOS } from '../adapter/transport'
import { isLiveReady } from '../liveReadiness'
import { resolveActiveLeagueId } from '../resolveActiveLeagueId'
import { resolveManagerDisplayNames, UNKNOWN_MANAGER_NAME } from '../managers/managerNames'
import { readAnalyticsDataWindow } from '../analytics/dataWindow'
import { readLeagueActivityTrend } from '../missionControl/activityTrendReads'
import type { CommissionerErrorContract, CommissionerModuleId } from '../contracts'
import type { SeverityTier } from '../tokens/colors'
import type { DecisionOSClient, LeagueHealthSummary, ManagerHighlight, MissionControlKpis } from './types'

/**
 * Phase 3.2 built the gated wiring; Phase 3.3 added the backend capabilities
 * (trend, deadlines, public manager listing, narrative signals) this file
 * needed to go beyond the honest placeholder. Every method still checks
 * `isLiveReady('mission-control')` first and returns the same placeholder
 * when it's off — which is every environment today, since nothing has ever
 * called `setLiveReady('mission-control', true)`. Even once that flag is on,
 * each method still degrades honestly (never fabricates) when a specific
 * real signal isn't available for a given league — e.g. trend genuinely
 * needs 2 captured snapshots, which no environment has produced yet (see
 * lib/commissioner-ui/BACKEND_CAPABILITY_EXPANSION_REPORT.md's Historical
 * Model section: capture is a real function, deliberately not wired to any
 * automatic cadence).
 */
function notYetIntegrated(moduleId: CommissionerModuleId): CommissionerErrorContract {
  return {
    category: 'upstream_unavailable',
    message: 'The live Decision OS backend is not yet integrated in this environment.',
    moduleId,
    retryable: false,
    timestamp: new Date().toISOString(),
  }
}


// ── Local wire-shape types ──────────────────────────────────────────────────
// Minimal projections of the real Phase 3.3 API response shapes
// (`lib/decision-os/behavioral/api/contracts.ts` on `port/decision-os-backend`
// — not importable from this branch; see DECISION_OS_PORT_EXECUTION_REPORT.md
// §5). Declaring the expected response shape locally is the correct approach
// for an HTTP boundary regardless — this is what `callDecisionOS`'s generic
// type parameter is for.

interface LeagueIntelligenceShape {
  data: {
    leagueEngagementScore: number
    recommendations: Array<{ priority: 'critical' | 'high' | 'medium' | 'low' }>
    healthNarrative: { engagementSummary: string; topConcern: string | null; standoutSignal: string | null }
  }
}

type LeagueTrendShape =
  | { data: { available: true; direction: 'up' | 'down' | 'flat'; scoreDelta: number } }
  | { data: { available: false } }

type WeekMilestoneShape = { label: 'trade_deadline' | 'playoffs_start'; week: number; weeksAway: number }
type TimeMilestoneShape = { label: 'draft' | 'next_waiver_processing'; at: string }
interface LeagueDeadlineShape {
  data: { nextActionableEvent: (WeekMilestoneShape | TimeMilestoneShape) | null }
}

interface ManagerSummaryShape {
  managerId: string
  retentionRisk: 'low' | 'medium' | 'high' | 'critical'
  retentionRiskReasons: string[]
  isInactive: boolean
  inactivityWarning: string | null
}
interface LeagueManagersShape {
  data: ManagerSummaryShape[]
}

// ── Presentation formatting of real data (not fabrication — every input is a
// real, already-computed value; this only phrases it, matching exactly what
// Mission Control's own demo.ts already hand-writes for its fixtures) ───────

function scoreToSeverityTier(score: number): SeverityTier {
  if (score >= 90) return 'positive'
  if (score >= 75) return 'advisory'
  if (score >= 50) return 'standard'
  if (score >= 25) return 'elevated'
  return 'critical'
}

function formatTrendLabel(direction: 'up' | 'down' | 'flat', scoreDelta: number): string {
  if (direction === 'flat') return 'No significant change since the last check'
  const sign = scoreDelta > 0 ? '+' : ''
  return `${sign}${scoreDelta} since the last check`
}

function formatDeadlineLabel(event: WeekMilestoneShape | TimeMilestoneShape | null): string {
  if (!event) return 'No upcoming deadlines configured'
  if ('week' in event) {
    const what = event.label === 'trade_deadline' ? 'Trade deadline' : 'Playoffs start'
    if (event.weeksAway <= 0) return `${what} is this week`
    return `${what} in ${event.weeksAway} week${event.weeksAway === 1 ? '' : 's'}`
  }
  const what = event.label === 'draft' ? 'Draft' : 'Next waiver processing'
  const hoursAway = Math.max(0, Math.round((new Date(event.at).getTime() - Date.now()) / (60 * 60 * 1000)))
  if (event.label === 'next_waiver_processing') {
    return hoursAway <= 1 ? `${what} within the hour` : `${what} in ${hoursAway} hours`
  }
  return `${what} on ${event.at.slice(0, 10)}`
}

function toneFromRisk(retentionRisk: string, isInactive: boolean): 'positive' | 'risk' {
  return isInactive || retentionRisk === 'high' || retentionRisk === 'critical' ? 'risk' : 'positive'
}

function calloutFromManager(m: ManagerSummaryShape): string {
  return m.retentionRiskReasons[0] ?? m.inactivityWarning ?? 'Active and engaged'
}

/**
 * Attach the age of the data to a claim made about the league.
 *
 * 🛑 THE SENTENCE THIS QUALIFIES IS THE MOST DAMAGING STRING IN THE PRODUCT. On the reference
 * league the intelligence API returns `topConcern: "No managers have recorded any activity"` —
 * arithmetically true over the rolling window, and read by a commissioner as "your league is
 * dead". The same response simultaneously reports waiver activity as HIGH at 6.56 claims per
 * manager, because that figure is all-time. Both come from the same rows; only the window
 * differs. What actually happened is that the league's newest imported event is weeks old.
 *
 * A commissioner cannot tell "your league is dying" from "we stopped receiving your data", and
 * the difference between those two is the entire product. Analytics already says this — its
 * summary headline and its freshness note both carry the caveat — and Mission Control, which is
 * the first thing anyone sees, did not.
 *
 * Appended to the claim rather than rendered beside it: the health card has room for exactly one
 * sentence, so a caveat that is not inside the sentence does not exist.
 */
function withDataAgeCaveat(claim: string, window: Awaited<ReturnType<typeof readAnalyticsDataWindow>>): string {
  if (!window) return claim
  const { daysSinceLastActivity, inactiveAfterDays } = window
  if (daysSinceLastActivity == null) {
    // Never any activity at all is a real state, and a different one from stale data.
    return `${claim} (no league activity has ever been recorded)`
  }
  if (daysSinceLastActivity <= inactiveAfterDays) return claim
  return `${claim} (no league activity recorded in ${daysSinceLastActivity} days)`
}

export const liveDecisionOSClient: DecisionOSClient = {
  /*
   * No `callDecisionOS` and no `isLiveReady` gate — this is a direct read of a table in the same
   * database the request already has open, the same reasoning Settings' client records at length.
   * There is no upstream integration here to stage behind a flag.
   */
  async getActivityTrend() {
    const timestamp = new Date().toISOString()
    const leagueId = await resolveActiveLeagueId()
    if (!leagueId) {
      return { data: null, error: notYetIntegrated('mission-control'), source: 'live', timestamp }
    }
    /*
     * An empty series comes back as DATA, not as an error. "This league has no captured history yet"
     * is a true and specific thing for the view to say; an error would replace it with a generic
     * failure and imply something is broken.
     */
    return { data: await readLeagueActivityTrend(leagueId), error: null, source: 'live', timestamp }
  },

  async getLeagueHealthSummary() {
    if (!(await isLiveReady('mission-control'))) {
      return { data: null, error: notYetIntegrated('mission-control'), source: 'live', timestamp: new Date().toISOString() }
    }
    const timestamp = new Date().toISOString()
    const leagueId = await resolveActiveLeagueId()
    if (!leagueId) {
      return { data: null, error: notYetIntegrated('mission-control'), source: 'live', timestamp }
    }

    const [leagueResult, trendResult] = await Promise.all([
      callDecisionOS<LeagueIntelligenceShape>('mission-control', `/api/v1/intelligence/league?leagueId=${encodeURIComponent(leagueId)}`),
      callDecisionOS<LeagueTrendShape>('mission-control', `/api/v1/intelligence/league/trend?leagueId=${encodeURIComponent(leagueId)}`),
    ])

    if (leagueResult.error || !leagueResult.data) {
      return { data: null, error: leagueResult.error ?? notYetIntegrated('mission-control'), source: 'live', timestamp }
    }
    /*
     * 🛑 A MISSING TREND USED TO DESTROY THE WHOLE HEALTH CARD, OVER A FIELD THE VIEW DOES
     * NOT RENDER. `MissionControlView` shows `score`, `tier` and `driver`; `trendLabel` appears
     * nowhere in it. Yet both branches above returned `data: null`, so the commissioner's health
     * score — a real, computed number that had already arrived — was replaced by an error state
     * because a SECOND call had nothing to compare against.
     *
     * That is not an edge case. `intelligence_league_snapshot_history` needs two rows before a
     * trend exists at all, so this fired for every league on the platform (the table held zero
     * rows until the snapshot job started writing it), and it still fires for the first two days
     * of any newly imported league, permanently and by design.
     *
     * A league with one day of history has a health score and no trend. Saying so is honest;
     * withholding the score is not.
     */
    const league = leagueResult.data.data
    // A failed trend call leaves `data` null, so `trend` is already undefined on that path and
    // `trendResult.error` needs no separate test. The discriminant is checked inline below rather
    // than hoisted into a boolean, because only the inline form narrows the union for the compiler.
    const trend = trendResult.data?.data
    const score = Math.round(league.leagueEngagementScore)
    const dataWindow = await readAnalyticsDataWindow(leagueId)
    const summary: LeagueHealthSummary = {
      score,
      tier: scoreToSeverityTier(score),
      trendLabel: trend?.available
        ? formatTrendLabel(trend.direction, trend.scoreDelta)
        : 'Not enough history yet to show a trend',
      trendDirection: trend?.available ? trend.direction : 'flat',
      driver: withDataAgeCaveat(
        league.healthNarrative.topConcern ?? league.healthNarrative.standoutSignal ?? league.healthNarrative.engagementSummary,
        dataWindow,
      ),
    }
    return { data: summary, error: null, source: 'live', timestamp }
  },

  async getManagerHighlights() {
    if (!(await isLiveReady('mission-control'))) {
      return { data: null, error: notYetIntegrated('mission-control'), source: 'live', timestamp: new Date().toISOString() }
    }
    const timestamp = new Date().toISOString()
    const leagueId = await resolveActiveLeagueId()
    if (!leagueId) {
      return { data: null, error: notYetIntegrated('mission-control'), source: 'live', timestamp }
    }

    const { data, error } = await callDecisionOS<LeagueManagersShape>(
      'mission-control',
      `/api/v1/intelligence/league/managers?leagueId=${encodeURIComponent(leagueId)}`,
    )
    if (error || !data) {
      return { data: null, error: error ?? notYetIntegrated('mission-control'), source: 'live', timestamp }
    }

    const managers = data.data
    const names = await resolveManagerDisplayNames(leagueId, managers.map((m) => m.managerId))
    const highlights: ManagerHighlight[] = managers.map((m) => ({
      id: m.managerId,
      /*
       * ⚠ THE FALLBACK USED TO BE `m.managerId`, WHICH PRINTED `sleeper:1267977501351628801`
       * INTO THE MANAGER HIGHLIGHT CARD. A raw provider id is not a degraded name, it is a leak
       * of an internal identifier onto a surface a commissioner shows their league.
       */
      managerName: names.get(m.managerId) ?? UNKNOWN_MANAGER_NAME,
      callout: calloutFromManager(m),
      tone: toneFromRisk(m.retentionRisk, m.isInactive),
    }))
    return { data: highlights, error: null, source: 'live', timestamp }
  },

  async getMissionControlKpis() {
    if (!(await isLiveReady('mission-control'))) {
      return { data: null, error: notYetIntegrated('mission-control'), source: 'live', timestamp: new Date().toISOString() }
    }
    const timestamp = new Date().toISOString()
    const leagueId = await resolveActiveLeagueId()
    if (!leagueId) {
      return { data: null, error: notYetIntegrated('mission-control'), source: 'live', timestamp }
    }

    const [leagueResult, deadlineResult] = await Promise.all([
      callDecisionOS<LeagueIntelligenceShape>('mission-control', `/api/v1/intelligence/league?leagueId=${encodeURIComponent(leagueId)}`),
      callDecisionOS<LeagueDeadlineShape>('mission-control', `/api/v1/intelligence/league/deadlines?leagueId=${encodeURIComponent(leagueId)}`),
    ])

    if (leagueResult.error || !leagueResult.data) {
      return { data: null, error: leagueResult.error ?? notYetIntegrated('mission-control'), source: 'live', timestamp }
    }
    if (deadlineResult.error || !deadlineResult.data) {
      return { data: null, error: deadlineResult.error ?? notYetIntegrated('mission-control'), source: 'live', timestamp }
    }

    const league = leagueResult.data.data
    const kpis: MissionControlKpis = {
      openRecommendations: league.recommendations.length,
      activeRisks: league.recommendations.filter((r) => r.priority === 'critical' || r.priority === 'high').length,
      engagementScore: Math.round(league.leagueEngagementScore),
      nextDeadlineLabel: formatDeadlineLabel(deadlineResult.data.data.nextActionableEvent),
    }
    return { data: kpis, error: null, source: 'live', timestamp }
  },
}
