import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prisma, resolveSurvivorAccessContext, canSeeSurvivorChannel } = vi.hoisted(() => ({
  prisma: {
    league: { findUnique: vi.fn() },
    survivorGameState: { findUnique: vi.fn() },
    survivorPlayer: { findMany: vi.fn() },
    survivorTribe: { findMany: vi.fn() },
    survivorTribalCouncil: { findFirst: vi.fn(), findUnique: vi.fn() },
    survivorIdol: { findMany: vi.fn(), count: vi.fn() },
    survivorVote: { findUnique: vi.fn(), count: vi.fn() },
    survivorChatChannel: { findMany: vi.fn() },
    survivorChatMessage: { count: vi.fn() },
    survivorAuditEntry: { count: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
  },
  resolveSurvivorAccessContext: vi.fn(),
  canSeeSurvivorChannel: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma }))
vi.mock('@/lib/survivor/survivorAccessControl', () => ({
  resolveSurvivorAccessContext,
  canSeeSurvivorChannel,
}))

import { buildSurvivorStateForUser } from '@/lib/survivor/survivorStateService'

describe('Survivor state sanitizer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.survivorAuditEntry.findFirst.mockResolvedValue(null)
    resolveSurvivorAccessContext.mockResolvedValue({
      leagueId: 'league-1',
      userId: 'commish',
      role: 'commissioner',
      settings: { defaultTeamCount: 20, tribeCount: 4 },
      isLeagueMember: true,
      isLeagueCommissioner: true,
      isCoCommissioner: false,
      isParticipant: true,
      isCommissionerParticipating: true,
      isParticipatingCommissioner: true,
      isNonParticipatingCommissionerHost: false,
      playerState: 'active',
      tribeId: 'tribe-a',
      rosterId: 'roster-a',
      decisions: {
        canSeeHiddenIdolAssignments: false,
        canSeePrivateVotes: false,
        canSeeVoteTallyBeforeReveal: false,
        canSeePrivateUserDm: false,
        canSeeTribeChat: true,
        canSeeExileChat: false,
        canSeeJuryChat: false,
        canPerformAdminAction: true,
        canPerformSensitiveHostAction: false,
        canOverrideVoteDeadline: false,
        canRevealVotes: false,
        canRunChallengeResolution: false,
        canUpdateSettings: true,
      },
      privacyWarnings: ['blind mode'],
    })
    prisma.league.findUnique.mockResolvedValue({
      survivorMode: true,
      survivorPhase: 'pre_merge',
      survivorPlayerCount: 20,
      survivorMergeWeek: 7,
      leagueVariant: 'survivor',
    })
    prisma.survivorGameState.findUnique.mockResolvedValue({
      phase: 'pre_merge',
      currentWeek: 3,
      mergeTriggeredAt: null,
    })
    prisma.survivorPlayer.findMany.mockResolvedValue([
      { userId: 'commish', displayName: 'Host Player', playerState: 'active', tribeId: 'tribe-a', redraftRosterId: 'roster-a' },
      { userId: 'other', displayName: 'Other', playerState: 'active', tribeId: 'tribe-b', redraftRosterId: 'roster-b' },
    ])
    prisma.survivorTribe.findMany.mockResolvedValue([
      { id: 'tribe-a', name: 'A', slotIndex: 0, isActive: true, isMerged: false, members: [{ rosterId: 'roster-a' }] },
      { id: 'tribe-b', name: 'B', slotIndex: 1, isActive: true, isMerged: false, members: [{ rosterId: 'roster-b' }] },
    ])
    prisma.survivorTribalCouncil.findFirst.mockResolvedValue({
      id: 'council-1',
      status: 'voting_open',
      week: 3,
      phase: 'pre_merge',
      attendingTribeId: null,
      isRevealed: false,
      votingOpensAt: null,
      votingDeadline: new Date('2026-09-15T20:00:00.000Z'),
      voteDeadlineAt: new Date('2026-09-15T20:00:00.000Z'),
      closedAt: null,
      idolsPlayed: [],
      doesNotCountVoteIds: [],
      votes: [
        { id: 'vote-1', voterRosterId: 'roster-a', voterUserId: 'commish' },
        { id: 'vote-2', voterRosterId: 'roster-b', voterUserId: 'other' },
      ],
    })
    prisma.survivorTribalCouncil.findUnique.mockResolvedValue({ revealSequence: [], eliminatedName: null, isTie: false, tiePhase: null })
    prisma.survivorVote.findUnique.mockResolvedValue(null)
    prisma.survivorVote.count.mockResolvedValue(0)
    prisma.survivorIdol.findMany.mockResolvedValue([
      {
        id: 'idol-own',
        powerType: 'vote_shield',
        status: 'hidden',
        assignedAt: new Date('2026-09-01T12:00:00.000Z'),
        expiresAtWeek: 5,
        currentOwnerUserId: 'commish',
        rosterId: 'roster-a',
        isPubliclyKnown: false,
      },
    ])
    prisma.survivorChatChannel.findMany.mockResolvedValue([
      { id: 'chat-league', name: 'Island', channelType: 'league', tribeId: null, memberUserIds: ['commish', 'other'] },
      { id: 'chat-1', name: 'Tribe A', channelType: 'tribe', tribeId: 'tribe-a', memberUserIds: ['commish'] },
    ])
    prisma.survivorIdol.count.mockResolvedValue(19)
    prisma.survivorChatMessage.count.mockResolvedValue(1)
    prisma.survivorAuditEntry.count.mockResolvedValue(1)
    canSeeSurvivorChannel.mockReturnValue(true)
  })

  it('hides cross-tribe members, hidden counts, and unrevealed vote totals for a playing commissioner', async () => {
    const result = await buildSurvivorStateForUser('league-1', 'commish')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.state.noFakeGameplayState).toBe(true)
    expect(result.state.tribes[0].membersVisible).toBe(true)
    expect(result.state.tribes[1].membersVisible).toBe(false)
    expect(result.state.tribes[1].members).toEqual([])
    expect(result.state.voteWindow.ownVoteSubmitted).toBe(true)
    expect(result.state.voteWindow.totalVoteCount).toBeNull()
    expect(result.state.idols.hiddenInventoryVisible).toBe(false)
    expect(result.state.idols.hiddenCount).toBeNull()
    expect(result.state.idols.own).toHaveLength(1)
  })

  it('reports Phase 2 initialization status without leaking hidden ownership', async () => {
    const result = await buildSurvivorStateForUser('league-1', 'commish')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.state.initialization.tribesAssigned).toBe(true)
    expect(result.state.initialization.tribeCount).toBe(2)
    expect(result.state.initialization.chatsProvisioned).toBe(true)
    expect(result.state.initialization.tribeChatCount).toBe(1)
    expect(result.state.initialization.idolsSeeded).toBe(true)
    expect(result.state.initialization.voteShieldCount).toBe(19)
    expect(result.state.initialization.introPosted).toBe(true)
    expect(result.state.initialization.phase2Complete).toBe(true)
    // status counts only — never an owner map (playing commissioner cannot see hidden assignments)
    expect(result.state.idols.hiddenInventoryVisible).toBe(false)
  })

  it('exposes the tribal council view but hides host tally + reveal from a playing commissioner', async () => {
    const result = await buildSurvivorStateForUser('league-1', 'commish')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.state.tribalCouncil.active).toBe(true)
    expect(result.state.tribalCouncil.councilId).toBe('council-1')
    expect(result.state.tribalCouncil.status).toBe('voting_open')
    // Playing commissioner: no operational host block, no pre-reveal tally.
    expect(result.state.tribalCouncil.host).toBeNull()
    expect(result.state.tribalCouncil.reveal).toBeNull()
    expect(result.state.tribalCouncil.isRevealed).toBe(false)
  })
  it('shows operational draft setup blockers only to administrators', async () => {
    prisma.survivorAuditEntry.findFirst.mockResolvedValue({ action: 'draft_setup_pending', data: { blockers: ['Every team needs an owner.'] } })
    const admin = await buildSurvivorStateForUser('league-1', 'commish')
    expect(admin.ok && admin.state.pendingFoundationWarnings).toContain('Every team needs an owner.')
    const access = await resolveSurvivorAccessContext()
    resolveSurvivorAccessContext.mockResolvedValue({ ...access, decisions: { ...access.decisions, canPerformAdminAction: false } })
    prisma.survivorAuditEntry.findFirst.mockClear()
    const member = await buildSurvivorStateForUser('league-1', 'other')
    expect(member.ok && member.state.pendingFoundationWarnings).not.toContain('Every team needs an owner.')
    expect(prisma.survivorAuditEntry.findFirst).not.toHaveBeenCalled()
  })
  it('ignores malformed historical setup blockers', async () => {
    prisma.survivorAuditEntry.findFirst.mockResolvedValue({ action: 'draft_setup_pending', data: { blockers: 'invalid' } })
    expect((await buildSurvivorStateForUser('league-1', 'commish')).ok).toBe(true)
  })
  it('allows completed setup when idols are explicitly disabled', async () => {
    const access = await resolveSurvivorAccessContext()
    resolveSurvivorAccessContext.mockResolvedValue({ ...access, settings: { ...access.settings, idolsEnabled: false } })
    prisma.survivorIdol.count.mockResolvedValue(0)
    const result = await buildSurvivorStateForUser('league-1', 'commish')
    expect(result.ok && result.state.initialization.phase2Complete).toBe(true)
  })
  it('keeps the entire non-owner state payload identical when a secret Vote Steal is played', async () => {
    const before = await buildSurvivorStateForUser('league-1', 'commish')
    const council = await prisma.survivorTribalCouncil.findFirst()
    prisma.survivorTribalCouncil.findFirst.mockResolvedValue({ ...council, idolsPlayed: [{ idolId: 'secret-steal', powerType: 'vote_steal', playerUserId: 'other', playerRosterId: 'roster-b', stolenVoterUserId: 'commish', stolenVoterRosterId: 'roster-a', extraTargetUserId: 'commish' }] })
    const after = await buildSurvivorStateForUser('league-1', 'commish')
    expect(after.ok).toBe(true)
    expect(after).toEqual(before)
    expect(JSON.stringify(after)).not.toMatch(/secret-steal|vote_steal|stolenVoter|extraTarget/)
  })

})
