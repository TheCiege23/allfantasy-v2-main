import { prisma } from '@/lib/prisma'
import { callDecisionOS } from '../adapter/transport'
import { isLiveReady } from '../liveReadiness'
import { canAccessLiveDecisionOSData } from '../liveModeAccess'
import { resolveActiveLeagueId } from '../resolveActiveLeagueId'
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
 * lib/commissioner-os/BACKEND_CAPABILITY_EXPANSION_REPORT.md's Historical
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

/** A specific, honest degradation — not a permanent gap anymore, but real for this request. */
function trendDataUnavailable(moduleId: CommissionerModuleId): CommissionerErrorContract {
  return {
    category: 'upstream_unavailable',
    message: 'The Decision OS backend does not yet have enough historical data to compute a trend for this league.',
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

/** Batch-resolves manager display names — one query for all managers, not N+1. */
async function resolveManagerDisplayNames(managerIds: string[]): Promise<Map<string, string>> {
  if (managerIds.length === 0) return new Map()
  const users = await prisma.appUser.findMany({
    where: { id: { in: managerIds } },
    select: { id: true, displayName: true, username: true },
  })
  const map = new Map<string, string>()
  for (const u of users) map.set(u.id, u.displayName ?? u.username)
  return map
}

export const liveDecisionOSClient: DecisionOSClient = {
  async getLeagueHealthSummary() {
    if (!(await isLiveReady('mission-control'))) {
      return { data: null, error: notYetIntegrated('mission-control'), source: 'live', timestamp: new Date().toISOString() }
    }
    if (!(await canAccessLiveDecisionOSData())) {
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
    if (trendResult.error) {
      return { data: null, error: trendResult.error, source: 'live', timestamp }
    }
    if (!trendResult.data || !trendResult.data.data.available) {
      return { data: null, error: trendDataUnavailable('mission-control'), source: 'live', timestamp }
    }

    const league = leagueResult.data.data
    const trend = trendResult.data.data
    const score = Math.round(league.leagueEngagementScore)
    const summary: LeagueHealthSummary = {
      score,
      tier: scoreToSeverityTier(score),
      trendLabel: formatTrendLabel(trend.direction, trend.scoreDelta),
      trendDirection: trend.direction,
      driver: league.healthNarrative.topConcern ?? league.healthNarrative.standoutSignal ?? league.healthNarrative.engagementSummary,
    }
    return { data: summary, error: null, source: 'live', timestamp }
  },

  async getManagerHighlights() {
    if (!(await isLiveReady('mission-control'))) {
      return { data: null, error: notYetIntegrated('mission-control'), source: 'live', timestamp: new Date().toISOString() }
    }
    if (!(await canAccessLiveDecisionOSData())) {
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
    const names = await resolveManagerDisplayNames(managers.map((m) => m.managerId))
    const highlights: ManagerHighlight[] = managers.map((m) => ({
      id: m.managerId,
      managerName: names.get(m.managerId) ?? m.managerId,
      callout: calloutFromManager(m),
      tone: toneFromRisk(m.retentionRisk, m.isInactive),
    }))
    return { data: highlights, error: null, source: 'live', timestamp }
  },

  async getMissionControlKpis() {
    if (!(await isLiveReady('mission-control'))) {
      return { data: null, error: notYetIntegrated('mission-control'), source: 'live', timestamp: new Date().toISOString() }
    }
    if (!(await canAccessLiveDecisionOSData())) {
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
