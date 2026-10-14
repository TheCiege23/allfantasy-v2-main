import 'server-only'

import { prisma } from '@/lib/prisma'
import { getLeagueRole, type LeagueRole } from '@/lib/league/permissions'
import {
  normalizeSurvivorFoundationSettings,
  type SurvivorFoundationSettings,
} from './normalizeSurvivorSettings'

type SettingsRecord = Record<string, unknown>

export type SurvivorAccessChannelType =
  | 'league'
  | 'tribe'
  | 'merge'
  | 'alliance'
  | 'dm'
  | 'private'
  | 'exile'
  | 'jury'
  | 'finale'
  | string

export interface SurvivorAccessSnapshot {
  leagueId: string
  userId: string
  role: LeagueRole
  leagueOwnerUserId?: string | null
  settings?: SettingsRecord | null
  player?: {
    userId: string
    playerState?: string | null
    tribeId?: string | null
    redraftRosterId?: string | null
    canAccessTribeChat?: boolean | null
    canAccessMergeChat?: boolean | null
    canAccessExileChat?: boolean | null
    canAccessJuryChat?: boolean | null
    canAccessFinaleChat?: boolean | null
    isJuryMember?: boolean | null
    isFinalist?: boolean | null
  } | null
  roster?: { id: string } | null
  isAiHostActor?: boolean
}

export interface SurvivorAccessDecisions {
  canSeeHiddenIdolAssignments: boolean
  canSeePrivateVotes: boolean
  canSeeVoteTallyBeforeReveal: boolean
  canSeePrivateUserDm: boolean
  canSeeTribeChat: boolean
  canSeeExileChat: boolean
  canSeeJuryChat: boolean
  canPerformAdminAction: boolean
  canPerformSensitiveHostAction: boolean
  canOverrideVoteDeadline: boolean
  canRevealVotes: boolean
  canRunChallengeResolution: boolean
  canUpdateSettings: boolean
}

export interface SurvivorAccessContext {
  leagueId: string
  userId: string
  role: LeagueRole
  settings: SurvivorFoundationSettings
  isLeagueMember: boolean
  isLeagueCommissioner: boolean
  isCoCommissioner: boolean
  isParticipant: boolean
  isCommissionerParticipating: boolean
  isUserActivePlayer: boolean
  isUserEliminated: boolean
  isUserExiled: boolean
  isUserJuryMember: boolean
  isUserFinalist: boolean
  isNonParticipatingCommissionerHost: boolean
  isParticipatingCommissioner: boolean
  isAiHostActor: boolean
  playerState: string | null
  tribeId: string | null
  rosterId: string | null
  canAccessTribeChat: boolean
  canAccessMergeChat: boolean
  canAccessExileChat: boolean
  canAccessJuryChat: boolean
  canAccessFinaleChat: boolean
  decisions: SurvivorAccessDecisions
  privacyWarnings: string[]
}

function asSettingsRecord(value: unknown): SettingsRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as SettingsRecord)
    : {}
}

function isPlayingState(state: string | null): boolean {
  if (!state) return true
  return !['spectator', 'viewer', 'host', 'non_participating_host'].includes(state)
}

