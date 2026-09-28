import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getLeagueRole,
  isSurvivorLeague,
  getSurvivorConfig,
  getTribesWithMembers,
  getCouncil,
  getJuryMembers,
  getExileLeagueId,
  resolveSurvivorCurrentWeek,
  isMergeTriggered,
  getSurvivorAuditLog,
  getCurrentlyEliminatedRosterIds,
  resolveSnapshot,
  resolveForUser,
  resolveAfPlanFromEntitlement,
  resolveSurvivorAccessContext,
  prisma,
} = vi.hoisted(() => ({
  getLeagueRole: vi.fn(),
  isSurvivorLeague: vi.fn(),
  getSurvivorConfig: vi.fn(),
  getTribesWithMembers: vi.fn(),
  getCouncil: vi.fn(),
  getJuryMembers: vi.fn(),
  getExileLeagueId: vi.fn(),
  resolveSurvivorCurrentWeek: vi.fn(),
  isMergeTriggered: vi.fn(),
  getSurvivorAuditLog: vi.fn(),
  getCurrentlyEliminatedRosterIds: vi.fn(),
  resolveSnapshot: vi.fn(),
  resolveForUser: vi.fn(),
  resolveAfPlanFromEntitlement: vi.fn(),
  resolveSurvivorAccessContext: vi.fn(),
  prisma: {
    league: { findUnique: vi.fn() },
    draftSession: { findFirst(...a: unknown[]) { return (this as any).findUnique(...a) }, findUnique: vi.fn() },
    survivorGameState: { findUnique: vi.fn() },
    roster: { count: vi.fn() },
    survivorChatChannel: { count: vi.fn() },
  },
}))

vi.mock('@/lib/league/permissions', () => ({
  getLeagueRole,
}))

vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({
  isSurvivorLeague,
  getSurvivorConfig,
}))

vi.mock('@/lib/survivor/SurvivorTribeService', () => ({
  getTribesWithMembers,
}))

vi.mock('@/lib/survivor/SurvivorTribalCouncilService', () => ({
  getCouncil,
}))

vi.mock('@/lib/survivor/SurvivorJuryEngine', () => ({
  getJuryMembers,
}))

vi.mock('@/lib/survivor/SurvivorExileEngine', () => ({
  getExileLeagueId,
}))

vi.mock('@/lib/survivor/SurvivorTimelineResolver', () => ({
  resolveSurvivorCurrentWeek,
}))

vi.mock('@/lib/survivor/SurvivorMergeEngine', () => ({
  isMergeTriggered,
}))

vi.mock('@/lib/survivor/SurvivorAuditLog', () => ({
  getSurvivorAuditLog,
}))

vi.mock('@/lib/survivor/SurvivorRosterState', () => ({
  getCurrentlyEliminatedRosterIds,
}))

vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveSnapshot = resolveSnapshot
  },
}))

vi.mock('@/lib/tokens/TokenBalanceResolver', () => ({
  TokenBalanceResolver: class {
    resolveForUser = resolveForUser
  },
}))

vi.mock('@/lib/tournament/resolve-af-plan-from-subscription', () => ({
  resolveAfPlanFromEntitlement,
}))

vi.mock('@/lib/survivor/survivorAccessControl', () => ({
  resolveSurvivorAccessContext,
}))

vi.mock('@/lib/prisma', () => ({ prisma }))

import { buildSurvivorCommissionerDashboard } from '@/lib/survivor/buildSurvivorCommissionerDashboard'

