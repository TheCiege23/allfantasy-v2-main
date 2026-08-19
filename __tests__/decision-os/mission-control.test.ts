/**
 * Commissioner OS Surface Alignment — Phase B Increment 5.
 *
 * `resolveMissionControlSnapshot` is pure composition over the already-tested
 * `resolveDecisionOsLeagueHealth` (Increment 3) — this file mocks that boundary directly (not the
 * port layer underneath it) and proves ONLY Mission Control's own reshaping/degradation contract:
 * field mapping, recommended-actions relabeling/dedup, and the defense-in-depth
 * `leagueHealth: { available: false }` fallback. `resolveDecisionOsLeagueHealth`'s own real-data
 * correctness is covered by `league-health-alignment.test.ts` and is not re-tested here.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveMissionControlSnapshot } from '@/lib/decision-os/missionControl'
import * as leagueHealthAlignment from '@/lib/decision-os/leagueHealthAlignment'
import type { DecisionOsLeagueHealthResult, ManagerAtRetentionRisk } from '@/lib/decision-os/leagueHealthAlignment'
import type { LeagueHealthResult } from '@/lib/league-health'

vi.mock('@/lib/decision-os/leagueHealthAlignment', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/leagueHealthAlignment')>(
    '@/lib/decision-os/leagueHealthAlignment',
  )
  return { ...actual, resolveDecisionOsLeagueHealth: vi.fn() }
})

const LG = 'league-mc-alpha'
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
    fieldProvenance: {
      leagueId: 'schema_default', sport: 'schema_default', leagueType: 'schema_default',
      numTeams: 'schema_default', currentWeek: 'schema_default', totalWeeks: 'schema_default',
      activeManagers: 'decision_os', inactiveManagers: 'decision_os', abandonedTeams: 'schema_default',
      lineupSubmissionRate: 'schema_default', totalTradesThisSeason: 'decision_os',
      totalWaiverClaims: 'decision_os', avgFaabSpentPct: 'schema_default', chatMessageCount: 'schema_default',
      voteCount: 'schema_default', disputeCount: 'schema_default',
      commissionerActionsThisSeason: 'decision_os', unresolvedDisputes: 'schema_default',
      playoffTeams: 'schema_default', waiverType: 'schema_default', tradeReviewProcess: 'schema_default',
      previousSeasonHealthScore: 'schema_default',
    },
    ...o,
  }
}

const mockResolve = () => vi.mocked(leagueHealthAlignment.resolveDecisionOsLeagueHealth)

afterEach(() => {
  vi.clearAllMocks()
})

describe('resolveMissionControlSnapshot', () => {
  it('a healthy, populated league maps every real field through honestly', async () => {
    const risk: ManagerAtRetentionRisk = {
      managerId: 'mgr-1', retentionRisk: 'high', retentionRiskReasons: ['inactive 14+ days'], isInactive: false,
    }
    mockResolve().mockResolvedValue(
      makeResult({
        decisionOs: {
          activityEventCount: 50, activeManagerCount: 11, inactiveManagerCount: 1, tradeCount: 5,
          waiverClaimCount: 20, draftPickCount: 12, commissionerActionCount: 2, rosterActivityCount: 30,
          managersAtRetentionRisk: [risk],
          trend: { available: true, periodsTracked: 3, earliestPeriodKey: '2026-07-06', latestPeriodKey: '2026-07-08', latestEventCount: 20, latestManagerCount: 11, eventCountDelta: 4, direction: 'increasing' },
        },
      }),
    )

    const snapshot = await resolveMissionControlSnapshot(LG, NOW)

    expect(snapshot.leagueId).toBe(LG)
    expect(snapshot.leagueHealth).toMatchObject({ available: true })
    expect(snapshot.managerCounts).toEqual({ activeManagers: 11, inactiveManagers: 1 })
    expect(snapshot.activity).toEqual({ tradeCount: 5, waiverClaimCount: 20, draftPickCount: 12, rosterActivityCount: 30 })
    expect(snapshot.managersAtRetentionRisk).toEqual([risk])
    expect(snapshot.trend).toEqual({ available: true, periodsTracked: 3, earliestPeriodKey: '2026-07-06', latestPeriodKey: '2026-07-08', latestEventCount: 20, latestManagerCount: 11, eventCountDelta: 4, direction: 'increasing' })
    expect(snapshot.fieldProvenance?.activeManagers).toBe('decision_os')
  })

  it('a no-activity league produces an honest all-zero snapshot, not fabricated data', async () => {
    mockResolve().mockResolvedValue(makeResult())

    const snapshot = await resolveMissionControlSnapshot(LG, NOW)

    expect(snapshot.managerCounts).toEqual({ activeManagers: 10, inactiveManagers: 0 })
    expect(snapshot.managersAtRetentionRisk).toEqual([])
    expect(snapshot.recommendedActions).toEqual([])
    expect(snapshot.trend).toEqual({ available: false, reason: 'no_snapshots' })
  })

  it('reports no_snapshots trend availability honestly when there is no captured history', async () => {
    mockResolve().mockResolvedValue(
      makeResult({ decisionOs: { ...makeResult().decisionOs, trend: { available: false, reason: 'no_snapshots' } } }),
    )
    const snapshot = await resolveMissionControlSnapshot(LG, NOW)
    expect(snapshot.trend).toEqual({ available: false, reason: 'no_snapshots' })
  })

  it('reports insufficient_history trend availability honestly at exactly one captured period', async () => {
    mockResolve().mockResolvedValue(
      makeResult({ decisionOs: { ...makeResult().decisionOs, trend: { available: false, reason: 'insufficient_history' } } }),
    )
    const snapshot = await resolveMissionControlSnapshot(LG, NOW)
    expect(snapshot.trend).toEqual({ available: false, reason: 'insufficient_history' })
  })

  it('surfaces managers at retention risk with their real reasons, unmodified', async () => {
    const risks: ManagerAtRetentionRisk[] = [
      { managerId: 'mgr-a', retentionRisk: 'critical', retentionRiskReasons: ['0 events in 90 days'], isInactive: true },
      { managerId: 'mgr-b', retentionRisk: 'high', retentionRiskReasons: ['declining lineup submission'], isInactive: false },
    ]
    mockResolve().mockResolvedValue(makeResult({ decisionOs: { ...makeResult().decisionOs, managersAtRetentionRisk: risks } }))

    const snapshot = await resolveMissionControlSnapshot(LG, NOW)

    expect(snapshot.managersAtRetentionRisk).toEqual(risks)
  })

  it('recommended actions relabel the federated engine urgentAlerts/interventionRecommendations, urgent first, deduped', async () => {
    mockResolve().mockResolvedValue(
      makeResult({
        engine: makeEngine({
          urgentAlerts: ['ALERT: 30%+ of managers inactive. League may be dying.'],
          interventionRecommendations: [
            'ALERT: 30%+ of managers inactive. League may be dying.', // duplicate of an urgent alert
            'Post weekly recaps, power rankings, or trash talk threads to boost engagement',
          ],
        }),
      }),
    )

    const snapshot = await resolveMissionControlSnapshot(LG, NOW)

    expect(snapshot.recommendedActions).toEqual([
      { priority: 'urgent', message: 'ALERT: 30%+ of managers inactive. League may be dying.' },
      { priority: 'standard', message: 'Post weekly recaps, power rankings, or trash talk threads to boost engagement' },
    ])
  })

  it('degrades to an explicit league_health_unavailable state instead of throwing when the dependency fails', async () => {
    mockResolve().mockRejectedValue(new Error('boom'))

    const snapshot = await resolveMissionControlSnapshot(LG, NOW)

    expect(snapshot.leagueHealth).toEqual({ available: false, reason: 'league_health_unavailable' })
    expect(snapshot.trend).toEqual({ available: false, reason: 'no_snapshots' })
    expect(snapshot.managerCounts).toEqual({ activeManagers: 0, inactiveManagers: 0 })
    expect(snapshot.activity).toEqual({ tradeCount: 0, waiverClaimCount: 0, draftPickCount: 0, rosterActivityCount: 0 })
    expect(snapshot.managersAtRetentionRisk).toEqual([])
    expect(snapshot.recommendedActions).toEqual([])
    expect(snapshot.fieldProvenance).toBeNull()
  })

  it('wiring proof: calls resolveDecisionOsLeagueHealth with the given league id', async () => {
    mockResolve().mockResolvedValue(makeResult())
    await resolveMissionControlSnapshot(LG, NOW)
    expect(mockResolve()).toHaveBeenCalledWith(LG)
  })
})
