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
    leagueTeam: { count: vi.fn() },
    redraftTradeProposal: { count: vi.fn() },
    exileIsland: { findUnique: vi.fn() },
    survivorChallenge: { count: vi.fn() },
    survivorIdol: { findMany: vi.fn() },
    survivorPlayer: { findMany: vi.fn() },
    adpDataRecord: { count: vi.fn() },
  },
}))

vi.mock('@/lib/survivor/survivorTribeRedraw', () => ({ getTribeRedrawStatus: vi.fn(async () => ({ status: 'none', recommendedWeek: null })) }))
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
      settings: { commissionerParticipationMode: 'non_participating_host', exileIslandEnabled: false, idolCount: 7, mergeTriggerType: 'active_player_count' },
      isParticipatingCommissioner: false,
      isNonParticipatingCommissionerHost: true,
      decisions: {
        canSeeHiddenIdolAssignments: true,
        canSeePrivateVotes: true,
        canSeeVoteTallyBeforeReveal: true,
      },
      privacyWarnings: [],
    })
    isSurvivorLeague.mockResolvedValue(true)
    getSurvivorConfig.mockResolvedValue({ configId: 'cfg-1', leagueId: 'league-1', exileReturnEnabled: false, idolCount: 7, mergeTrigger: 'player_count' })
    prisma.league.findUnique.mockResolvedValue({
      id: 'league-1',
      name: 'Island Test',
      sport: 'NFL',
      leagueSize: 12,
      leagueVariant: 'survivor',
      waiverType: 'faab',
      settings: { waiverSettings: { waiverType: 'faab' } },
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
    prisma.draftSession.findUnique.mockResolvedValue({ id: 'draft-1', status: 'pre_draft', rounds: 12, teamCount: 12, timerSeconds: 90, _count: { picks: 0 } })
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
    prisma.leagueTeam.count.mockResolvedValue(1)
    prisma.redraftTradeProposal.count.mockResolvedValue(0)
    prisma.exileIsland.findUnique.mockResolvedValue({ isActive: false })
    prisma.survivorChallenge.count.mockResolvedValue(0)
    prisma.survivorIdol.findMany.mockResolvedValue([])
    prisma.survivorPlayer.findMany.mockResolvedValue([])
    prisma.adpDataRecord.count.mockResolvedValue(0)
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
    expect(result.operations).toEqual({
      claimedManagers: 1,
      draft: { status: 'pre_draft', picksMade: 0, totalPicks: 144, timerSeconds: 90 },
      pendingTrades: 0,
      completedTrades: 0,
      exileActive: false,
      activeChallenges: 0,
      automationNeedsAttention: false,
      readinessIssues: ['11 manager seats still need to be claimed.'],
      tribeRedraw: { status: 'none', recommendedWeek: null },
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
  it('shows a non-playing host private ballots and active idol holders only', async () => {
    getCouncil.mockResolvedValue({
      id: 'council-1', status: 'voting_open', isRevealed: false,
      votes: [{ voterName: 'Alex', targetName: 'Sam', submittedAt: new Date('2026-04-20T10:00:00Z'), doesNotCount: false }],
    })
    prisma.survivorIdol.findMany.mockResolvedValue([{ id: 'idol-1', currentOwnerUserId: 'owner-1', powerLabel: 'Vote Shield', powerType: 'vote_shield' }])
    prisma.survivorPlayer.findMany.mockResolvedValue([{ userId: 'owner-1', displayName: 'Jordan' }])

    const result = await buildSurvivorCommissionerDashboard('league-1', 'host-1', null)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.privateBallots).toEqual([{ voterName: 'Alex', targetName: 'Sam', submittedAt: '2026-04-20T10:00:00.000Z', doesNotCount: false }])
    expect(result.privateIdols).toEqual([{ id: 'idol-1', ownerName: 'Jordan', powerLabel: 'Vote Shield' }])
    expect(result.council?.votes).toEqual([])
  })
  it('flags a pre-draft NBA league whose ADP import has not populated', async () => {
    prisma.league.findUnique.mockResolvedValue({
      id: 'league-1', name: 'NBA Survivor', sport: 'NBA', leagueSize: 12,
      leagueVariant: 'survivor', waiverType: 'faab',
      settings: { waiverSettings: { waiverType: 'faab' }, survivor_full_season_plan: { season: 2026 } },
    })

    const result = await buildSurvivorCommissionerDashboard('league-1', 'host-1', null)

    expect(prisma.adpDataRecord.count).toHaveBeenCalledWith({ where: { sport: 'NBA', season: 2026 } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.operations.readinessIssues).toContain('NBA ADP is unavailable. Verify the player pool and autopick order before starting the draft.')
  })
  it('does not fetch unclassified audit metadata or expose a tallied ballot', async () => {
    getLeagueRole.mockResolvedValue('commissioner')
    isSurvivorLeague.mockResolvedValue(true)
    resolveSurvivorAccessContext.mockResolvedValue({ isLeagueMember: true, isParticipatingCommissioner: true, settings: { commissionerParticipationMode: 'participating_player' }, decisions: { canSeeHiddenIdolAssignments: false, canSeePrivateVotes: false, canSeeVoteTallyBeforeReveal: false }, privacyWarnings: [] })
    getCouncil.mockResolvedValue({ id: 'secret-council', status: 'closed', isRevealed: false, eliminatedRosterId: 'SECRET_MANAGER', votes: [{ targetRosterId: 'SECRET_MANAGER' }], revealSequence: [{ targetName: 'SECRET_MANAGER' }], auditLog: { seed: 77 } })
    getSurvivorAuditLog.mockClear()
    const result = await buildSurvivorCommissionerDashboard('league-1', 'playing-commish', null)
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).not.toContain('SECRET_MANAGER')
    expect(getSurvivorAuditLog).not.toHaveBeenCalled()
    expect(prisma.survivorIdol.findMany).not.toHaveBeenCalled()
    if (result.ok) expect(result.privacy.blindModeActive).toBe(true)
  })
})
