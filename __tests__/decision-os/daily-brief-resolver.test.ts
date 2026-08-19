/**
 * Fantasy OS Suite — Phase OS-B3: Daily Brief Composition Engine.
 *
 * `resolveDailyBrief` is the standalone, fully self-contained resolver — proves its own fetch/aggregate
 * contract at the `resolveAttentionQueueSnapshot` / Mission Control boundary, not `composeDailyBrief`'s
 * own correctness (already covered by `daily-brief.test.ts`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDailyBrief } from '@/lib/decision-os/dailyBriefResolver'
import * as missionControl from '@/lib/decision-os/missionControl'
import * as attentionQueue from '@/lib/decision-os/attentionQueue'
import type { MissionControlSnapshot } from '@/lib/decision-os/missionControl'
import type { LeagueHealthResult } from '@/lib/league-health'
import type { DecisionOsLeagueHealthResult } from '@/lib/decision-os/leagueHealthAlignment'
import type { AttentionQueueSnapshot } from '@/lib/decision-os/attentionQueue'
import { SEVERITY_RANK, type DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'

vi.mock('@/lib/decision-os/missionControl', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/missionControl')>(
    '@/lib/decision-os/missionControl',
  )
  return { ...actual, resolveMissionControlSnapshot: vi.fn() }
})

vi.mock('@/lib/decision-os/attentionQueue', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/attentionQueue')>(
    '@/lib/decision-os/attentionQueue',
  )
  return { ...actual, resolveAttentionQueueSnapshot: vi.fn() }
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

function signal(o: Partial<DecisionOsAttentionSignal> & Pick<DecisionOsAttentionSignal, 'id' | 'leagueId' | 'severity' | 'type'>): DecisionOsAttentionSignal {
  return {
    priorityScore: SEVERITY_RANK[o.severity],
    title: 'Title',
    explanation: 'Explanation',
    recommendedAction: null,
    timestamp: NOW.toISOString(),
    source: 'league_health_engine',
    ...o,
  }
}

function emptyAttentionSnapshot(signals: DecisionOsAttentionSignal[] = []): AttentionQueueSnapshot {
  return { generatedAt: NOW.toISOString(), signals, warnings: [] }
}

const mockMissionControl = () => vi.mocked(missionControl.resolveMissionControlSnapshot)
const mockAttentionQueue = () => vi.mocked(attentionQueue.resolveAttentionQueueSnapshot)

afterEach(() => {
  vi.clearAllMocks()
})

describe('resolveDailyBrief', () => {
  it('composes an honest empty brief for an empty league list, never calling either dependency', async () => {
    const brief = await resolveDailyBrief([], NOW)
    expect(brief.isHealthy).toBe(true)
    expect(brief.overview.leaguesMonitored).toBe(0)
    expect(mockMissionControl()).not.toHaveBeenCalled()
    expect(mockAttentionQueue()).not.toHaveBeenCalled()
  })

  it('reuses resolveAttentionQueueSnapshot for signals rather than re-deriving them', async () => {
    const sig = signal({ id: 'a', leagueId: 'L1', severity: 'critical', type: 'low_league_health' })
    mockAttentionQueue().mockResolvedValue(emptyAttentionSnapshot([sig]))
    mockMissionControl().mockResolvedValue(makeSnapshot('L1'))

    const brief = await resolveDailyBrief(['L1'], NOW)
    expect(brief.topPriorityItems).toEqual([sig])
    expect(mockAttentionQueue()).toHaveBeenCalledWith(['L1'], NOW)
  })

  it('derives healthyLeagueCount from a real per-league Mission Control status, not from the attention snapshot', async () => {
    mockAttentionQueue().mockResolvedValue(emptyAttentionSnapshot())
    mockMissionControl().mockImplementation(async (leagueId: string) => {
      if (leagueId === 'L1') return withOverallStatus('L1', 'excellent')
      return withOverallStatus('L2', 'at_risk')
    })

    const brief = await resolveDailyBrief(['L1', 'L2'], NOW)
    expect(brief.overview.healthyLeagueCount).toBe(1)
  })

  it('derives draftsApproachingCount by counting draft_approaching signals, never a separate query', async () => {
    mockAttentionQueue().mockResolvedValue(
      emptyAttentionSnapshot([
        signal({ id: 'd1', leagueId: 'L1', severity: 'high', type: 'draft_approaching' }),
        signal({ id: 'd2', leagueId: 'L2', severity: 'medium', type: 'draft_approaching' }),
        signal({ id: 'r1', leagueId: 'L1', severity: 'low', type: 'league_context_incomplete' }),
      ]),
    )
    mockMissionControl().mockResolvedValue(makeSnapshot('L1'))

    const brief = await resolveDailyBrief(['L1', 'L2'], NOW)
    expect(brief.overview.draftsApproachingCount).toBe(2)
  })

  it('collects real league trends from Mission Control snapshots, excluding unavailable trends', async () => {
    mockAttentionQueue().mockResolvedValue(emptyAttentionSnapshot())
    mockMissionControl().mockImplementation(async (leagueId: string) => {
      if (leagueId === 'L1') return makeSnapshot('L1', { trend: { available: true, direction: 'increasing', eventCountDelta: 5 } as never })
      return makeSnapshot('L2', { trend: { available: false, reason: 'no_snapshots' } })
    })

    const brief = await resolveDailyBrief(['L1', 'L2'], NOW)
    expect(brief.leagueHighlights).toEqual([{ leagueId: 'L1', direction: 'increasing', eventCountDelta: 5 }])
  })

  it('never lets one league throwing break the whole brief (defense-in-depth)', async () => {
    mockAttentionQueue().mockResolvedValue(emptyAttentionSnapshot())
    mockMissionControl().mockImplementation(async (leagueId: string) => {
      if (leagueId === 'L1') throw new Error('boom')
      return makeSnapshot('L2')
    })

    const brief = await resolveDailyBrief(['L1', 'L2'], NOW)
    expect(brief).toBeDefined()
    expect(brief.overview.leaguesMonitored).toBe(2)
  })
})
