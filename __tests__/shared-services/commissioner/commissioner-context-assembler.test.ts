import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockLeagueFindUnique,
  mockGetLeagueRole,
  mockResolveMissionControlSnapshot,
  mockResolveLeagueAnalyticsSnapshot,
  mockBuildLeagueGameDayContext,
  mockComputeLineupAttention,
  mockGetManagerBehaviorProfile,
} = vi.hoisted(() => ({
  mockLeagueFindUnique: vi.fn(),
  mockGetLeagueRole: vi.fn(),
  mockResolveMissionControlSnapshot: vi.fn(),
  mockResolveLeagueAnalyticsSnapshot: vi.fn(),
  mockBuildLeagueGameDayContext: vi.fn(),
  mockComputeLineupAttention: vi.fn(),
  mockGetManagerBehaviorProfile: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: mockLeagueFindUnique } } }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: mockGetLeagueRole }))
vi.mock('@/lib/decision-os/missionControl', () => ({ resolveMissionControlSnapshot: mockResolveMissionControlSnapshot }))
vi.mock('@/lib/decision-os/leagueAnalytics', () => ({ resolveLeagueAnalyticsSnapshot: mockResolveLeagueAnalyticsSnapshot }))
vi.mock('@/lib/shared-services/game-day/GameDayContextAssembler', () => ({ buildLeagueGameDayContext: mockBuildLeagueGameDayContext }))
vi.mock('@/lib/shared-services/game-day/LineupAttentionService', () => ({ computeLineupAttention: mockComputeLineupAttention }))
vi.mock('@/lib/shared-services/knowledge-graph/QueryService', () => ({ getManagerBehaviorProfile: mockGetManagerBehaviorProfile }))

import { buildCommissionerContext } from '@/lib/shared-services/commissioner/CommissionerContextAssembler'

const UNAVAILABLE_HEALTH = { available: false, reason: 'league_health_unavailable' } as const
const EMPTY_MISSION_CONTROL = {
  leagueId: 'league-1',
  generatedAt: '2026-01-01T00:00:00.000Z',
  leagueHealth: UNAVAILABLE_HEALTH,
  trend: { available: false, reason: 'no_snapshots' },
  managerCounts: { activeManagers: 0, inactiveManagers: 0 },
  activity: { tradeCount: 0, waiverClaimCount: 0, draftPickCount: 0, rosterActivityCount: 0 },
  managersAtRetentionRisk: [],
  recommendedActions: [],
  fieldProvenance: null,
}
const EMPTY_LEAGUE_ANALYTICS = { leagueId: 'league-1', generatedAt: '2026-01-01T00:00:00.000Z', available: false, reason: 'unavailable' }

