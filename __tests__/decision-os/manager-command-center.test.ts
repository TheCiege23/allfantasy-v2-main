/**
 * Fantasy OS Suite — Phase OS-C1: Manager Operating System Foundation.
 *
 * `resolveManagerCommandCenterSnapshot` aggregates the already-real, single-league
 * `resolveUserOsSnapshot` across every league a manager belongs to. Mocks that one resolver — this
 * module's own job is aggregation, never re-deriving anything `userOs.ts` already computed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveManagerCommandCenterSnapshot } from '@/lib/decision-os/managerCommandCenter'
import { resolveUserOsSnapshot } from '@/lib/decision-os/userOs'
import type { UserOsSnapshot } from '@/lib/decision-os/userOs'

vi.mock('@/lib/decision-os/userOs', () => ({
  resolveUserOsSnapshot: vi.fn(),
}))

const mockResolve = vi.mocked(resolveUserOsSnapshot)
const NOW = new Date('2026-07-09T12:00:00Z')

function availableSnapshot(o: {
  leagueId: string
  retentionRisk?: 'low' | 'medium' | 'high' | 'critical' | 'insufficient_data'
  isInactive?: boolean
  recommendationCount?: number
}): UserOsSnapshot {
  return {
    leagueId: o.leagueId,
    managerId: 'user-1',
    generatedAt: NOW.toISOString(),
    available: true,
    teamHealth: {
      participationTier: 'active',
      overallEngagementScore: 70,
      retentionRisk: o.retentionRisk ?? 'low',
      retentionRiskReasons: [],
      isInactive: o.isInactive ?? false,
      daysSinceLastActivity: 1,
    },
    activitySummary: { tradeEventCount: 0, waiverEventCount: 0, lineupEventCount: 0, draftEventCount: 0 },
    leagueTrend: { available: false, reason: 'no_snapshots' },
    managerDna: null,
    recommendations:
      (o.recommendationCount ?? 0) > 0
        ? {
            entityId: 'user-1',
            tier: 'manager',
            recommendations: Array.from({ length: o.recommendationCount ?? 0 }, (_, i) => ({
              id: `rec-${i}`,
              tier: 'manager' as const,
              category: 'engagement_boost' as const,
              entityId: 'user-1',
              priority: 'medium' as const,
              severity: 'standard' as const,
              confidence: 'high' as const,
              affectedDimensions: [],
              expectedImpact: 'impact',
              derivation: [],
              evidence: [],
              benchmarkComparison: null,
              prerequisites: [],
              recommendedActions: [],
              rollbackCriteria: [],
              completeness: 100,
              uncertainty: [],
            })),
            totalRecommendations: o.recommendationCount ?? 0,
            criticalCount: 0,
            warnings: [],
            version: '1',
          }
        : null,
  }
}

function unavailableSnapshot(leagueId: string): UserOsSnapshot {
  return { leagueId, managerId: 'user-1', generatedAt: NOW.toISOString(), available: false, reason: 'user_os_unavailable' }
}

describe('resolveManagerCommandCenterSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns an honest empty snapshot for zero leagues, never calling resolveUserOsSnapshot', async () => {
    const snapshot = await resolveManagerCommandCenterSnapshot('user-1', [], NOW)
    expect(snapshot.totalLeagues).toBe(0)
    expect(snapshot.warnings).toEqual(['no_leagues_specified'])
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it('calls resolveUserOsSnapshot once per league, with the caller\'s own userId', async () => {
    mockResolve.mockResolvedValue(availableSnapshot({ leagueId: 'L1' }))
    await resolveManagerCommandCenterSnapshot('user-1', ['L1', 'L2'], NOW)
    expect(mockResolve).toHaveBeenCalledWith('L1', 'user-1', NOW)
    expect(mockResolve).toHaveBeenCalledWith('L2', 'user-1', NOW)
    expect(mockResolve).toHaveBeenCalledTimes(2)
  })

  it('one league failing (throwing) marks it unavailable without failing the whole snapshot', async () => {
    mockResolve
      .mockResolvedValueOnce(availableSnapshot({ leagueId: 'L1' }))
      .mockRejectedValueOnce(new Error('boom'))
    const snapshot = await resolveManagerCommandCenterSnapshot('user-1', ['L1', 'L2'], NOW)
    expect(snapshot.unavailableLeagueCount).toBe(1)
    expect(snapshot.leagueSummaries.find((s) => s.leagueId === 'L2')?.available).toBe(false)
  })

  it('an available: false UserOsSnapshot also counts as unavailable', async () => {
    mockResolve.mockResolvedValueOnce(unavailableSnapshot('L1'))
    const snapshot = await resolveManagerCommandCenterSnapshot('user-1', ['L1'], NOW)
    expect(snapshot.unavailableLeagueCount).toBe(1)
    expect(snapshot.healthyLeagueCount).toBe(0)
    expect(snapshot.atRiskLeagueCount).toBe(0)
  })

  it('buckets low retention risk + active as healthy, medium/high/critical or inactive as at-risk', async () => {
    mockResolve
      .mockResolvedValueOnce(availableSnapshot({ leagueId: 'L1', retentionRisk: 'low' }))
      .mockResolvedValueOnce(availableSnapshot({ leagueId: 'L2', retentionRisk: 'critical' }))
      .mockResolvedValueOnce(availableSnapshot({ leagueId: 'L3', retentionRisk: 'low', isInactive: true }))
    const snapshot = await resolveManagerCommandCenterSnapshot('user-1', ['L1', 'L2', 'L3'], NOW)
    expect(snapshot.healthyLeagueCount).toBe(1)
    expect(snapshot.atRiskLeagueCount).toBe(2)
  })

  // Phase OS-C3: real bug found during live validation — `medium` retention risk fires a real
  // `manager_engagement_risk` Attention Queue signal (see `MANAGER_RETENTION_SEVERITY` in
  // attentionSignals.ts) but was NOT counted as at-risk here, so the "Need attention" stat chip could
  // read 0 while the Attention Queue showed a real item — two real numbers silently contradicting
  // each other on the same screen.
  it('counts medium retention risk as at-risk, consistent with the Attention Queue signal it produces', async () => {
    mockResolve.mockResolvedValueOnce(availableSnapshot({ leagueId: 'L1', retentionRisk: 'medium' }))
    const snapshot = await resolveManagerCommandCenterSnapshot('user-1', ['L1'], NOW)
    expect(snapshot.atRiskLeagueCount).toBe(1)
    expect(snapshot.healthyLeagueCount).toBe(0)
    expect(snapshot.attentionQueue.find((s) => s.type === 'manager_engagement_risk')).toBeDefined()
  })

  // Phase 36: real bug found via real .env.test execution — a league with insufficient_data
  // retention risk still carries isInactive: true (a separate, legitimately-computed field from
  // deriveManagerBehavioralIntelligence), and the old `AT_RISK_RETENTION.has(...) || isInactive`
  // check bucketed it as at-risk anyway, defeating the whole point of the insufficient_data fix.
  // A real 8-league user showed atRiskLeagueCount: 8/8 even after the retentionRisk fix landed,
  // until this bucketing logic was also corrected.
  it('does not bucket insufficient_data leagues as at-risk, even when isInactive is true', async () => {
    mockResolve.mockResolvedValueOnce(
      availableSnapshot({ leagueId: 'L1', retentionRisk: 'insufficient_data', isInactive: true }),
    )
    const snapshot = await resolveManagerCommandCenterSnapshot('user-1', ['L1'], NOW)
    expect(snapshot.atRiskLeagueCount).toBe(0)
    expect(snapshot.healthyLeagueCount).toBe(0)
    expect(snapshot.insufficientDataLeagueCount).toBe(1)
  })

  it('totalLeagues always equals the sum of all four buckets (no silent count mismatch)', async () => {
    mockResolve
      .mockResolvedValueOnce(availableSnapshot({ leagueId: 'L1', retentionRisk: 'low' }))
      .mockResolvedValueOnce(availableSnapshot({ leagueId: 'L2', retentionRisk: 'critical' }))
      .mockResolvedValueOnce(availableSnapshot({ leagueId: 'L3', retentionRisk: 'insufficient_data', isInactive: true }))
      .mockResolvedValueOnce(unavailableSnapshot('L4'))
    const snapshot = await resolveManagerCommandCenterSnapshot('user-1', ['L1', 'L2', 'L3', 'L4'], NOW)
    expect(
      snapshot.healthyLeagueCount + snapshot.atRiskLeagueCount + snapshot.unavailableLeagueCount + snapshot.insufficientDataLeagueCount,
    ).toBe(snapshot.totalLeagues)
  })

  it('derives real attention signals from each league\'s own real UserOsSnapshot data', async () => {
    mockResolve.mockResolvedValueOnce(availableSnapshot({ leagueId: 'L1', retentionRisk: 'critical' }))
    const snapshot = await resolveManagerCommandCenterSnapshot('user-1', ['L1'], NOW)
    expect(snapshot.attentionQueue.find((s) => s.type === 'manager_engagement_risk')).toBeDefined()
  })

  it('derives one manager_recommendation signal per real recommendation', async () => {
    mockResolve.mockResolvedValueOnce(availableSnapshot({ leagueId: 'L1', recommendationCount: 3 }))
    const snapshot = await resolveManagerCommandCenterSnapshot('user-1', ['L1'], NOW)
    expect(snapshot.attentionQueue.filter((s) => s.type === 'manager_recommendation')).toHaveLength(3)
  })

  it('caps the aggregate attention queue at ATTENTION_QUEUE_CAP across leagues', async () => {
    mockResolve.mockImplementation(async (leagueId: string) =>
      availableSnapshot({ leagueId, recommendationCount: 5 }),
    )
    const leagueIds = Array.from({ length: 10 }, (_, i) => `L${i}`)
    const snapshot = await resolveManagerCommandCenterSnapshot('user-1', leagueIds, NOW)
    expect(snapshot.attentionQueue.length).toBeLessThanOrEqual(20)
  })

  it('includes a real leagueTrend only when the underlying trend is available', async () => {
    mockResolve.mockResolvedValueOnce({
      ...availableSnapshot({ leagueId: 'L1' }),
      leagueTrend: { available: true, periodsTracked: 3, earliestPeriodKey: 'p1', latestPeriodKey: 'p3', latestEventCount: 5, latestManagerCount: 10, eventCountDelta: 2, direction: 'increasing' },
    })
    const snapshot = await resolveManagerCommandCenterSnapshot('user-1', ['L1'], NOW)
    expect(snapshot.leagueTrends).toEqual([{ leagueId: 'L1', direction: 'increasing', eventCountDelta: 2 }])
  })

  // Phase OS-C2: `recommendations` exposes the same real Phase 6.4 objects `manager_recommendation`
  // signals are already derived from — the canonical source for Lineup/Trade/Waiver Priorities per
  // docs/os/OS_C2_PRIORITIES_ARCHITECTURE_AUDIT.md.
  it('exposes the real recommendations, each tagged with its own real leagueId (never the recommendation\'s own entityId)', async () => {
    mockResolve.mockResolvedValueOnce(availableSnapshot({ leagueId: 'L1', recommendationCount: 2 }))
    const snapshot = await resolveManagerCommandCenterSnapshot('user-1', ['L1'], NOW)
    expect(snapshot.recommendations).toHaveLength(2)
    expect(snapshot.recommendations[0].leagueId).toBe('L1')
    expect(snapshot.recommendations[0].recommendation.id).toBe('rec-0')
  })

  it('never includes recommendations for an unavailable league', async () => {
    mockResolve.mockResolvedValueOnce(unavailableSnapshot('L1'))
    const snapshot = await resolveManagerCommandCenterSnapshot('user-1', ['L1'], NOW)
    expect(snapshot.recommendations).toEqual([])
  })

  it('aggregates recommendations across multiple leagues, each correctly tagged', async () => {
    mockResolve
      .mockResolvedValueOnce(availableSnapshot({ leagueId: 'L1', recommendationCount: 1 }))
      .mockResolvedValueOnce(availableSnapshot({ leagueId: 'L2', recommendationCount: 1 }))
    const snapshot = await resolveManagerCommandCenterSnapshot('user-1', ['L1', 'L2'], NOW)
    expect(snapshot.recommendations.map((r) => r.leagueId).sort()).toEqual(['L1', 'L2'])
  })

  // Phase OS-C6: production-readiness audit found this resolution loop was sequential (one league
  // at a time) while every sibling multi-league composition (commissionerCommandCenter.ts,
  // platformOs.ts, attentionQueue.ts) already resolves in parallel via Promise.all — a real,
  // verified inconsistency, not a premature optimization. This test proves the fix: resolving N
  // leagues takes roughly as long as the SLOWEST single league, not the SUM of all of them.
  it('resolves all leagues in parallel, not sequentially', async () => {
    const DELAY_MS = 40
    mockResolve.mockImplementation(
      (leagueId: string) =>
        new Promise((resolve) => setTimeout(() => resolve(availableSnapshot({ leagueId })), DELAY_MS)),
    )
    const leagueIds = Array.from({ length: 5 }, (_, i) => `L${i}`)
    const start = Date.now()
    await resolveManagerCommandCenterSnapshot('user-1', leagueIds, NOW)
    const elapsed = Date.now() - start
    // Sequential would take ~5 * DELAY_MS (200ms); parallel takes ~1 * DELAY_MS. Generous upper
    // bound to avoid CI flakiness while still failing decisively if this regresses to sequential.
    expect(elapsed).toBeLessThan(DELAY_MS * 3)
  })
})
