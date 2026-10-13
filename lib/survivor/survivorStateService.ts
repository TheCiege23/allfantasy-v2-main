import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  resolveSurvivorAccessContext,
  canSeeSurvivorChannel,
  type SurvivorAccessContext,
} from './survivorAccessControl'
import { buildTribalCouncilView, type TribalCouncilView } from './survivorTribalView'

type VoteWindowStatus = 'not_started' | 'pending' | 'voting_open' | 'votes_locked' | 'revealed' | 'complete'

type StatePlayerRow = {
  userId: string
  displayName: string
  playerState: string
  tribeId: string | null
  eliminatedWeek: number | null
  isJuryMember: boolean
  isFinalist: boolean
  redraftRosterId: string | null
}

type StateTribeRow = {
  logoUrl: string | null
  colorHex: string | null
  id: string
  name: string
  slotIndex: number
  isActive: boolean
  isMerged: boolean
  members: Array<{ rosterId: string }>
}

type StateVoteRow = {
  id: string
  voterRosterId: string
  voterUserId: string | null
}

type StateCouncilRow = {
  id: string
  status: string
  week: number
  isRevealed: boolean
  votingOpensAt: Date | null
  votingDeadline: Date | null
  voteDeadlineAt: Date
  votes: StateVoteRow[]
}

type StateIdolRow = {
  id: string
  powerType: string
  status: string
  assignedAt: Date
  expiresAtWeek: number | null
  currentOwnerUserId: string | null
  rosterId: string
  isPubliclyKnown: boolean
}

type StateChannelRow = {
  id: string
  name: string
  channelType: string
  tribeId: string | null
  memberUserIds: string[]
}

export interface SurvivorFoundationState {
  ok: true
  leagueId: string
  phase: string
  currentWeek: number
  settings: SurvivorAccessContext['settings']
  access: {
    role: SurvivorAccessContext['role']
    isCommissioner: boolean
    isCoCommissioner: boolean
    isParticipant: boolean
    isCommissionerParticipating: boolean
    isNonParticipatingCommissionerHost: boolean
    playerState: string | null
    tribeId: string | null
    rosterId: string | null
    decisions: SurvivorAccessContext['decisions']
    privacyWarnings: string[]
  }
  dashboard: {
    castSize: number
    activePlayers: number
    eliminatedPlayers: number
    exilePlayers: number
    juryPlayers: number
    finalistPlayers: number
    activeTribeCount: number
    mergeTriggered: boolean
  }
  tribes: Array<{
    logoUrl: string | null
    colorHex: string | null
    id: string
    name: string
    slotIndex: number
    isActive: boolean
    isMerged: boolean
    memberCount: number
    membersVisible: boolean
    members: Array<{ userId: string | null; rosterId: string; displayName: string | null }>
  }>
  voteWindow: {
    councilId: string | null
    status: VoteWindowStatus
    week: number | null
    votingOpensAt: string | null
    votingDeadline: string | null
    ownVoteSubmitted: boolean
    revealed: boolean
    visibleVoteCount: number | null
    totalVoteCount: number | null
  }
  idols: {
    own: Array<{ id: string; powerType: string; status: string; assignedAt: string | null; expiresAtWeek: number | null; isPubliclyKnown: boolean }>
    public: Array<{ id: string; powerType: string; status: string; isPubliclyKnown: boolean }>
    hiddenInventoryVisible: boolean
    hiddenCount: number | null
  }
  chats: Array<{ id: string; name: string; channelType: string; tribeId: string | null; memberCount: number }>
  tribalCouncil: TribalCouncilView
  initialization: {
    tribesAssigned: boolean
    tribeCount: number
    chatsProvisioned: boolean
    tribeChatCount: number
    idolsSeeded: boolean
    voteShieldCount: number
    introPosted: boolean
    phase2Complete: boolean
  }
  audit: {
    visibleRecentCount: number
  }
  noFakeGameplayState: true
  pendingFoundationWarnings: string[]
}

export type SurvivorFoundationStateResult =
  | { ok: true; state: SurvivorFoundationState }
  | { ok: false; status: 403 | 404; error: string }

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

function voteWindowStatus(raw: string | null | undefined, revealed: boolean): VoteWindowStatus {
  if (revealed) return raw === 'complete' ? 'complete' : 'revealed'
  if (raw === 'voting_open' || raw === 'votes_locked') return raw
  if (raw === 'reveal_in_progress') return 'revealed'
  if (raw === 'complete') return 'complete'
  if (raw === 'pending') return 'pending'
  return 'not_started'
}