export function buildSurvivorAccessContextFromSnapshot(
  snapshot: SurvivorAccessSnapshot,
): SurvivorAccessContext {
  const settings = normalizeSurvivorFoundationSettings(snapshot.settings)
  const role = snapshot.role
  const playerState = snapshot.player?.playerState ?? null
  const isLeagueCommissioner = role === 'commissioner'
  const isCoCommissioner = role === 'co_commissioner'
  const isAdmin = isLeagueCommissioner || isCoCommissioner
  const isParticipant = Boolean(snapshot.player && isPlayingState(playerState)) || Boolean(snapshot.roster)
  const commissionerParticipationConfigured =
    settings.commissionerParticipationMode === 'participating_player'
  const isCommissionerParticipating =
    isLeagueCommissioner &&
    (commissionerParticipationConfigured || isParticipant)
  const coCommissionerPrivacyFollowsPlayer =
    isCoCommissioner &&
    isParticipant
  const isParticipatingCommissioner = isCommissionerParticipating || coCommissionerPrivacyFollowsPlayer
  const isNonParticipatingCommissionerHost =
    (isLeagueCommissioner && !isCommissionerParticipating) ||
    (isCoCommissioner && !isParticipant && settings.coCommissionerMode === 'non_participating_host')
  const isAiHostActor = Boolean(snapshot.isAiHostActor)
  // A non-playing human host has full game oversight; playing commissioners stay blind.
  const hostCanSeeHidden = isAiHostActor || isNonParticipatingCommissionerHost
  const hostCanControl = isAiHostActor || isNonParticipatingCommissionerHost

  const canAccessTribeChat = Boolean(snapshot.player?.canAccessTribeChat ?? isParticipant)
  const canAccessMergeChat = Boolean(snapshot.player?.canAccessMergeChat)
  const canAccessExileChat = Boolean(snapshot.player?.canAccessExileChat)
  const canAccessJuryChat = Boolean(snapshot.player?.canAccessJuryChat ?? snapshot.player?.isJuryMember)
  const canAccessFinaleChat = Boolean(snapshot.player?.canAccessFinaleChat ?? snapshot.player?.isFinalist)

  const privacyWarnings: string[] = []
  if (isParticipatingCommissioner) {
    privacyWarnings.push(
      'Playing commissioners use player visibility for hidden idols, private votes, DMs, and unrevealed strategy state.',
    )
  }
  if (isCoCommissioner && settings.coCommissionerMode === 'disabled') {
    privacyWarnings.push('Co-commissioner Survivor host access is disabled for this league.')
  }

  return {
    leagueId: snapshot.leagueId,
    userId: snapshot.userId,
    role,
    settings,
    isLeagueMember: Boolean(role) || isParticipant,
    isLeagueCommissioner,
    isCoCommissioner,
    isParticipant,
    isCommissionerParticipating,
    isUserActivePlayer: playerState === 'active' || playerState === null && isParticipant,
    isUserEliminated: playerState === 'eliminated',
    isUserExiled: playerState === 'exile',
    isUserJuryMember: Boolean(snapshot.player?.isJuryMember) || playerState === 'jury',
    isUserFinalist: Boolean(snapshot.player?.isFinalist) || playerState === 'finalist',
    isNonParticipatingCommissionerHost,
    isParticipatingCommissioner,
    isAiHostActor,
    playerState,
    tribeId: snapshot.player?.tribeId ?? null,
    rosterId: snapshot.player?.redraftRosterId ?? snapshot.roster?.id ?? null,
    canAccessTribeChat,
    canAccessMergeChat,
    canAccessExileChat,
    canAccessJuryChat,
    canAccessFinaleChat,
    decisions: {
      canSeeHiddenIdolAssignments: hostCanSeeHidden,
      canSeePrivateVotes: hostCanSeeHidden,
      canSeeVoteTallyBeforeReveal: hostCanSeeHidden,
      canSeePrivateUserDm: false,
      canSeeTribeChat: hostCanControl || canAccessTribeChat,
      canSeeExileChat: hostCanControl || canAccessExileChat,
      canSeeJuryChat: hostCanControl || canAccessJuryChat,
      canPerformAdminAction: isAdmin,
      canPerformSensitiveHostAction: hostCanControl,
      canOverrideVoteDeadline: hostCanControl,
      canRevealVotes: hostCanControl,
      canRunChallengeResolution: hostCanControl,
      canUpdateSettings: isAdmin,
    },
    privacyWarnings,
  }
}

export async function resolveSurvivorAccessContext(
  leagueId: string,
  userId: string,
  options: { isAiHostActor?: boolean } = {},
): Promise<SurvivorAccessContext | null> {
  const [role, league, player, roster] = await Promise.all([
    getLeagueRole(leagueId, userId),
    prisma.league.findUnique({
      where: { id: leagueId },
      select: { userId: true, settings: true },
    }),
    prisma.survivorPlayer.findUnique({
      where: { leagueId_userId: { leagueId, userId } },
      select: {
        userId: true,
        playerState: true,
        tribeId: true,
        redraftRosterId: true,
        canAccessTribeChat: true,
        canAccessMergeChat: true,
        canAccessExileChat: true,
        canAccessJuryChat: true,
        canAccessFinaleChat: true,
        isJuryMember: true,
        isFinalist: true,
      },
    }),
    prisma.roster.findFirst({
      where: { leagueId, platformUserId: userId },
      select: { id: true },
    }),
  ])

  if (!league) return null

  return buildSurvivorAccessContextFromSnapshot({
    leagueId,
    userId,
    role,
    leagueOwnerUserId: league.userId,
    settings: asSettingsRecord(league.settings),
    player,
    roster,
    isAiHostActor: options.isAiHostActor,
  })
}

export function canSeeSurvivorPrivateDm(
  context: SurvivorAccessContext,
  memberUserIds: readonly string[] | null | undefined,
): boolean {
  return Boolean(memberUserIds?.includes(context.userId))
}

export function canSeeSurvivorChannel(
  context: SurvivorAccessContext,
  channel: {
    channelType?: SurvivorAccessChannelType | null
    tribeId?: string | null
    memberUserIds?: readonly string[] | null
  },
): boolean {
  const type = String(channel.channelType ?? 'league')
  if (type === 'league') return context.isLeagueMember
  if (type === 'merge') return context.decisions.canSeeHiddenIdolAssignments || context.canAccessMergeChat
  if (type === 'dm' || type === 'private' || type === 'alliance') return canSeeSurvivorPrivateDm(context, channel.memberUserIds)
  if (type === 'tribe') {
    return context.decisions.canSeeHiddenIdolAssignments || Boolean(context.canAccessTribeChat && channel.tribeId && channel.tribeId === context.tribeId)
  }
  if (type === 'exile') return context.decisions.canSeeExileChat
  if (type === 'jury') return context.decisions.canSeeJuryChat
  if (type === 'finale') {
    return context.decisions.canSeeJuryChat || context.canAccessFinaleChat || context.isUserFinalist
  }
  return context.decisions.canSeeHiddenIdolAssignments
}
