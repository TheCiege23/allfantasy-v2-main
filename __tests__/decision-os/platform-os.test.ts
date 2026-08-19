/**
 * Fantasy OS Suite — Phase D Increment 4; migrated onto the shared Attention Signal model in
 * Phase OS-B4.5.
 *
 * `resolvePlatformOsSnapshot` is pure composition over the already-tested
 * `resolveMissionControlSnapshot` (Commissioner OS Surface Alignment Increment 5) — this file mocks
 * that boundary directly (matching `league-analytics.test.ts`'s own precedent of mocking one layer
 * down) and proves ONLY Platform OS's own aggregation/degradation contract: multi-league summation,
 * per-league failure isolation, trend-coverage tallying, and (as of OS-B4.5) real Attention Signal
 * derivation via `deriveLeagueAttentionSignals` — not `attentionSignals.test.ts`'s own severity-rule
 * correctness, already covered there.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolvePlatformOsSnapshot } from '@/lib/decision-os/platformOs'
import * as missionControl from '@/lib/decision-os/missionControl'
import * as leagueContext from '@/lib/decision-os/leagueContext'
import * as attentionQueue from '@/lib/decision-os/attentionQueue'
import type { MissionControlSnapshot } from '@/lib/decision-os/missionControl'
import type { LeagueHealthResult } from '@/lib/league-health'
import type { DecisionOsLeagueHealthResult } from '@/lib/decision-os/leagueHealthAlignment'

vi.mock('@/lib/decision-os/missionControl', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/missionControl')>(
    '@/lib/decision-os/missionControl',
  )
  return { ...actual, resolveMissionControlSnapshot: vi.fn() }
})

vi.mock('@/lib/decision-os/leagueContext', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/leagueContext')>(
    '@/lib/decision-os/leagueContext',
  )
  // Mock `resolveLeagueFinancialContextSafely` — the function `platformOs.ts` actually calls (Phase
  // OS-B4.5's shared-helper consolidation). Mocking `resolveLeagueFinancialContext` alone would NOT take
  // effect: `resolveLeagueFinancialContextSafely` is copied verbatim from `actual` and its closure still
  // calls the REAL, unmocked inner function.
  return { ...actual, resolveLeagueFinancialContextSafely: vi.fn() }
})

vi.mock('@/lib/decision-os/attentionQueue', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/attentionQueue')>(
    '@/lib/decision-os/attentionQueue',
  )
  return { ...actual, loadUpcomingDraftDates: vi.fn() }
})

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

function makeSnapshot(leagueId: string, o: Partial<MissionControlSnapshot> = {}): MissionControlSnapshot {
  const engine = makeEngine()
  const result: DecisionOsLeagueHealthResult = {
    engine,
    decisionOs: {
      activityEventCount: 10, activeManagerCount: 10, inactiveManagerCount: 0, tradeCount: 2,
      waiverClaimCount: 5, draftPickCount: 0, commissionerActionCount: 0, rosterActivityCount: 4,
      managersAtRetentionRisk: [], trend: { available: false, reason: 'no_snapshots' },
    },
    fieldProvenance: {} as DecisionOsLeagueHealthResult['fieldProvenance'],
  }
  return {
    leagueId,
    generatedAt: NOW.toISOString(),
    leagueHealth: { available: true, result },
    trend: { available: false, reason: 'no_snapshots' },
    managerCounts: { activeManagers: 10, inactiveManagers: 0 },
    activity: { tradeCount: 2, waiverClaimCount: 5, draftPickCount: 0, rosterActivityCount: 4 },
    managersAtRetentionRisk: [],
    recommendedActions: [],
    fieldProvenance: result.fieldProvenance,
    ...o,
  }
}

const FREE_CONTEXT = {
  leagueId: 'x', financialStatus: 'FREE' as const, buyInAmount: null, buyInCurrency: null,
  escrowProvider: 'UNKNOWN' as const, financialConfidence: 'UNKNOWN' as const, financialNotes: null,
  isUserConfirmed: false, lastVerifiedAt: null,
}

const mockResolve = () => vi.mocked(missionControl.resolveMissionControlSnapshot)
const mockFinancialContext = () => vi.mocked(leagueContext.resolveLeagueFinancialContextSafely)
const mockDraftDates = () => vi.mocked(attentionQueue.loadUpcomingDraftDates)

function setDefaults() {
  mockFinancialContext().mockResolvedValue(FREE_CONTEXT)
  mockDraftDates().mockResolvedValue(new Map())
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('resolvePlatformOsSnapshot', () => {
  it('aggregates multiple leagues correctly: counts, health split, retention risk', async () => {
    setDefaults()
    mockResolve().mockImplementation(async (leagueId: string) => {
      if (leagueId === 'L1') {
        return makeSnapshot('L1', {
          managerCounts: { activeManagers: 10, inactiveManagers: 2 },
          activity: { tradeCount: 3, waiverClaimCount: 8, draftPickCount: 12, rosterActivityCount: 6 },
          managersAtRetentionRisk: [
            { managerId: 'm1', retentionRisk: 'high', retentionRiskReasons: ['inactive'], isInactive: false },
          ],
        })
      }
      const l2Engine = makeEngine({ overallStatus: 'at_risk' })
      const l2Result: DecisionOsLeagueHealthResult = {
        engine: l2Engine,
        decisionOs: {
          activityEventCount: 3, activeManagerCount: 8, inactiveManagerCount: 0, tradeCount: 1,
          waiverClaimCount: 2, draftPickCount: 0, commissionerActionCount: 0, rosterActivityCount: 3,
          managersAtRetentionRisk: [], trend: { available: false, reason: 'no_snapshots' },
        },
        fieldProvenance: {} as DecisionOsLeagueHealthResult['fieldProvenance'],
      }
      return makeSnapshot('L2', {
        leagueHealth: { available: true, result: l2Result },
        managerCounts: { activeManagers: 8, inactiveManagers: 0 },
        activity: { tradeCount: 1, waiverClaimCount: 2, draftPickCount: 0, rosterActivityCount: 3 },
      })
    })

    const snapshot = await resolvePlatformOsSnapshot(['L1', 'L2'], NOW)

    expect(snapshot.totalMonitoredLeagues).toBe(2)
    expect(snapshot.healthyLeagueCount).toBe(1) // L1 = 'healthy'
    expect(snapshot.atRiskLeagueCount).toBe(1) // L2 = 'at_risk'
    expect(snapshot.unavailableLeagueCount).toBe(0)
    expect(snapshot.totalActiveManagers).toBe(18)
    expect(snapshot.totalInactiveManagers).toBe(2)
    expect(snapshot.totalTrades).toBe(4)
    expect(snapshot.totalWaiverClaims).toBe(10)
    expect(snapshot.totalDraftPicks).toBe(12)
    expect(snapshot.totalRosterActivity).toBe(9)
    expect(snapshot.totalRetentionRiskManagers).toBe(1)
    expect(snapshot.provenance).toEqual({
      source: 'commissioner_os_composition',
      requestedLeagueCount: 2,
      resolvedLeagueCount: 2,
      unavailableLeagueCount: 0,
    })
  })

  it('one failed league does not break the whole platform snapshot', async () => {
    setDefaults()
    mockResolve().mockImplementation(async (leagueId: string) => {
      if (leagueId === 'L-bad') throw new Error('boom')
      return makeSnapshot(leagueId)
    })

    const snapshot = await resolvePlatformOsSnapshot(['L1', 'L-bad', 'L2'], NOW)

    expect(snapshot.totalMonitoredLeagues).toBe(3)
    expect(snapshot.unavailableLeagueCount).toBe(1)
    expect(snapshot.healthyLeagueCount).toBe(2) // L1 + L2 still resolved and counted
    expect(snapshot.totalActiveManagers).toBe(20) // only the 2 resolved leagues' counts
    expect(snapshot.provenance.resolvedLeagueCount).toBe(2)
  })

  it('a league whose own leagueHealth is unavailable is excluded from aggregates, not fabricated', async () => {
    setDefaults()
    mockResolve().mockImplementation(async (leagueId: string) => {
      if (leagueId === 'L-unavailable') {
        return {
          leagueId,
          generatedAt: NOW.toISOString(),
          leagueHealth: { available: false, reason: 'league_health_unavailable' },
          trend: { available: false, reason: 'no_snapshots' },
          managerCounts: { activeManagers: 0, inactiveManagers: 0 },
          activity: { tradeCount: 0, waiverClaimCount: 0, draftPickCount: 0, rosterActivityCount: 0 },
          managersAtRetentionRisk: [],
          recommendedActions: [],
          fieldProvenance: null,
        } satisfies MissionControlSnapshot
      }
      return makeSnapshot(leagueId)
    })

    const snapshot = await resolvePlatformOsSnapshot(['L1', 'L-unavailable'], NOW)

    expect(snapshot.unavailableLeagueCount).toBe(1)
    expect(snapshot.healthyLeagueCount).toBe(1)
    expect(snapshot.trendCoverage.unavailable).toBe(1)
  })

  it('an empty league list degrades honestly to an all-zero snapshot with a reason', async () => {
    const snapshot = await resolvePlatformOsSnapshot([], NOW)

    expect(snapshot).toEqual({
      generatedAt: NOW.toISOString(),
      totalMonitoredLeagues: 0,
      healthyLeagueCount: 0,
      atRiskLeagueCount: 0,
      unavailableLeagueCount: 0,
      totalActiveManagers: 0,
      totalInactiveManagers: 0,
      totalTrades: 0,
      totalWaiverClaims: 0,
      totalDraftPicks: 0,
      totalRosterActivity: 0,
      totalRetentionRiskManagers: 0,
      attentionQueue: [],
      trendCoverage: { available: 0, noSnapshots: 0, insufficientHistory: 0, unavailable: 0 },
      provenance: { source: 'commissioner_os_composition', requestedLeagueCount: 0, resolvedLeagueCount: 0, unavailableLeagueCount: 0 },
      warnings: ['no_leagues_specified'],
    })
    expect(mockResolve()).not.toHaveBeenCalled()
  })

  it('tallies trend coverage correctly across available/no_snapshots/insufficient_history leagues', async () => {
    setDefaults()
    mockResolve().mockImplementation(async (leagueId: string) => {
      if (leagueId === 'L-available') {
        return makeSnapshot(leagueId, {
          trend: { available: true, periodsTracked: 3, earliestPeriodKey: '2026-07-06', latestPeriodKey: '2026-07-08', latestEventCount: 5, latestManagerCount: 10, eventCountDelta: 2, direction: 'increasing' },
        })
      }
      if (leagueId === 'L-insufficient') {
        return makeSnapshot(leagueId, { trend: { available: false, reason: 'insufficient_history' } })
      }
      return makeSnapshot(leagueId, { trend: { available: false, reason: 'no_snapshots' } })
    })

    const snapshot = await resolvePlatformOsSnapshot(['L-available', 'L-insufficient', 'L-none'], NOW)

    expect(snapshot.trendCoverage).toEqual({ available: 1, noSnapshots: 1, insufficientHistory: 1, unavailable: 0 })
  })

  it('builds the attention queue from real DecisionOsAttentionSignals, including standard-priority review signals the old interventionQueue never showed', async () => {
    setDefaults()
    mockResolve().mockImplementation(async (leagueId: string) => {
      if (leagueId === 'L-urgent') {
        return makeSnapshot(leagueId, {
          recommendedActions: [{ priority: 'urgent', message: 'ALERT: 30%+ of managers inactive.' }],
        })
      }
      if (leagueId === 'L-standard') {
        return makeSnapshot(leagueId, {
          recommendedActions: [{ priority: 'standard', message: 'Post a weekly recap.' }],
        })
      }
      return makeSnapshot(leagueId) // L-quiet: no recommendedActions, no signals
    })

    const snapshot = await resolvePlatformOsSnapshot(['L-urgent', 'L-standard', 'L-quiet'], NOW)

    expect(snapshot.attentionQueue).toHaveLength(2)
    // Sorted highest-severity first: the urgent (high) review comes before the standard (medium) one.
    expect(snapshot.attentionQueue[0]).toMatchObject({
      leagueId: 'L-urgent',
      type: 'league_requires_review',
      severity: 'high',
      explanation: 'ALERT: 30%+ of managers inactive.',
    })
    expect(snapshot.attentionQueue[1]).toMatchObject({
      leagueId: 'L-standard',
      type: 'league_requires_review',
      severity: 'medium',
      explanation: 'Post a weekly recap.',
    })
  })

  it('derives a league_context_incomplete signal when financial status is UNKNOWN (a real signal type absent from the old interventionQueue)', async () => {
    mockDraftDates().mockResolvedValue(new Map())
    mockFinancialContext().mockResolvedValue({ ...FREE_CONTEXT, financialStatus: 'UNKNOWN' })
    mockResolve().mockResolvedValue(makeSnapshot('L1'))

    const snapshot = await resolvePlatformOsSnapshot(['L1'], NOW)

    expect(snapshot.attentionQueue.some((s) => s.type === 'league_context_incomplete')).toBe(true)
  })

  it('still derives attention signals for a league whose Mission Control health is unavailable', async () => {
    mockFinancialContext().mockResolvedValue({ ...FREE_CONTEXT, financialStatus: 'UNKNOWN' })
    mockDraftDates().mockResolvedValue(new Map())
    mockResolve().mockResolvedValue({
      leagueId: 'L1',
      generatedAt: NOW.toISOString(),
      leagueHealth: { available: false, reason: 'league_health_unavailable' },
      trend: { available: false, reason: 'no_snapshots' },
      managerCounts: { activeManagers: 0, inactiveManagers: 0 },
      activity: { tradeCount: 0, waiverClaimCount: 0, draftPickCount: 0, rosterActivityCount: 0 },
      managersAtRetentionRisk: [],
      recommendedActions: [],
      fieldProvenance: null,
    } satisfies MissionControlSnapshot)

    const snapshot = await resolvePlatformOsSnapshot(['L1'], NOW)

    expect(snapshot.unavailableLeagueCount).toBe(1)
    expect(snapshot.attentionQueue.some((s) => s.type === 'league_context_incomplete')).toBe(true)
  })

  it('counts stay honestly zero for a quiet league with no activity', async () => {
    setDefaults()
    mockResolve().mockImplementation(async (leagueId: string) =>
      makeSnapshot(leagueId, {
        managerCounts: { activeManagers: 0, inactiveManagers: 0 },
        activity: { tradeCount: 0, waiverClaimCount: 0, draftPickCount: 0, rosterActivityCount: 0 },
      }),
    )

    const snapshot = await resolvePlatformOsSnapshot(['L-quiet'], NOW)

    expect(snapshot.totalActiveManagers).toBe(0)
    expect(snapshot.totalTrades).toBe(0)
    expect(snapshot.totalRetentionRiskManagers).toBe(0)
    expect(snapshot.attentionQueue).toEqual([])
  })
})