export async function buildSurvivorStateForUser(
  leagueId: string,
  userId: string,
): Promise<SurvivorFoundationStateResult> {
  const access = await resolveSurvivorAccessContext(leagueId, userId)
  if (!access) return { ok: false, status: 404, error: 'League not found' }
  if (!access.isLeagueMember) return { ok: false, status: 403, error: 'Forbidden' }

  const idolWhere = access.decisions.canSeeHiddenIdolAssignments
    ? { leagueId }
    : {
        leagueId,
        OR: [{ currentOwnerUserId: userId }, { isPubliclyKnown: true }],
      }

  const [
    league,
    gameState,
    players,
    tribes,
    council,
    idols,
    channels,
    auditCount,
    voteShieldCount,
    introMessageCount,
    draftSetupStatus,
  ] = await Promise.all([
    prisma.league.findUnique({
      where: { id: leagueId },
      select: {
        survivorMode: true,
        survivorPhase: true,
        survivorPlayerCount: true,
        survivorMergeWeek: true,
        leagueVariant: true,
      },
    }),
    prisma.survivorGameState.findUnique({ where: { leagueId } }),
    prisma.survivorPlayer.findMany({
      where: { leagueId },
      select: {
        userId: true,
        displayName: true,
        playerState: true,
        tribeId: true,
        eliminatedWeek: true,
        isJuryMember: true,
        isFinalist: true,
        redraftRosterId: true,
      },
      orderBy: [{ displayName: 'asc' }],
    }),
    prisma.survivorTribe.findMany({
      where: { leagueId },
      select: {
        id: true,
        name: true,
        slotIndex: true,
        logoUrl: true,
        colorHex: true,
        isActive: true,
        isMerged: true,
        members: { select: { rosterId: true } },
      },
      orderBy: { slotIndex: 'asc' },
    }),
    prisma.survivorTribalCouncil.findFirst({
      where: { leagueId, status: { in: ['pending', 'voting_open', 'votes_locked', 'reveal_in_progress', 'complete'] } },
      select: {
        id: true,
        status: true,
        week: true,
        isRevealed: true,
        votingOpensAt: true,
        votingDeadline: true,
        voteDeadlineAt: true,
        votes: {
          select: {
            id: true,
            voterRosterId: true,
            voterUserId: true,
          },
        },
      },
      orderBy: [{ week: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.survivorIdol.findMany({
      where: idolWhere,
      select: {
        id: true,
        powerType: true,
        status: true,
        assignedAt: true,
        expiresAtWeek: true,
        currentOwnerUserId: true,
        rosterId: true,
        isPubliclyKnown: true,
      },
    }),
    prisma.survivorChatChannel.findMany({
      where: { leagueId, isArchived: false },
      select: {
        id: true,
        name: true,
        channelType: true,
        tribeId: true,
        memberUserIds: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.survivorAuditEntry.count({
      where: access.decisions.canSeeHiddenIdolAssignments
        ? { leagueId }
        : {
            leagueId,
            OR: [{ isVisibleToPublic: true }, { actorUserId: userId }, { targetUserId: userId }],
          },
    }),
    prisma.survivorIdol.count({ where: { leagueId, powerType: 'vote_shield' } }),
    prisma.survivorChatMessage.count({ where: { leagueId, contentType: 'survivor_intro' } }),
    access.decisions.canPerformAdminAction
      ? prisma.survivorAuditEntry.findFirst({
          where: { leagueId, action: { in: ['draft_setup_pending', 'draft_setup_ready'] } },
          orderBy: { createdAt: 'desc' }, select: { action: true, data: true },
        })
      : Promise.resolve(null),
  ])

  if (!league || (league.leagueVariant !== 'survivor' && !league.survivorMode)) {
    return { ok: false, status: 404, error: 'Not a Survivor league' }
  }

  const playerRows = players as StatePlayerRow[]
  const tribeRows = tribes as StateTribeRow[]
  const councilRow = council as StateCouncilRow | null
  const idolRows = idols as StateIdolRow[]
  const channelRows = channels as StateChannelRow[]
  const rosterId = access.rosterId
  const playersByRoster = new Map(playerRows.map((p) => [p.redraftRosterId, p]))
  const playersByUser = new Map(playerRows.map((p) => [p.userId, p]))
  const ownVoteSubmitted = Boolean(
    councilRow?.votes.some((v) => v.voterUserId === userId || (rosterId && v.voterRosterId === rosterId)),
  )
  const revealed = councilRow?.isRevealed === true
  const visibleVotes = revealed || access.decisions.canSeePrivateVotes ? (councilRow?.votes.length ?? 0) : null
  const ownVoteCount = ownVoteSubmitted ? 1 : 0
  const activePlayers = playerRows.filter((p) => p.playerState === 'active').length
  const exilePlayers = playerRows.filter((p) => p.playerState === 'exile').length
  const eliminatedPlayers = playerRows.filter((p) => p.playerState === 'eliminated' || p.eliminatedWeek != null).length
  const juryPlayers = playerRows.filter((p) => p.isJuryMember || p.playerState === 'jury').length
  const finalistPlayers = playerRows.filter((p) => p.isFinalist || p.playerState === 'finalist').length

  const ownIdols = idolRows
    .filter((idol) => idol.currentOwnerUserId === userId)
    .map((idol) => ({
      id: idol.id,
      powerType: idol.powerType,
      status: idol.status,
      assignedAt: iso(idol.assignedAt),
      expiresAtWeek: idol.expiresAtWeek ?? null,
      isPubliclyKnown: idol.isPubliclyKnown,
    }))
  const publicIdols = idolRows
    .filter((idol) => idol.isPubliclyKnown)
    .map((idol) => ({
      id: idol.id,
      powerType: idol.powerType,
      status: idol.status,
      isPubliclyKnown: idol.isPubliclyKnown,
    }))

  const visibleChannels = channelRows
    .filter((channel) => canSeeSurvivorChannel(access, channel))
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      channelType: channel.channelType,
      tribeId: channel.tribeId ?? null,
      memberCount: channel.memberUserIds.length,
    }))

  const tribalCouncil = await buildTribalCouncilView(access)

  const state: SurvivorFoundationState = {
    ok: true,
    leagueId,
    phase: gameState?.phase ?? league.survivorPhase ?? 'setup',
    currentWeek: gameState?.currentWeek ?? 0,
    settings: access.settings,
    access: {
      role: access.role,
      isCommissioner: access.isLeagueCommissioner,
      isCoCommissioner: access.isCoCommissioner,
      isParticipant: access.isParticipant,
      isCommissionerParticipating: access.isCommissionerParticipating,
      isNonParticipatingCommissionerHost: access.isNonParticipatingCommissionerHost,
      playerState: access.playerState,
      tribeId: access.tribeId,
      rosterId,
      decisions: access.decisions,
      privacyWarnings: access.privacyWarnings,
    },
    dashboard: {
      castSize: playerRows.length || league.survivorPlayerCount || access.settings.defaultTeamCount,
      activePlayers,
      eliminatedPlayers,
      exilePlayers,
      juryPlayers,
      finalistPlayers,
      activeTribeCount: tribeRows.filter((t) => t.isActive).length,
      mergeTriggered: Boolean(gameState?.mergeTriggeredAt),
    },
    tribes: tribeRows.map((tribe) => {
      const canSeeMembers = access.decisions.canSeeHiddenIdolAssignments || tribe.id === access.tribeId
      return {
        id: tribe.id,
        name: tribe.name,
        logoUrl: tribe.logoUrl,
        colorHex: tribe.colorHex,
        slotIndex: tribe.slotIndex,
        isActive: tribe.isActive,
        isMerged: tribe.isMerged,
        memberCount: tribe.members.length,
        membersVisible: canSeeMembers,
        members: canSeeMembers
          ? tribe.members.map((member) => {
              const player = playersByRoster.get(member.rosterId)
              return {
                userId: player?.userId ?? null,
                rosterId: member.rosterId,
                displayName: player?.displayName ?? null,
              }
            })
          : [],
      }
    }),
    voteWindow: {
      councilId: councilRow?.id ?? null,
      status: voteWindowStatus(councilRow?.status, revealed),
      week: councilRow?.week ?? null,
      votingOpensAt: iso(councilRow?.votingOpensAt),
      votingDeadline: iso(councilRow?.votingDeadline ?? councilRow?.voteDeadlineAt),
      ownVoteSubmitted,
      revealed,
      visibleVoteCount: visibleVotes ?? (ownVoteSubmitted ? ownVoteCount : null),
      totalVoteCount: visibleVotes,
    },
    idols: {
      own: ownIdols,
      public: publicIdols,
      hiddenInventoryVisible: access.decisions.canSeeHiddenIdolAssignments,
      hiddenCount: access.decisions.canSeeHiddenIdolAssignments ? idolRows.length : null,
    },
    chats: visibleChannels,
    tribalCouncil,
    initialization: (() => {
      const tribeChatCount = channelRows.filter((c) => c.channelType === 'tribe').length
      const tribeMemberTotal = tribeRows.reduce((n, t) => n + t.members.length, 0)
      const tribesAssigned = tribeRows.length > 0 && tribeMemberTotal > 0
      const chatsProvisioned = channelRows.some((c) => c.channelType === 'league') || tribeChatCount > 0
      const idolsSeeded = (voteShieldCount as number) > 0
      const introPosted = (introMessageCount as number) > 0
      return {
        tribesAssigned,
        tribeCount: tribeRows.length,
        chatsProvisioned,
        tribeChatCount,
        idolsSeeded,
        voteShieldCount: voteShieldCount as number,
        introPosted,
        phase2Complete: tribesAssigned && chatsProvisioned && (!access.settings.idolsEnabled || idolsSeeded) && introPosted,
      }
    })(),
    audit: {
      visibleRecentCount: auditCount,
    },
    noFakeGameplayState: true,
    pendingFoundationWarnings: [
      'Full-season Survivor gameplay is still in development; setup completion does not certify challenges, Exile, jury, or finale.',
      ...(draftSetupStatus?.action === 'draft_setup_pending' && draftSetupStatus.data && typeof draftSetupStatus.data === 'object' && !Array.isArray(draftSetupStatus.data)
        ? (Array.isArray((draftSetupStatus.data as Record<string, unknown>).blockers) ? (draftSetupStatus.data as { blockers: unknown[] }).blockers : []).filter((value): value is string => typeof value === 'string')
        : []),
      ...access.privacyWarnings,
    ],
  }

  if (access.tribeId && !playersByUser.has(userId)) {
    state.pendingFoundationWarnings.push('Viewer has tribe access but no SurvivorPlayer row was found.')
  }

  return { ok: true, state }
}