describe('buildCommissionerContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLeagueFindUnique.mockResolvedValue({ leagueVariant: null, isDynasty: false })
    mockGetLeagueRole.mockResolvedValue('commissioner')
    mockResolveMissionControlSnapshot.mockResolvedValue(EMPTY_MISSION_CONTROL)
    mockResolveLeagueAnalyticsSnapshot.mockResolvedValue(EMPTY_LEAGUE_ANALYTICS)
  })

  it('assembles a real context composing Mission Control + League Analytics + role', async () => {
    const ctx = await buildCommissionerContext({ leagueId: 'league-1', requestingUserId: 'user-1' })

    expect(mockResolveMissionControlSnapshot).toHaveBeenCalledWith('league-1')
    expect(mockResolveLeagueAnalyticsSnapshot).toHaveBeenCalledWith('league-1')
    expect(mockGetLeagueRole).toHaveBeenCalledWith('league-1', 'user-1')
    expect(ctx.requestingUserRole).toBe('commissioner')
    expect(ctx.missionControl).toBe(EMPTY_MISSION_CONTROL)
    expect(ctx.leagueAnalytics).toBe(EMPTY_LEAGUE_ANALYTICS)
    expect(ctx.gameDayAttentionItems).toBeNull()
    expect(ctx.managerTendencies).toEqual({})
  })

  it('marks best-ball/keeper leagues as requiring a specialty adapter, honestly, without calling a known stub', async () => {
    mockLeagueFindUnique.mockResolvedValue({ leagueVariant: 'best_ball', isDynasty: false })
    const ctx = await buildCommissionerContext({ leagueId: 'league-1', requestingUserId: 'user-1' })
    expect(ctx.formatAwareness.powerRankingSupport).toBe('specialty_adapter_required')
    expect(ctx.formatAwareness.reason).toContain('preview-only stub')
  })

  it('marks a standard redraft/dynasty league as supported', async () => {
    mockLeagueFindUnique.mockResolvedValue({ leagueVariant: 'redraft', isDynasty: true })
    const ctx = await buildCommissionerContext({ leagueId: 'league-1', requestingUserId: 'user-1' })
    expect(ctx.formatAwareness).toEqual({ leagueVariant: 'redraft', isDynasty: true, powerRankingSupport: 'supported', reason: null })
  })

  it('enriches with Game Day lineup attention only when a viewerUserId is supplied', async () => {
    mockBuildLeagueGameDayContext.mockResolvedValue({ leagueId: 'league-1' })
    mockComputeLineupAttention.mockResolvedValue({ items: [{ reasonCode: 'starter_ruled_out' }], legacyActions: [] })

    const ctx = await buildCommissionerContext({ leagueId: 'league-1', requestingUserId: 'user-1', viewerUserId: 'user-1' })

    expect(mockBuildLeagueGameDayContext).toHaveBeenCalledWith({ leagueId: 'league-1', viewerUserId: 'user-1' })
    expect(ctx.gameDayAttentionItems).toHaveLength(1)
  })

  it('degrades Game Day enrichment honestly (null, not a crash) when the Game Day assembler fails', async () => {
    mockBuildLeagueGameDayContext.mockRejectedValue(new Error('League not found'))
    const ctx = await buildCommissionerContext({ leagueId: 'league-1', requestingUserId: 'user-1', viewerUserId: 'user-1' })
    expect(ctx.gameDayAttentionItems).toBeNull()
  })

  it('resolves manager tendencies for managers Mission Control already flagged at retention risk', async () => {
    mockResolveMissionControlSnapshot.mockResolvedValue({
      ...EMPTY_MISSION_CONTROL,
      leagueHealth: {
        available: true,
        result: { decisionOs: { managersAtRetentionRisk: [{ managerId: 'manager-1', retentionRisk: 'high', retentionRiskReasons: [], isInactive: false }] } },
      },
    })
    mockGetManagerBehaviorProfile.mockResolvedValue({ status: 'gated', reason: 'insufficient cohort' })

    const ctx = await buildCommissionerContext({ leagueId: 'league-1', requestingUserId: 'user-1' })

    expect(mockGetManagerBehaviorProfile).toHaveBeenCalledWith('manager-1')
    expect(ctx.managerTendencies['manager-1']).toEqual({ status: 'gated', reason: 'insufficient cohort', profile: null })
  })

  it('never lets a Knowledge Graph failure crash the whole context — reports unavailable for that manager', async () => {
    mockResolveMissionControlSnapshot.mockResolvedValue({
      ...EMPTY_MISSION_CONTROL,
      leagueHealth: {
        available: true,
        result: { decisionOs: { managersAtRetentionRisk: [{ managerId: 'manager-1', retentionRisk: 'high', retentionRiskReasons: [], isInactive: false }] } },
      },
    })
    mockGetManagerBehaviorProfile.mockRejectedValue(new Error('KG store unreachable'))

    const ctx = await buildCommissionerContext({ leagueId: 'league-1', requestingUserId: 'user-1' })

    expect(ctx.managerTendencies['manager-1'].status).toBe('unavailable')
    expect(ctx.managerTendencies['manager-1'].reason).toContain('KG store unreachable')
  })
})
