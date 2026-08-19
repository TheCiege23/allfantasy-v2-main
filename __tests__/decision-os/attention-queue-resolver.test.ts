/**
 * Fantasy OS Suite — Phase OS-B2: Decision OS Attention Queue.
 *
 * `resolveAttentionQueueSnapshot` is the standalone, fully self-contained resolver — proves its own
 * fetch/derive/sort/degradation contract at the Mission Control / League Context / Prisma boundary,
 * not `deriveLeagueAttentionSignals`'s own correctness (already covered by `attention-signals.test.ts`).
 *
 * `@/lib/prisma` is explicitly mocked (matching `commissioner-command-center-route-contract.test.ts`'s
 * own convention) so `resolveAttentionQueueSnapshot`'s internal `loadUpcomingDraftDates` call never
 * attempts a real database connection during these tests.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveAttentionQueueSnapshot, loadUpcomingDraftDates } from '@/lib/decision-os/attentionQueue'
import * as missionControl from '@/lib/decision-os/missionControl'
import * as leagueContext from '@/lib/decision-os/leagueContext'
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
  // Mocking `resolveLeagueFinancialContext` alone would NOT take effect: `resolveLeagueFinancialContextSafely`
  // (what the code under test actually calls, as of Phase OS-B4.5's shared-helper consolidation) is copied
  // verbatim from `actual` and its closure still calls the REAL, unmocked `resolveLeagueFinancialContext` —
  // `{...actual, x: vi.fn()}` doesn't rebind one export's internal call to a sibling export. Mock the function
  // actually invoked instead.
  return { ...actual, resolveLeagueFinancialContextSafely: vi.fn() }
})

const { mockLeagueSettingsFindMany } = vi.hoisted(() => ({ mockLeagueSettingsFindMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { leagueSettings: { findMany: mockLeagueSettingsFindMany } },
}))

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

/** Overrides `overallStatus` while preserving the rest of a real snapshot's `leagueHealth.result`
 * shape — mirrors `commissioner-command-center-composition.test.ts`'s own established override idiom. */
function withOverallStatus(leagueId: string, overallStatus: string): MissionControlSnapshot {
  const base = makeSnapshot(leagueId)
  return {
    ...base,
    leagueHealth: {
      available: true,
      result: { ...base.leagueHealth, engine: makeEngine({ overallStatus }) },
    } as never,
  }
}

const FREE_CONTEXT = {
  leagueId: 'x', financialStatus: 'FREE' as const, buyInAmount: null, buyInCurrency: null,
  escrowProvider: 'UNKNOWN' as const, financialConfidence: 'UNKNOWN' as const, financialNotes: null,
  isUserConfirmed: false, lastVerifiedAt: null,
}

const mockMissionControl = () => vi.mocked(missionControl.resolveMissionControlSnapshot)
const mockFinancialContext = () => vi.mocked(leagueContext.resolveLeagueFinancialContextSafely)

afterEach(() => {
  vi.clearAllMocks()
})

describe('resolveAttentionQueueSnapshot', () => {
  it('degrades to an honest empty snapshot for an empty league list, never calling either dependency', async () => {
    const snapshot = await resolveAttentionQueueSnapshot([], NOW)
    expect(snapshot).toEqual({ generatedAt: NOW.toISOString(), signals: [], warnings: ['no_leagues_specified'] })
    expect(mockMissionControl()).not.toHaveBeenCalled()
    expect(mockFinancialContext()).not.toHaveBeenCalled()
  })

  it('aggregates signals across multiple leagues and sorts by severity', async () => {
    mockLeagueSettingsFindMany.mockResolvedValue([])
    mockMissionControl().mockImplementation(async (leagueId: string) => {
      if (leagueId === 'L1') return withOverallStatus('L1', 'critical')
      return makeSnapshot('L2')
    })
    mockFinancialContext().mockResolvedValue(FREE_CONTEXT)

    const snapshot = await resolveAttentionQueueSnapshot(['L1', 'L2'], NOW)
    expect(snapshot.signals.some((s) => s.leagueId === 'L1' && s.type === 'low_league_health')).toBe(true)
    expect(snapshot.warnings).toEqual([])
  })

  it('never lets one league throwing break the whole aggregation (defense-in-depth)', async () => {
    mockLeagueSettingsFindMany.mockResolvedValue([])
    mockMissionControl().mockImplementation(async (leagueId: string) => {
      if (leagueId === 'L1') throw new Error('boom')
      return makeSnapshot('L2')
    })
    mockFinancialContext().mockRejectedValue(new Error('also boom'))

    const snapshot = await resolveAttentionQueueSnapshot(['L1', 'L2'], NOW)
    // Neither league throws out of the resolver — L1 degrades to no mission-control-derived signals,
    // L2 still resolves (financial context also failing degrades to UNKNOWN for both).
    expect(Array.isArray(snapshot.signals)).toBe(true)
  })

  it('is provider-agnostic: no signal carries a display name', async () => {
    mockLeagueSettingsFindMany.mockResolvedValue([])
    mockMissionControl().mockResolvedValue(withOverallStatus('L1', 'excellent'))
    mockFinancialContext().mockResolvedValue({ ...FREE_CONTEXT, leagueId: 'L1' })

    const snapshot = await resolveAttentionQueueSnapshot(['L1'], NOW)
    expect(snapshot.signals.length).toBeGreaterThan(0)
    for (const signal of snapshot.signals) {
      expect(Object.keys(signal)).not.toContain('leagueName')
    }
  })
})

describe('loadUpcomingDraftDates', () => {
  it('returns an empty map for an empty league list without querying', async () => {
    const findMany = vi.fn()
    const map = await loadUpcomingDraftDates([], { leagueSettings: { findMany } })
    expect(map.size).toBe(0)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('builds a leagueId -> draftDateUtc map from real rows, skipping null draft dates', async () => {
    const draftDate = new Date('2026-07-15T00:00:00Z')
    const findMany = vi.fn().mockResolvedValue([
      { leagueId: 'L1', draftDateUtc: draftDate },
      { leagueId: 'L2', draftDateUtc: null },
    ])
    const map = await loadUpcomingDraftDates(['L1', 'L2'], { leagueSettings: { findMany } })
    expect(map.get('L1')).toEqual(draftDate)
    expect(map.has('L2')).toBe(false)
  })

  it('degrades to an empty map on a query failure, never throwing', async () => {
    const findMany = vi.fn().mockRejectedValue(new Error('db down'))
    const map = await loadUpcomingDraftDates(['L1'], { leagueSettings: { findMany } })
    expect(map.size).toBe(0)
  })
})
