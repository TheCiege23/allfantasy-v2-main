/**
 * Commissioner OS Demo Breadth — Phase C Increment 4.
 *
 * `resolveLeagueAnalyticsSnapshot` is pure composition over the already-tested
 * `resolveDecisionOsLeagueHealth` (Increment 3) — same mocking boundary as
 * `mission-control.test.ts` (its sibling surface). This file proves ONLY League Analytics' own
 * reshaping/degradation contract, not `resolveDecisionOsLeagueHealth`'s own correctness.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveLeagueAnalyticsSnapshot } from '@/lib/decision-os/leagueAnalytics'
import * as leagueHealthAlignment from '@/lib/decision-os/leagueHealthAlignment'
import type { DecisionOsLeagueHealthResult } from '@/lib/decision-os/leagueHealthAlignment'
import type { LeagueHealthResult } from '@/lib/league-health'

vi.mock('@/lib/decision-os/leagueHealthAlignment', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/leagueHealthAlignment')>(
    '@/lib/decision-os/leagueHealthAlignment',
  )
  return { ...actual, resolveDecisionOsLeagueHealth: vi.fn() }
})

const LG = 'league-analytics-alpha'
const NOW = new Date('2026-07-08T12:00:00Z')

function makeEngine(o: Partial<LeagueHealthResult> = {}): LeagueHealthResult {
  return {
    leagueHealthScore: 70, engagementScore: 70, fairnessScore: 70, sustainabilityScore: 70,
    confidencePct: 80, overallStatus: 'healthy', biggestStrengths: [], biggestProblems: [],
    urgentAlerts: [], earlyWarningSignals: [], inactiveManagerNotes: [], transactionHealthNotes: [],
    waiverHealthNotes: [], tradeHealthNotes: [], rosterBalanceNotes: [], commissionerHealthNotes: [],
    interventionRecommendations: [], summary: 'League health: 70/100 (healthy).',
    generatedAt: NOW.toISOString(), healthTrend: 'stable', churnRiskScore: 10, disputeRiskScore: 0,
    abandonmentRiskScore: 0, engagementDropoffFlags: [], ...o,
  }
}

function makeResult(o: Partial<DecisionOsLeagueHealthResult> = {}): DecisionOsLeagueHealthResult {
  return {
    engine: makeEngine(),
    decisionOs: {
      activityEventCount: 20, activeManagerCount: 10, inactiveManagerCount: 0, tradeCount: 3,
      waiverClaimCount: 12, draftPickCount: 0, commissionerActionCount: 1, rosterActivityCount: 8,
      managersAtRetentionRisk: [], trend: { available: false, reason: 'no_snapshots' },
    },
    fieldProvenance: {} as DecisionOsLeagueHealthResult['fieldProvenance'],
    ...o,
  }
}

const mockResolve = () => vi.mocked(leagueHealthAlignment.resolveDecisionOsLeagueHealth)

afterEach(() => {
  vi.clearAllMocks()
})

describe('resolveLeagueAnalyticsSnapshot', () => {
  it('a populated league maps real trend/counts/retention-risk count through honestly', async () => {
    mockResolve().mockResolvedValue(
      makeResult({
        decisionOs: {
          activityEventCount: 50, activeManagerCount: 11, inactiveManagerCount: 1, tradeCount: 5,
          waiverClaimCount: 20, draftPickCount: 12, commissionerActionCount: 2, rosterActivityCount: 30,
          managersAtRetentionRisk: [
            { managerId: 'mgr-1', retentionRisk: 'high', retentionRiskReasons: ['inactive'], isInactive: false },
            { managerId: 'mgr-2', retentionRisk: 'critical', retentionRiskReasons: ['zero events'], isInactive: true },
          ],
          trend: { available: true, periodsTracked: 3, earliestPeriodKey: '2026-07-06', latestPeriodKey: '2026-07-08', latestEventCount: 20, latestManagerCount: 11, eventCountDelta: 4, direction: 'increasing' },
        },
      }),
    )

    const snapshot = await resolveLeagueAnalyticsSnapshot(LG, NOW)

    expect(snapshot.available).toBe(true)
    if (!snapshot.available) throw new Error('unreachable')
    expect(snapshot.managerCounts).toEqual({ activeManagers: 11, inactiveManagers: 1 })
    expect(snapshot.activity).toEqual({ tradeCount: 5, waiverClaimCount: 20, draftPickCount: 12, rosterActivityCount: 30 })
    expect(snapshot.retentionRiskCount).toBe(2)
    expect(snapshot.trend).toEqual({ available: true, periodsTracked: 3, earliestPeriodKey: '2026-07-06', latestPeriodKey: '2026-07-08', latestEventCount: 20, latestManagerCount: 11, eventCountDelta: 4, direction: 'increasing' })
  })

  it('reports no_snapshots trend availability honestly', async () => {
    mockResolve().mockResolvedValue(makeResult())
    const snapshot = await resolveLeagueAnalyticsSnapshot(LG, NOW)
    expect(snapshot.available).toBe(true)
    if (!snapshot.available) throw new Error('unreachable')
    expect(snapshot.trend).toEqual({ available: false, reason: 'no_snapshots' })
  })

  it('reports insufficient_history trend availability at exactly one captured period', async () => {
    mockResolve().mockResolvedValue(
      makeResult({ decisionOs: { ...makeResult().decisionOs, trend: { available: false, reason: 'insufficient_history' } } }),
    )
    const snapshot = await resolveLeagueAnalyticsSnapshot(LG, NOW)
    expect(snapshot.available).toBe(true)
    if (!snapshot.available) throw new Error('unreachable')
    expect(snapshot.trend).toEqual({ available: false, reason: 'insufficient_history' })
  })

  it('a no-activity league produces an honest all-zero snapshot, not fabricated data', async () => {
    mockResolve().mockResolvedValue(makeResult())
    const snapshot = await resolveLeagueAnalyticsSnapshot(LG, NOW)
    expect(snapshot.available).toBe(true)
    if (!snapshot.available) throw new Error('unreachable')
    expect(snapshot.managerCounts).toEqual({ activeManagers: 10, inactiveManagers: 0 })
    expect(snapshot.retentionRiskCount).toBe(0)
  })

  it('surfaces the retention-risk COUNT only, never named managers or reasons', async () => {
    mockResolve().mockResolvedValue(
      makeResult({
        decisionOs: {
          ...makeResult().decisionOs,
          managersAtRetentionRisk: [
            { managerId: 'mgr-a', retentionRisk: 'high', retentionRiskReasons: ['x'], isInactive: false },
          ],
        },
      }),
    )
    const snapshot = await resolveLeagueAnalyticsSnapshot(LG, NOW)
    expect(snapshot.available).toBe(true)
    if (!snapshot.available) throw new Error('unreachable')
    expect(snapshot.retentionRiskCount).toBe(1)
    expect(snapshot).not.toHaveProperty('managersAtRetentionRisk')
  })

  it('degrades to an explicit league_health_unavailable state instead of throwing when the dependency fails', async () => {
    mockResolve().mockRejectedValue(new Error('boom'))
    const snapshot = await resolveLeagueAnalyticsSnapshot(LG, NOW)
    expect(snapshot).toEqual({
      leagueId: LG,
      generatedAt: NOW.toISOString(),
      available: false,
      reason: 'league_health_unavailable',
    })
  })

  it('wiring proof: calls resolveDecisionOsLeagueHealth with the given league id', async () => {
    mockResolve().mockResolvedValue(makeResult())
    await resolveLeagueAnalyticsSnapshot(LG, NOW)
    expect(mockResolve()).toHaveBeenCalledWith(LG)
  })
})
