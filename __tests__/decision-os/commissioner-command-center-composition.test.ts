/**
 * Fantasy OS Suite — Phase OS-B1/OS-B2: Commissioner Multi-League Command Center.
 *
 * `resolveCommissionerCommandCenterSnapshot` is pure composition over the already-tested
 * `resolveMissionControlSnapshot`, mirroring `platform-os.test.ts`'s own mocking convention exactly
 * (same boundary mocked, same fixture-building helpers). Proves ONLY this composition's own
 * aggregation/ranking/degradation contract — not Mission Control's own correctness, and not the
 * attention-signal severity rules themselves (see `attention-signals.test.ts` for those).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveCommissionerCommandCenterSnapshot } from '@/lib/decision-os/commissionerCommandCenter'
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
  // Mock `resolveLeagueFinancialContextSafely` — the function `commissionerCommandCenter.ts` actually
  // calls as of Phase OS-B4.5's shared-helper consolidation. Mocking `resolveLeagueFinancialContext`
  // alone would NOT take effect: `resolveLeagueFinancialContextSafely` is copied verbatim from `actual`
  // and its closure still calls the REAL, unmocked inner function — `{...actual, x: vi.fn()}` doesn't
  // rebind one export's internal call to a sibling export in the same module.
  return { ...actual, resolveLeagueFinancialContextSafely: vi.fn() }
})

vi.mock('@/lib/decision-os/attentionQueue', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/attentionQueue')>(
    '@/lib/decision-os/attentionQueue',
  )
  return { ...actual, loadUpcomingDraftDates: vi.fn() }
})

const NOW = new Date('2026-07-09T12:00:00Z')

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

afterEach(() => {
  vi.clearAllMocks()
})

describe('resolveCommissionerCommandCenterSnapshot', () => {
  function setDefaults() {
    mockFinancialContext().mockResolvedValue(FREE_CONTEXT)
    mockDraftDates().mockResolvedValue(new Map())
  }

  it('degrades to an honest all-zero snapshot for an empty league list, never calling the composition', async () => {
    const snapshot = await resolveCommissionerCommandCenterSnapshot([], NOW)
    expect(snapshot).toMatchObject({
      totalLeagues: 0,
      healthyLeagueCount: 0,
      atRiskLeagueCount: 0,
      unavailableLeagueCount: 0,
      leagueSummaries: [],
      attentionQueue: [],
      recentChanges: [],
      warnings: ['no_leagues_specified'],
    })
    expect(mockResolve()).not.toHaveBeenCalled()
  })

  it('aggregates multiple leagues correctly: counts, health split, retention risk', async () => {
    setDefaults()
    mockResolve().mockImplementation(async (leagueId: string) => {
      if (leagueId === 'L1') {
        return makeSnapshot('L1', {
          managerCounts: { activeManagers: 10, inactiveManagers: 2 },
          managersAtRetentionRisk: [
            { managerId: 'm1', retentionRisk: 'high', retentionRiskReasons: ['inactive'], isInactive: false },
          ],
        })
      }
      return makeSnapshot('L2', {
        leagueHealth: { available: true, result: { ...makeSnapshot('L2').leagueHealth, engine: makeEngine({ overallStatus: 'at_risk' }) } as never },
        managerCounts: { activeManagers: 8, inactiveManagers: 0 },
      })
    })

    const snapshot = await resolveCommissionerCommandCenterSnapshot(['L1', 'L2'], NOW)

    expect(snapshot.totalLeagues).toBe(2)
    expect(snapshot.totalActiveManagers).toBe(18)
    expect(snapshot.totalInactiveManagers).toBe(2)
    expect(snapshot.totalRetentionRiskManagers).toBe(1)
    expect(snapshot.unavailableLeagueCount).toBe(0)
    expect(snapshot.leagueSummaries).toHaveLength(2)
    expect(snapshot.leagueSummaries.map((s) => s.leagueId)).toEqual(['L1', 'L2'])
  })

  it('excludes an unavailable league from ranking data, marking it unavailable rather than zeroing it silently', async () => {
    setDefaults()
    mockResolve().mockImplementation(async (leagueId: string) => {
      if (leagueId === 'L1') return makeSnapshot('L1')
      return { ...makeSnapshot('L2'), leagueHealth: { available: false, reason: 'league_health_unavailable' } } as MissionControlSnapshot
    })

    const snapshot = await resolveCommissionerCommandCenterSnapshot(['L1', 'L2'], NOW)

    expect(snapshot.unavailableLeagueCount).toBe(1)
    const l2 = snapshot.leagueSummaries.find((s) => s.leagueId === 'L2')
    expect(l2?.available).toBe(false)
    expect(l2?.overallStatus).toBeNull()
    expect(l2?.leagueHealthScore).toBeNull()
  })

  it('never lets one league throwing break the whole aggregation (defense-in-depth)', async () => {
    setDefaults()
    mockResolve().mockImplementation(async (leagueId: string) => {
      if (leagueId === 'L1') throw new Error('boom')
      return makeSnapshot('L2')
    })

    const snapshot = await resolveCommissionerCommandCenterSnapshot(['L1', 'L2'], NOW)

    expect(snapshot.unavailableLeagueCount).toBe(1)
    expect(snapshot.leagueSummaries.find((s) => s.leagueId === 'L2')?.available).toBe(true)
  })

  it('ranks the attention queue by severity, deterministically', async () => {
    setDefaults()
    mockResolve().mockImplementation(async (leagueId: string) => {
      if (leagueId === 'L1') {
        return makeSnapshot('L1', {
          recommendedActions: [
            { priority: 'standard', message: 'Standard from L1' },
            { priority: 'urgent', message: 'Urgent from L1' },
          ],
        })
      }
      return makeSnapshot('L2', {
        recommendedActions: [{ priority: 'urgent', message: 'Urgent from L2' }],
      })
    })

    const snapshot = await resolveCommissionerCommandCenterSnapshot(['L1', 'L2'], NOW)

    expect(snapshot.attentionQueue.map((e) => e.severity)).toEqual(['high', 'high', 'medium'])
    expect(snapshot.attentionQueue.map((e) => e.explanation)).toEqual([
      'Urgent from L1',
      'Urgent from L2',
      'Standard from L1',
    ])
  })

  it('only includes leagues with a real, available trend in recentChanges — never invents a delta', async () => {
    setDefaults()
    mockResolve().mockImplementation(async (leagueId: string) => {
      if (leagueId === 'L1') {
        return makeSnapshot('L1', { trend: { available: true, direction: 'increasing', eventCountDelta: 5 } as never })
      }
      return makeSnapshot('L2', { trend: { available: false, reason: 'no_snapshots' } })
    })

    const snapshot = await resolveCommissionerCommandCenterSnapshot(['L1', 'L2'], NOW)

    expect(snapshot.recentChanges).toHaveLength(1)
    expect(snapshot.recentChanges[0]).toMatchObject({ leagueId: 'L1', direction: 'increasing', eventCountDelta: 5 })
  })

  it('returns an honest empty attentionQueue/recentChanges when no leagues have real signals', async () => {
    setDefaults()
    mockResolve().mockImplementation(async (leagueId: string) => makeSnapshot(leagueId))

    const snapshot = await resolveCommissionerCommandCenterSnapshot(['L1'], NOW)

    expect(snapshot.attentionQueue).toEqual([])
    expect(snapshot.recentChanges).toEqual([])
  })

  it('derives a league_context_incomplete signal when financial status is UNKNOWN', async () => {
    mockDraftDates().mockResolvedValue(new Map())
    mockFinancialContext().mockResolvedValue({ ...FREE_CONTEXT, financialStatus: 'UNKNOWN' })
    mockResolve().mockResolvedValue(makeSnapshot('L1'))

    const snapshot = await resolveCommissionerCommandCenterSnapshot(['L1'], NOW)

    expect(snapshot.attentionQueue).toHaveLength(1)
    expect(snapshot.attentionQueue[0]).toMatchObject({ type: 'league_context_incomplete', leagueId: 'L1' })
  })

  it('derives a draft_approaching signal from a real per-league draft date', async () => {
    setDefaults()
    const draftDate = new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000)
    mockDraftDates().mockResolvedValue(new Map([['L1', draftDate]]))
    mockResolve().mockResolvedValue(makeSnapshot('L1'))

    const snapshot = await resolveCommissionerCommandCenterSnapshot(['L1'], NOW)

    expect(snapshot.attentionQueue.some((s) => s.type === 'draft_approaching' && s.leagueId === 'L1')).toBe(true)
  })

  it('still derives context/draft signals for a league whose Mission Control health is unavailable', async () => {
    mockFinancialContext().mockResolvedValue({ ...FREE_CONTEXT, financialStatus: 'UNKNOWN' })
    mockDraftDates().mockResolvedValue(new Map())
    mockResolve().mockResolvedValue({
      ...makeSnapshot('L1'),
      leagueHealth: { available: false, reason: 'league_health_unavailable' },
    } as MissionControlSnapshot)

    const snapshot = await resolveCommissionerCommandCenterSnapshot(['L1'], NOW)

    expect(snapshot.unavailableLeagueCount).toBe(1)
    expect(snapshot.attentionQueue.some((s) => s.type === 'league_context_incomplete')).toBe(true)
  })

  it('caps the attention queue and keeps the highest-severity signals across all leagues, not per-league', async () => {
    setDefaults()
    const manyLeagueIds = Array.from({ length: 25 }, (_, i) => `L${i}`)
    mockResolve().mockImplementation(async (leagueId: string) =>
      makeSnapshot(leagueId, {
        leagueHealth: {
          available: true,
          result: { ...makeSnapshot(leagueId).leagueHealth, engine: makeEngine({ overallStatus: 'critical' }) },
        } as never,
      }),
    )

    const snapshot = await resolveCommissionerCommandCenterSnapshot(manyLeagueIds, NOW)

    expect(snapshot.attentionQueue.length).toBeLessThanOrEqual(20)
    expect(snapshot.attentionQueue.every((s) => s.severity === 'critical')).toBe(true)
  })
})
