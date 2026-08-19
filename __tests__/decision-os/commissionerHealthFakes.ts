// Shared fakes for Decision OS commissioner-health tests (not a test file — no DB required).
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import { resolveCommissionerHealthWorld, type CommissionerHealthWorld } from '@/lib/decision-os/commissioner-health/world'
import type { CommissionerHealthDecisionDeps } from '@/lib/decision-os/commissioner-health/decision'

export function fakeSnapshot(over: Partial<CommissionerLeagueHealthSnapshot> = {}): CommissionerLeagueHealthSnapshot {
  return {
    leagueId: 'L1',
    leagueName: 'Test League',
    sport: 'NFL',
    leagueType: 'redraft',
    season: 2025,
    status: 'active',
    teamCount: 12,
    currentWeek: 6,
    generatedAt: new Date().toISOString(),
    source: 'database',
    dataConfidence: 'high',
    healthScore: 78,
    engagementScore: 72,
    fairnessScore: 85,
    sustainabilityScore: 76,
    overallStatus: 'healthy',
    healthTrend: 'stable',
    summary: 'League health: 78/100 (healthy). Prose — ignored by parity.',
    metrics: {
      inactiveTeams: 1,
      missedLineups: 0,
      tradeActivity: 8,
      waiverActivity: 20,
      leagueEngagement: 72,
      commissionerActions: 3,
      pendingWaiverClaims: 2,
      pendingTrades: 1,
      openAiAlerts: 0,
      chatMessagesLast7Days: 30,
      activeManagers: 11,
      injuredStarters: 2,
      lineupSubmissionRate: 1,
      projectionCoveragePct: 90,
      lowConfidenceProjectionStarters: 1,
    },
    alerts: [],
    recommendations: ['Post weekly recaps to keep engagement high.'],
    actions: [
      { key: 'settings', label: 'Settings', description: 'Review settings', href: '/league/L1?tab=Settings', enabled: true, requiresConfirmation: false, tone: 'standard' },
    ],
    assistantQuestions: [],
    nflDataCoverage: null,
    ...over,
  } as CommissionerLeagueHealthSnapshot
}

/** A critical-status snapshot (abandoned + inactive) to exercise the rule mapping. */
export function fakeCriticalSnapshot(): CommissionerLeagueHealthSnapshot {
  return fakeSnapshot({
    healthScore: 28,
    engagementScore: 30,
    fairnessScore: 40,
    sustainabilityScore: 30,
    overallStatus: 'critical',
    metrics: {
      inactiveTeams: 4,
      missedLineups: 3,
      tradeActivity: 0,
      waiverActivity: 1,
      leagueEngagement: 30,
      commissionerActions: 0,
      pendingWaiverClaims: 0,
      pendingTrades: 0,
      openAiAlerts: 2,
      chatMessagesLast7Days: 1,
      activeManagers: 8,
      injuredStarters: 4,
      lineupSubmissionRate: 0.6,
      projectionCoveragePct: 40,
      lowConfidenceProjectionStarters: 5,
    },
    alerts: ['CRITICAL: Multiple abandoned teams. Find replacements immediately.'],
    recommendations: ['Find replacement managers for abandoned teams'],
    dataConfidence: 'low',
  })
}

export function fakeWorld(over: Partial<CommissionerLeagueHealthSnapshot> = {}): CommissionerHealthWorld {
  return resolveCommissionerHealthWorld({ snapshot: fakeSnapshot(over) })
}

export function fakeDecisionDeps(over: Partial<CommissionerHealthDecisionDeps> = {}): CommissionerHealthDecisionDeps {
  const memo = fakeSnapshot()
  return { evaluate: async () => memo, newId: () => 'dec_test', ...over }
}