describe('survivor commissioner dashboard payload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getLeagueRole.mockResolvedValue('commissioner')
    resolveSurvivorAccessContext.mockResolvedValue({
      isLeagueMember: true,
      settings: { commissionerParticipationMode: 'non_participating_host' },
      isParticipatingCommissioner: false,
      decisions: {
        canSeeHiddenIdolAssignments: true,
        canSeePrivateVotes: true,
        canSeeVoteTallyBeforeReveal: true,
      },
      privacyWarnings: [],
    })
    isSurvivorLeague.mockResolvedValue(true)
    getSurvivorConfig.mockResolvedValue({ configId: 'cfg-1', leagueId: 'league-1' })
    prisma.league.findUnique.mockResolvedValue({
      id: 'league-1',
      name: 'Island Test',
      sport: 'NFL',
      leagueSize: 12,
      leagueVariant: 'survivor',
    })
    resolveSurvivorCurrentWeek.mockResolvedValue(3)
    getTribesWithMembers.mockResolvedValue([
      { id: 'tribe-1', name: '🔥 Fire Tribe', members: [] },
      { id: 'tribe-2', name: 'Water Tribe', members: [] },
    ])
    getCouncil.mockResolvedValue(null)
    getJuryMembers.mockResolvedValue([{ id: 'jury-1' }])
    isMergeTriggered.mockResolvedValue(false)
    getExileLeagueId.mockResolvedValue(null)
    prisma.draftSession.findUnique.mockResolvedValue({ id: 'draft-1' })
    prisma.survivorGameState.findUnique.mockResolvedValue({
      phase: 'tribal',
      currentWeek: 3,
      activeTribeCount: 2,
      activePlayerCount: 10,
      exilePlayerCount: 1,
      juryPlayerCount: 1,
      immuneTribeId: null,
      immunePlayerId: null,
      tribalDeadline: new Date('2026-04-20T12:00:00.000Z'),
    })
    prisma.roster.count.mockResolvedValue(12)
    prisma.survivorChatChannel.count.mockResolvedValue(3)
    getSurvivorAuditLog.mockResolvedValue([])
    resolveSnapshot.mockResolvedValue({ plans: ['pro'], status: 'active' })
    resolveForUser.mockResolvedValue({ balance: 42 })
    resolveAfPlanFromEntitlement.mockReturnValue('pro')
    getCurrentlyEliminatedRosterIds.mockResolvedValue(new Set(['roster-x']))
  })

  it('rejects non-commissioners', async () => {
    getLeagueRole.mockResolvedValue('member')
    const result = await buildSurvivorCommissionerDashboard('league-1', 'user-1', 'u@example.com')
    expect(result).toEqual({
      ok: false,
      error: 'Commissioner or co-commissioner access required',
      status: 403,
    })
  })

  it('enriches tribes with extracted emoji and returns shell metadata', async () => {
    const result = await buildSurvivorCommissionerDashboard('league-1', 'user-1', 'u@example.com')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tribes).toEqual([
      expect.objectContaining({ id: 'tribe-1', emoji: '🔥' }),
      expect.objectContaining({ id: 'tribe-2', emoji: null }),
    ])
    expect(result.shell).toEqual({
      draftSessionExists: true,
      survivorChatChannels: 3,
      exileLeagueLinked: false,
    })
    expect(result.monetization).toEqual({
      afPlan: 'pro',
      afTokensRemaining: 42,
      subscriptionStatus: 'active',
    })
    expect(result.eliminatedCount).toBe(1)
    expect(result.gameState).toEqual(
      expect.objectContaining({
        phase: 'tribal',
        currentWeek: 3,
        tribalDeadline: '2026-04-20T12:00:00.000Z',
      }),
    )
    expect(result.privacy).toEqual({
      commissionerParticipationMode: 'non_participating_host',
      blindModeActive: false,
      canSeeHiddenIdolAssignments: true,
      canSeePrivateVotes: true,
      canSeeVoteTallyBeforeReveal: true,
      warnings: [],
    })
  })

  it('returns 404 when survivor config is missing after the league checks pass', async () => {
    getSurvivorConfig.mockResolvedValue(null)
    const result = await buildSurvivorCommissionerDashboard('league-1', 'user-1', 'u@example.com')
    expect(result).toEqual({
      ok: false,
      error: 'Survivor config missing',
      status: 404,
    })
  })
})
