/**
 * Viral Invite Engine (PROMPT 142): create, preview, accept, list, analytics.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ACTIVE_TEAM_WHERE } from '@/lib/league-import/activeTeams'
import { assertPaidJoinAllowed, linkDuesToRoster } from '@/lib/league-finance/joinGate'
import { validateInviteCode, validateFantasyInviteCode } from '@/lib/league-invite'
import { attributeSignupToReferrer, grantRewardForSignup } from '@/lib/referral'
import { joinByInviteCode } from '@/lib/creator-system'
import { assessLeagueJoinRisk } from '@/lib/identity/DuplicateManagerRiskService'
import { createDuplicateManagerFlag } from '@/lib/identity/DuplicateManagerFlagService'
import { generateInviteToken, normalizeToken } from './tokenGenerator'
import {
  buildInviteDeepLink,
  buildInviteDestinationHref,
  buildInviteDestinationLabel,
  buildInviteShareTargets,
} from './shareUrls'
import type {
  InviteEventType,
  InviteLinkDto,
  InvitePreviewDto,
  InvitePreviewStatus,
  InviteStatsDto,
  InviteStatus,
  InviteType,
} from './types'

const MAX_ACTIVE_PER_USER_PER_DAY = 100
const TOKEN_MAX_ATTEMPTS = 5

type InviteLinkWithCreator = Awaited<ReturnType<typeof fetchInviteLinkByToken>>

function baseUrlFallback(): string {
  return process.env.NEXTAUTH_URL ?? 'https://allfantasy.ai'
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function metadataToRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function toIsoString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function buildDefaultInviteTitle(type: InviteType): string {
  switch (type) {
    case 'league':
      return 'Fantasy league invite'
    case 'bracket':
      return 'Bracket invite'
    case 'creator_league':
      return 'Creator league invite'
    case 'referral':
      return 'Referral invite'
    case 'reactivation':
      return 'Reactivation invite'
    case 'waitlist':
      return 'Waitlist preview invite'
    default:
      return 'Invite'
  }
}

function buildDefaultInviteDescription(type: InviteType, createdByLabel?: string | null): string {
  switch (type) {
    case 'league':
      return 'Join this fantasy league on AllFantasy.'
    case 'bracket':
      return 'Join this bracket competition on AllFantasy.'
    case 'creator_league':
      return 'Join this creator league and compete with the community.'
    case 'referral':
      return createdByLabel
        ? `${createdByLabel} invited you to join AllFantasy.`
        : 'A friend invited you to join AllFantasy.'
    case 'reactivation':
      return 'Jump back into your fantasy dashboard and rejoin the action.'
    case 'waitlist':
      return 'Claim your early-access spot for the next AllFantasy experience.'
    default:
      return 'Open your AllFantasy invite.'
  }
}

function buildPreviewStatusReason(
  status: InvitePreviewStatus,
  input?: { maxUses?: number; createdByLabel?: string | null }
): string | null {
  switch (status) {
    case 'expired':
      return 'This invite has expired.'
    case 'full':
      return 'This league is already full.'
    case 'already_member':
      return 'You are already a member.'
    case 'already_redeemed':
      return 'This invite has already been redeemed on your account.'
    case 'max_used':
      return input?.maxUses && input.maxUses > 0
        ? `This invite reached its ${input.maxUses}-use limit.`
        : 'This invite can no longer be used.'
    case 'invalid':
      return 'This invite is not valid.'
    case 'valid':
    default:
      return input?.createdByLabel ? `Shared by ${input.createdByLabel}.` : null
  }
}

export function buildInviteUrl(token: string, baseUrl?: string): string {
  const base = (baseUrl ?? baseUrlFallback()).replace(/\/$/, '')
  return `${base}/invite/accept?code=${encodeURIComponent(token)}`
}

export function deriveInviteStatus(input: {
  status: string
  expiresAt?: Date | null
  maxUses?: number | null
  useCount?: number | null
  now?: Date
}): InviteStatus {
  const now = input.now ?? new Date()
  if (input.status === 'revoked') return 'revoked'
  if (input.expiresAt && input.expiresAt.getTime() < now.getTime()) return 'expired'
  if ((input.maxUses ?? 0) > 0 && (input.useCount ?? 0) >= (input.maxUses ?? 0)) return 'max_used'
  return 'active'
}

async function fetchInviteLinkByToken(token: string) {
  const normalized = normalizeToken(token)
  if (!normalized) return null
  return prisma.inviteLink.findUnique({
    where: { token: normalized },
    include: {
      createdBy: {
        select: {
          id: true,
          username: true,
          displayName: true,
        },
      },
    },
  })
}

async function updateInviteLifecycle(link: NonNullable<InviteLinkWithCreator>) {
  const nextStatus = deriveInviteStatus({
    status: link.status,
    expiresAt: link.expiresAt,
    maxUses: link.maxUses,
    useCount: link.useCount,
  })
  if (nextStatus !== link.status && nextStatus !== 'active') {
    await prisma.inviteLink
      .update({
        where: { id: link.id },
        data: { status: nextStatus },
      })
      .catch(() => {})
  }
  return nextStatus
}

async function incrementInviteUseCount(linkId: string, useCount: number, maxUses: number) {
  const nextUseCount = useCount + 1
  const nextStatus = maxUses > 0 && nextUseCount >= maxUses ? 'max_used' : 'active'
  await prisma.inviteLink.update({
    where: { id: linkId },
    data: {
      useCount: nextUseCount,
      status: nextStatus,
    },
  })
}

/** Looks up current useCount/maxUses then increments — for callers (e.g. a deferred duplicate-manager-flag approval) that only have the link id on hand. */
export async function incrementInviteUseCountById(linkId: string): Promise<void> {
  const link = await prisma.inviteLink.findUnique({ where: { id: linkId }, select: { useCount: true, maxUses: true } })
  if (!link) return
  await incrementInviteUseCount(linkId, link.useCount, link.maxUses)
}

export async function createFantasyLeagueRoster(
  leagueId: string,
  userId: string,
  options?: { skipRiskCheck?: boolean; inviteLinkId?: string | null }
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.roster.findUnique({
      where: { leagueId_platformUserId: { leagueId, platformUserId: userId } },
      select: { id: true },
    })
    if (existing) {
      return { ok: true as const, leagueId, alreadyMember: true as const, pendingReview: false as const }
    }

    // Duplicate-manager risk check — before any roster is created, so a high-risk
    // join never lands a team until a commissioner/admin explicitly allows it.
    // Household-exempt / low risk: proceeds silently. Medium: proceeds + visible
    // flag. High: blocked here; DuplicateManagerFlagService.resolveDuplicateManagerFlag
    // re-invokes this same function with skipRiskCheck to complete the join later,
    // so leagueTeam/growthAttribution/dues side effects below never get duplicated.
    if (!options?.skipRiskCheck) {
      const assessment = await assessLeagueJoinRisk({ leagueId, joiningUserId: userId, client: tx as unknown as Prisma.TransactionClient })
      if (assessment.riskLevel === 'high') {
        await createDuplicateManagerFlag({
          leagueId,
          joiningUserId: userId,
          assessment,
          status: 'pending_review',
          inviteLinkId: options?.inviteLinkId ?? null,
          client: tx as unknown as Prisma.TransactionClient,
        })
        return { ok: true as const, leagueId, alreadyMember: false as const, pendingReview: true as const }
      }
      if (assessment.riskLevel === 'medium') {
        await createDuplicateManagerFlag({
          leagueId,
          joiningUserId: userId,
          assessment,
          status: 'flagged',
          inviteLinkId: options?.inviteLinkId ?? null,
          client: tx as unknown as Prisma.TransactionClient,
        })
      }
    }

    const [league, rosterCount, draftSession, profile] = await Promise.all([
      tx.league.findUnique({
        where: { id: leagueId },
        select: {
          id: true,
          name: true,
          platform: true,
          leagueSize: true,
          leagueVariant: true,
        },
      }),
      // Slice 7/7.1: exclude orphan AI rosters from "is full" capacity check.
      // Orphans get evicted for new humans via evictOrphanForNewHumanRoster.
      tx.roster.count({
        where: { leagueId, NOT: { platformUserId: { startsWith: 'orphan-' } } },
      }),
      tx.draftSession.findUnique({
        where: { leagueId },
        select: { status: true },
      }),
      tx.userProfile.findFirst({
        where: { userId },
        select: { displayName: true, sleeperUsername: true },
      }),
    ])

    if (!league) {
      return { ok: false as const, error: 'League not found' }
    }

    if (league.leagueSize != null && rosterCount >= league.leagueSize) {
      return { ok: false as const, error: 'League is full' }
    }

    if (league.leagueVariant === 'survivor' && draftSession?.status && draftSession.status !== 'pre_draft') {
      return { ok: false as const, error: 'Survivor leagues lock after the draft starts' }
    }

    const paidGate = await assertPaidJoinAllowed({ leagueId, userId, tx: tx as Prisma.TransactionClient })
    if (!paidGate.ok) {
      return { ok: false as const, error: paidGate.message }
    }

    const roster = await tx.roster.create({
      data: {
        leagueId,
        platformUserId: userId,
        playerData: { draftPicks: [] },
      },
      select: { id: true },
    })

    await linkDuesToRoster({ leagueId, userId, rosterId: roster.id, tx: tx as Prisma.TransactionClient })

    if (league.platform === 'manual') {
      /*
       * 🛑 THIS COUNT DECIDES WHETHER A JOINING MANAGER GETS A TEAM ROW AT ALL.
       *
       * An archived seat inflated it, so a manual league that had lost a seat could report
       * itself full and silently skip the `leagueTeam.create` below — the manager joins, gets a
       * roster, and has no team. Registered as an admin/monitoring exception before this pass;
       * that was wrong. Counting seats to REPORT is monitoring, counting them to DECIDE is not.
       */
      const manualTeamCount = await tx.leagueTeam.count({
        where: { ...ACTIVE_TEAM_WHERE, leagueId },
      })
      if (league.leagueSize == null || manualTeamCount < league.leagueSize) {
        const displayName = profile?.displayName?.trim() || profile?.sleeperUsername?.trim() || 'Manager'
        const teamBaseName = league.name?.trim() || 'League'
        await tx.leagueTeam
          .create({
            data: {
              leagueId,
              externalId: roster.id,
              ownerName: displayName,
              teamName: `${displayName}'s ${teamBaseName} Team`,
            },
          })
          .catch(() => null)
      }
    }

    await tx.growthAttribution.upsert({
      where: { userId },
      update: {
        source: 'league_invite',
        sourceId: leagueId,
        metadata: {
          source: 'fantasy_league',
        },
      },
      create: {
        userId,
        source: 'league_invite',
        sourceId: leagueId,
        metadata: {
          source: 'fantasy_league',
        },
      },
    })

    return { ok: true as const, leagueId, alreadyMember: false as const, pendingReview: false as const }
  })
}

/** Exported entry point for DuplicateManagerFlagService — completes a join that was previously held for review, bypassing the risk check (already resolved by the commissioner action that calls this). */
export async function createFantasyLeagueRosterBypassingRiskCheck(leagueId: string, userId: string) {
  return createFantasyLeagueRoster(leagueId, userId, { skipRiskCheck: true })
}

function buildPreviewResult(input: {
  inviteType: InviteType
  token: string
  title: string
  description?: string | null
  targetId?: string | null
  targetName?: string | null
  sport?: string | null
  memberCount?: number | null
  maxMembers?: number | null
  isFull?: boolean
  expired?: boolean
  expiresAt?: Date | null
  useCount?: number
  maxUses?: number
  status: InvitePreviewStatus
  statusReason?: string | null
  previewImageUrl?: string | null
  createdByLabel?: string | null
  inviteUrl: string
}): InvitePreviewDto {
  return {
    inviteType: input.inviteType,
    token: input.token,
    title: input.title,
    description: input.description ?? null,
    targetId: input.targetId ?? null,
    targetName: input.targetName ?? null,
    sport: input.sport ?? null,
    memberCount: input.memberCount ?? null,
    maxMembers: input.maxMembers ?? null,
    isFull: Boolean(input.isFull),
    expired: Boolean(input.expired),
    expiresAt: toIsoString(input.expiresAt),
    status: input.status,
    statusReason:
      input.statusReason ?? buildPreviewStatusReason(input.status, {
        maxUses: input.maxUses,
        createdByLabel: input.createdByLabel,
      }),
    useCount: input.useCount ?? 0,
    maxUses: input.maxUses ?? 0,
    destinationHref: buildInviteDestinationHref(input.inviteType, input.targetId),
    destinationLabel: buildInviteDestinationLabel(input.inviteType, input.targetId),
    deepLinkUrl: buildInviteDeepLink(input.token),
    previewImageUrl: input.previewImageUrl ?? null,
    createdByLabel: input.createdByLabel ?? null,
    shareTargets: buildInviteShareTargets(input.inviteUrl, {
      message: input.description ?? buildDefaultInviteDescription(input.inviteType, input.createdByLabel),
      subject: input.title,
    }),
  }
}

async function buildInvitePreviewFromLink(
  link: NonNullable<InviteLinkWithCreator>,
  options?: { userId?: string | null; baseUrl?: string | null }
): Promise<InvitePreviewDto> {
  const inviteUrl = buildInviteUrl(link.token, options?.baseUrl ?? baseUrlFallback())
  const metadata = metadataToRecord(link.metadata)
  const createdByLabel = link.createdBy.displayName || link.createdBy.username || null
  const lifecycle = await updateInviteLifecycle(link)
  const expired = lifecycle === 'expired'
  const maxUsed = lifecycle === 'max_used'

  if (link.type === 'league' && link.targetId) {
    const [league, existingRoster, humanRosterCount] = await Promise.all([
      prisma.league.findUnique({
        where: { id: link.targetId },
        select: {
          id: true,
          name: true,
          sport: true,
          leagueSize: true,
          avatarUrl: true,
        },
      }),
      options?.userId
        ? prisma.roster.findUnique({
            where: {
              leagueId_platformUserId: {
                leagueId: link.targetId,
                platformUserId: options.userId,
              },
            },
            select: { id: true },
          })
        : Promise.resolve(null),
      // Slice 7/7.1: auto-materialization fills empty slots with orphan AI
      // rosters. Orphans are placeholder seats that get evicted when a human
      // joins (evictOrphanForNewHumanRoster), so they must NOT count toward
      // capacity for the "is this league full?" check.
      prisma.roster.count({
        where: {
          leagueId: link.targetId,
          NOT: { platformUserId: { startsWith: 'orphan-' } },
        },
      }),
    ])

    if (!league) {
      return buildPreviewResult({
        inviteType: 'league',
        token: link.token,
        title: buildDefaultInviteTitle('league'),
        status: 'invalid',
        inviteUrl,
      })
    }

    const memberCount = humanRosterCount
    const maxMembers = league.leagueSize ?? null
    const isFull = maxMembers != null && memberCount >= maxMembers
    const status: InvitePreviewStatus = expired
      ? 'expired'
      : maxUsed
        ? 'max_used'
        : existingRoster
          ? 'already_member'
          : isFull
            ? 'full'
            : 'valid'

    return buildPreviewResult({
      inviteType: 'league',
      token: link.token,
      title: league.name ?? buildDefaultInviteTitle('league'),
      description:
        textOrNull(metadata.description) ?? buildDefaultInviteDescription('league', createdByLabel),
      targetId: league.id,
      targetName: league.name,
      sport: league.sport,
      memberCount,
      maxMembers,
      isFull,
      expired,
      expiresAt: link.expiresAt,
      useCount: link.useCount,
      maxUses: link.maxUses,
      status,
      previewImageUrl: textOrNull(metadata.previewImageUrl) ?? league.avatarUrl ?? null,
      createdByLabel,
      inviteUrl,
    })
  }

  if (link.type === 'bracket' && link.targetId) {
    const [league, existingMembership] = await Promise.all([
      prisma.bracketLeague.findUnique({
        where: { id: link.targetId },
        select: {
          id: true,
          name: true,
          maxManagers: true,
          _count: { select: { members: true } },
          tournament: {
            select: { name: true, season: true },
          },
        },
      }),
      options?.userId
        ? prisma.bracketLeagueMember.findUnique({
            where: {
              leagueId_userId: {
                leagueId: link.targetId,
                userId: options.userId,
              },
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ])

    if (!league) {
      return buildPreviewResult({
        inviteType: 'bracket',
        token: link.token,
        title: buildDefaultInviteTitle('bracket'),
        status: 'invalid',
        inviteUrl,
      })
    }

    const memberCount = league._count.members
    const maxMembers = Number(league.maxManagers) || 100
    const isFull = memberCount >= maxMembers
    const status: InvitePreviewStatus = expired
      ? 'expired'
      : maxUsed
        ? 'max_used'
        : existingMembership
          ? 'already_member'
          : isFull
            ? 'full'
            : 'valid'

    return buildPreviewResult({
      inviteType: 'bracket',
      token: link.token,
      title: league.name,
      description:
        textOrNull(metadata.description) ??
        `Join ${league.tournament?.name ?? 'this tournament'} on AllFantasy.`,
      targetId: league.id,
      targetName: league.tournament?.name ?? league.name,
      memberCount,
      maxMembers,
      isFull,
      expired,
      expiresAt: link.expiresAt,
      useCount: link.useCount,
      maxUses: link.maxUses,
      status,
      createdByLabel,
      inviteUrl,
    })
  }

  if (link.type === 'creator_league' && link.targetId) {
    const [league, existingMembership] = await Promise.all([
      prisma.creatorLeague.findUnique({
        where: { id: link.targetId },
        select: {
          id: true,
          name: true,
          description: true,
          sport: true,
          memberCount: true,
          maxMembers: true,
          coverImageUrl: true,
          communitySummary: true,
          creator: {
            select: {
              displayName: true,
              bannerUrl: true,
              user: {
                select: {
                  displayName: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      }),
      options?.userId
        ? prisma.creatorLeagueMember.findUnique({
            where: {
              creatorLeagueId_userId: {
                creatorLeagueId: link.targetId,
                userId: options.userId,
              },
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ])

    if (!league) {
      return buildPreviewResult({
        inviteType: 'creator_league',
        token: link.token,
        title: buildDefaultInviteTitle('creator_league'),
        status: 'invalid',
        inviteUrl,
      })
    }

    const isFull = league.maxMembers > 0 && league.memberCount >= league.maxMembers
    const creatorName =
      league.creator.displayName || league.creator.user.displayName || createdByLabel || null
    const status: InvitePreviewStatus = expired
      ? 'expired'
      : maxUsed
        ? 'max_used'
        : existingMembership
          ? 'already_member'
          : isFull
            ? 'full'
            : 'valid'

    return buildPreviewResult({
      inviteType: 'creator_league',
      token: link.token,
      title: league.name,
      description:
        textOrNull(metadata.description) ??
        league.description ??
        league.communitySummary ??
        buildDefaultInviteDescription('creator_league', creatorName),
      targetId: league.id,
      targetName: creatorName ? `${creatorName}'s community` : league.name,
      sport: league.sport,
      memberCount: league.memberCount,
      maxMembers: league.maxMembers,
      isFull,
      expired,
      expiresAt: link.expiresAt,
      useCount: link.useCount,
      maxUses: link.maxUses,
      status,
      previewImageUrl:
        textOrNull(metadata.previewImageUrl) ??
        league.coverImageUrl ??
        league.creator.bannerUrl ??
        league.creator.user.avatarUrl ??
        null,
      createdByLabel: creatorName,
      inviteUrl,
    })
  }

  if (link.type === 'referral') {
    const existingSignup = options?.userId
      ? await prisma.referralEvent.findFirst({
          where: { referredUserId: options.userId },
          select: { referrerId: true },
        })
      : null

    const status: InvitePreviewStatus = expired
      ? 'expired'
      : maxUsed
        ? 'max_used'
        : existingSignup
          ? 'already_redeemed'
          : 'valid'

    return buildPreviewResult({
      inviteType: 'referral',
      token: link.token,
      title: textOrNull(metadata.title) ?? buildDefaultInviteTitle('referral'),
      description:
        textOrNull(metadata.description) ?? buildDefaultInviteDescription('referral', createdByLabel),
      sport: textOrNull(metadata.sport),
      expired,
      expiresAt: link.expiresAt,
      useCount: link.useCount,
      maxUses: link.maxUses,
      status,
      createdByLabel,
      inviteUrl,
    })
  }

  if (link.type === 'reactivation' || link.type === 'waitlist') {
    const type = link.type as InviteType
    const status: InvitePreviewStatus = expired ? 'expired' : maxUsed ? 'max_used' : 'valid'
    return buildPreviewResult({
      inviteType: type,
      token: link.token,
      title: textOrNull(metadata.title) ?? buildDefaultInviteTitle(type),
      description:
        textOrNull(metadata.description) ?? buildDefaultInviteDescription(type, createdByLabel),
      sport: textOrNull(metadata.sport),
      expired,
      expiresAt: link.expiresAt,
      useCount: link.useCount,
      maxUses: link.maxUses,
      status,
      createdByLabel,
      inviteUrl,
    })
  }

  return buildPreviewResult({
    inviteType: link.type as InviteType,
    token: link.token,
    title: buildDefaultInviteTitle(link.type as InviteType),
    description: textOrNull(metadata.description),
    expired,
    expiresAt: link.expiresAt,
    useCount: link.useCount,
    maxUses: link.maxUses,
    status: expired ? 'expired' : maxUsed ? 'max_used' : 'valid',
    createdByLabel,
    inviteUrl,
  })
}

export async function createInviteLink(
  createdByUserId: string,
  type: InviteType,
  options: {
    targetId?: string | null
    expiresAt?: Date | null
    maxUses?: number
    metadata?: Record<string, unknown>
    baseUrl?: string
  } = {}
): Promise<
  | { ok: true; inviteLink: { id: string; token: string; inviteUrl: string; previewUrl: string; deepLinkUrl: string; destinationHref: string | null }; link: import('@prisma/client').InviteLink }
  | { ok: false; error: string }
> {
  const {
    targetId = null,
    expiresAt = null,
    maxUses = 0,
    metadata = null,
    baseUrl,
  } = options

  const since = new Date()
  since.setDate(since.getDate() - 1)
  const recentCount = await prisma.inviteLink.count({
    where: {
      createdByUserId,
      type,
      createdAt: { gte: since },
    },
  })
  if (recentCount >= MAX_ACTIVE_PER_USER_PER_DAY) {
    return { ok: false, error: 'Rate limit: too many invites created' }
  }

  let token = ''
  for (let attempt = 0; attempt < TOKEN_MAX_ATTEMPTS; attempt++) {
    token = normalizeToken(generateInviteToken(10))
    const existing = await prisma.inviteLink.findUnique({ where: { token }, select: { id: true } })
    if (!existing) break
  }
  if (!token) token = normalizeToken(generateInviteToken(10) + Date.now().toString(36).slice(-4))

  const link = await prisma.inviteLink.create({
    data: {
      type,
      token,
      createdByUserId,
      targetId,
      expiresAt,
      maxUses: Math.max(0, Math.floor(maxUses ?? 0)),
      status: 'active',
      metadata: metadataToRecord(metadata ?? {}) as object,
    },
  })

  const inviteUrl = buildInviteUrl(link.token, baseUrl ?? baseUrlFallback())
  return {
    ok: true,
    inviteLink: {
      id: link.id,
      token: link.token,
      inviteUrl,
      previewUrl: inviteUrl,
      deepLinkUrl: buildInviteDeepLink(link.token),
      destinationHref: buildInviteDestinationHref(type, targetId),
    },
    link,
  }
}

export async function getInviteByToken(token: string) {
  const link = await fetchInviteLinkByToken(token)
  if (!link) return null
  const nextStatus = await updateInviteLifecycle(link)
  return nextStatus === link.status ? link : { ...link, status: nextStatus }
}

/** Public-safe preview: resolve unified invite links first, then legacy invite codes. */
export async function getInvitePreview(
  code: string | null | undefined,
  options?: { userId?: string | null; baseUrl?: string | null }
): Promise<InvitePreviewDto> {
  const token = normalizeToken(code)
  const inviteUrl = buildInviteUrl(token, options?.baseUrl ?? baseUrlFallback())

  if (!token) {
    return buildPreviewResult({
      inviteType: 'league',
      token: '',
      title: 'Invalid invite',
      status: 'invalid',
      inviteUrl,
    })
  }

  const link = await getInviteByToken(token)
  if (link) {
    return buildInvitePreviewFromLink(link, options)
  }

  const fantasyValidation = await validateFantasyInviteCode(token, { userId: options?.userId ?? undefined })
  if (fantasyValidation.valid || fantasyValidation.preview) {
    const preview = fantasyValidation.preview!
    const status: InvitePreviewStatus = fantasyValidation.valid
      ? 'valid'
      : fantasyValidation.error === 'EXPIRED'
        ? 'expired'
        : fantasyValidation.error === 'LEAGUE_FULL'
          ? 'full'
          : fantasyValidation.error === 'ALREADY_MEMBER'
            ? 'already_member'
            : 'invalid'

    return buildPreviewResult({
      inviteType: 'league',
      token,
      title: preview.name ?? buildDefaultInviteTitle('league'),
      description: buildDefaultInviteDescription('league'),
      targetId: preview.leagueId,
      targetName: preview.name,
      sport: preview.sport,
      memberCount: preview.memberCount,
      maxMembers: preview.leagueSize,
      isFull: preview.leagueSize != null && preview.memberCount >= preview.leagueSize,
      expired: preview.expired,
      status,
      inviteUrl,
    })
  }

  const bracketValidation = await validateInviteCode(token, { userId: options?.userId ?? undefined })
  if (bracketValidation.valid || bracketValidation.preview) {
    const preview = bracketValidation.preview!
    const status: InvitePreviewStatus = bracketValidation.valid
      ? 'valid'
      : bracketValidation.error === 'EXPIRED'
        ? 'expired'
        : bracketValidation.error === 'LEAGUE_FULL'
          ? 'full'
          : bracketValidation.error === 'ALREADY_MEMBER'
            ? 'already_member'
            : 'invalid'

    return buildPreviewResult({
      inviteType: 'bracket',
      token,
      title: preview.name,
      description: preview.tournamentName,
      targetId: preview.leagueId,
      targetName: preview.tournamentName,
      memberCount: preview.memberCount,
      maxMembers: preview.maxManagers,
      isFull: preview.isFull,
      expired: preview.expired,
      status,
      inviteUrl,
    })
  }

  const creatorInvite = await prisma.creatorInvite.findUnique({
    where: { code: token },
    include: {
      league: {
        include: {
          creator: {
            include: {
              user: {
                select: {
                  displayName: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      },
    },
  })
  if (creatorInvite?.league) {
    const league = creatorInvite.league
    const expired = Boolean(creatorInvite.expiresAt && creatorInvite.expiresAt.getTime() < Date.now())
    const full = league.maxMembers > 0 && league.memberCount >= league.maxMembers
    const alreadyMember = options?.userId
      ? await prisma.creatorLeagueMember.findUnique({
          where: {
            creatorLeagueId_userId: {
              creatorLeagueId: league.id,
              userId: options.userId,
            },
          },
          select: { id: true },
        })
      : null

    return buildPreviewResult({
      inviteType: 'creator_league',
      token,
      title: league.name,
      description: league.description ?? league.communitySummary ?? buildDefaultInviteDescription('creator_league'),
      targetId: league.id,
      targetName:
        league.creator.displayName ||
        league.creator.user.displayName ||
        league.name,
      sport: league.sport,
      memberCount: league.memberCount,
      maxMembers: league.maxMembers,
      isFull: full,
      expired,
      expiresAt: creatorInvite.expiresAt,
      status: expired ? 'expired' : alreadyMember ? 'already_member' : full ? 'full' : 'valid',
      previewImageUrl: league.coverImageUrl ?? league.creator.user.avatarUrl ?? null,
      createdByLabel: league.creator.displayName || league.creator.user.displayName || null,
      inviteUrl,
    })
  }

  return buildPreviewResult({
    inviteType: 'league',
    token,
    title: 'Invalid invite',
    status: 'invalid',
    inviteUrl,
  })
}

export async function acceptInvite(
  code: string,
  userId: string,
  requestMeta?: { ip?: string | null; userAgent?: string | null; deviceId?: string | null }
): Promise<
  | {
      ok: true
      targetId?: string
      inviteType: string
      alreadyMember?: boolean
      alreadyRedeemed?: boolean
      destinationHref?: string | null
      pendingReview?: boolean
    }
  | { ok: false; error: string }
> {
  const token = normalizeToken(code)
  if (!token) return { ok: false, error: 'Invalid code' }

  const link = await getInviteByToken(token)
  if (link) {
    const lifecycle = deriveInviteStatus({
      status: link.status,
      expiresAt: link.expiresAt,
      maxUses: link.maxUses,
      useCount: link.useCount,
    })
    if (lifecycle !== 'active') {
      if (lifecycle === 'expired') return { ok: false, error: 'Invite expired' }
      if (lifecycle === 'max_used') return { ok: false, error: 'Invite limit reached' }
      return { ok: false, error: 'Invite no longer valid' }
    }

    if (link.type === 'league' && link.targetId) {
      if (requestMeta) {
        const { recordIdentitySignal } = await import('@/lib/identity/IdentitySignalRecorder')
        await recordIdentitySignal({
          userId,
          ip: requestMeta.ip,
          userAgent: requestMeta.userAgent,
          deviceId: requestMeta.deviceId,
          context: 'league_join',
          contextId: link.targetId,
        })
      }

      const result = await createFantasyLeagueRoster(link.targetId, userId, { inviteLinkId: link.id })
      if (!result.ok) return { ok: false, error: result.error }
      if (result.pendingReview) {
        // High duplicate-manager risk — held for commissioner/admin review. No
        // roster created, invite use count NOT incremented (join hasn't happened
        // yet); see DuplicateManagerFlagService.resolveDuplicateManagerFlag for
        // how an "allow"/"household" decision later completes this same join.
        await recordInviteEvent(link.id, 'accepted', undefined, { userId, pendingReview: true })
        return {
          ok: true,
          targetId: link.targetId,
          inviteType: 'league',
          alreadyMember: false,
          pendingReview: true,
          destinationHref: null,
        }
      }
      if (!result.alreadyMember) {
        await incrementInviteUseCount(link.id, link.useCount, link.maxUses)
      }

      // Slice 7.1: rebalance the draft so the new human takes the lowest
      // available orphan slot. Best-effort — never breaks invite acceptance.
      try {
        const joinedRoster = await prisma.roster.findUnique({
          where: { leagueId_platformUserId: { leagueId: link.targetId, platformUserId: userId } },
          select: { id: true },
        })
        if (joinedRoster) {
          const { evictOrphanForNewHumanRoster } = await import('@/lib/league-setup/evictOrphanForNewHumanRoster')
          const profile = await prisma.userProfile.findFirst({
            where: { userId },
            select: { displayName: true, sleeperUsername: true },
          })
          const humanDisplayName =
            profile?.displayName?.trim() || profile?.sleeperUsername?.trim() || null
          const rebalance = await evictOrphanForNewHumanRoster({
            leagueId: link.targetId,
            humanRosterId: joinedRoster.id,
            humanDisplayName,
          })
          if (rebalance.ok && rebalance.rebalanced) {
            console.info('[invite-engine] slot_rebalanced', {
              leagueId: link.targetId,
              humanRosterId: joinedRoster.id,
              slotIndex: rebalance.slotIndex,
              evictedRosterId: rebalance.evictedRosterId,
              picksRemapped: rebalance.picksRemapped,
              orphanDeleted: rebalance.orphanDeleted,
            })
          } else if (rebalance.ok) {
            console.info('[invite-engine] slot_rebalance_skipped', {
              leagueId: link.targetId,
              humanRosterId: joinedRoster.id,
              reason: rebalance.reason,
            })
          } else {
            console.warn('[invite-engine] slot_rebalance_error', {
              leagueId: link.targetId,
              error: rebalance.error,
            })
          }
        }
      } catch (e) {
        console.warn('[invite-engine] slot_rebalance_non_fatal', e)
      }

      await recordInviteEvent(link.id, 'accepted', undefined, {
        userId,
        alreadyMember: result.alreadyMember,
      })
      return {
        ok: true,
        targetId: link.targetId,
        inviteType: 'league',
        alreadyMember: result.alreadyMember,
        destinationHref: buildInviteDestinationHref('league', link.targetId),
      }
    }

    if (link.type === 'bracket' && link.targetId) {
      const existing = await prisma.bracketLeagueMember.findUnique({
        where: { leagueId_userId: { leagueId: link.targetId, userId } },
      })
      if (existing) {
        await recordInviteEvent(link.id, 'accepted', undefined, { userId, alreadyMember: true })
        return {
          ok: true,
          targetId: link.targetId,
          inviteType: 'bracket',
          alreadyMember: true,
          destinationHref: buildInviteDestinationHref('bracket', link.targetId),
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.bracketLeagueMember.create({
          data: { leagueId: link.targetId!, userId, role: 'MEMBER' },
        })
        await tx.growthAttribution.upsert({
          where: { userId },
          update: {
            source: 'competition_invite',
            sourceId: link.targetId,
            metadata: {
              inviteLinkId: link.id,
              token: link.token,
            },
          },
          create: {
            userId,
            source: 'competition_invite',
            sourceId: link.targetId,
            metadata: {
              inviteLinkId: link.id,
              token: link.token,
            },
          },
        })
      })
      await incrementInviteUseCount(link.id, link.useCount, link.maxUses)
      await recordInviteEvent(link.id, 'accepted', undefined, { userId })
      return {
        ok: true,
        targetId: link.targetId,
        inviteType: 'bracket',
        destinationHref: buildInviteDestinationHref('bracket', link.targetId),
      }
    }

    if (link.type === 'creator_league' && link.targetId) {
      const result = await joinByInviteCode(token, userId)
      if (!result.success) return { ok: false, error: result.error ?? 'Join failed' }
      if (!result.alreadyMember) {
        await incrementInviteUseCount(link.id, link.useCount, link.maxUses)
      }
      await recordInviteEvent(link.id, 'accepted', undefined, {
        userId,
        alreadyMember: result.alreadyMember,
      })
      return {
        ok: true,
        targetId: result.creatorLeagueId ?? undefined,
        inviteType: 'creator_league',
        alreadyMember: result.alreadyMember,
        destinationHref: buildInviteDestinationHref('creator_league', result.creatorLeagueId),
      }
    }

    if (link.type === 'referral') {
      if (link.createdByUserId === userId) {
        return { ok: false, error: 'You cannot redeem your own referral invite' }
      }
      const existingReferral = await prisma.referralEvent.findFirst({
        where: { referredUserId: userId },
        select: { referrerId: true },
      })
      if (existingReferral) {
        if (existingReferral.referrerId === link.createdByUserId) {
          await recordInviteEvent(link.id, 'accepted', undefined, {
            userId,
            alreadyRedeemed: true,
          })
          return {
            ok: true,
            inviteType: 'referral',
            alreadyRedeemed: true,
            destinationHref: buildInviteDestinationHref('referral'),
          }
        }
        return { ok: false, error: 'Referral already claimed' }
      }

      const attribution = await attributeSignupToReferrer(userId, link.createdByUserId)
      if (!attribution?.referrerId) {
        return { ok: false, error: 'Referral already claimed' }
      }

      await prisma.growthAttribution.upsert({
        where: { userId },
        update: {
          source: 'referral',
          sourceId: link.createdByUserId,
          metadata: {
            inviteLinkId: link.id,
            token: link.token,
          },
        },
        create: {
          userId,
          source: 'referral',
          sourceId: link.createdByUserId,
          metadata: {
            inviteLinkId: link.id,
            token: link.token,
          },
        },
      })
      await grantRewardForSignup(attribution.referrerId)
      await incrementInviteUseCount(link.id, link.useCount, link.maxUses)
      await recordInviteEvent(link.id, 'accepted', undefined, { userId })
      return {
        ok: true,
        inviteType: 'referral',
        destinationHref: buildInviteDestinationHref('referral'),
      }
    }

    await incrementInviteUseCount(link.id, link.useCount, link.maxUses)
    await recordInviteEvent(link.id, 'accepted', undefined, { userId })
    return {
      ok: true,
      inviteType: link.type,
      destinationHref: buildInviteDestinationHref(link.type as InviteType, link.targetId),
    }
  }

  const fantasyValidation = await validateFantasyInviteCode(token, { userId })
  if (fantasyValidation.valid) {
    const result = await createFantasyLeagueRoster(fantasyValidation.preview.leagueId, userId)
    if (!result.ok) return { ok: false, error: result.error }
    return {
      ok: true,
      targetId: fantasyValidation.preview.leagueId,
      inviteType: 'league',
      alreadyMember: result.alreadyMember,
      destinationHref: buildInviteDestinationHref('league', fantasyValidation.preview.leagueId),
    }
  }
  if (fantasyValidation.error === 'ALREADY_MEMBER' && fantasyValidation.preview?.leagueId) {
    return {
      ok: true,
      targetId: fantasyValidation.preview.leagueId,
      inviteType: 'league',
      alreadyMember: true,
      destinationHref: buildInviteDestinationHref('league', fantasyValidation.preview.leagueId),
    }
  }

  const bracketValidation = await validateInviteCode(token, { userId })
  if (bracketValidation.valid) {
    await prisma.bracketLeagueMember.upsert({
      where: { leagueId_userId: { leagueId: bracketValidation.preview.leagueId, userId } },
      update: {},
      create: { leagueId: bracketValidation.preview.leagueId, userId, role: 'MEMBER' },
    })
    return {
      ok: true,
      targetId: bracketValidation.preview.leagueId,
      inviteType: 'bracket',
      destinationHref: buildInviteDestinationHref('bracket', bracketValidation.preview.leagueId),
    }
  }
  if (bracketValidation.error === 'ALREADY_MEMBER' && bracketValidation.preview?.leagueId) {
    return {
      ok: true,
      targetId: bracketValidation.preview.leagueId,
      inviteType: 'bracket',
      alreadyMember: true,
      destinationHref: buildInviteDestinationHref('bracket', bracketValidation.preview.leagueId),
    }
  }

  const creatorResult = await joinByInviteCode(token, userId)
  if (creatorResult.success) {
    return {
      ok: true,
      targetId: creatorResult.creatorLeagueId ?? undefined,
      inviteType: 'creator_league',
      alreadyMember: creatorResult.alreadyMember,
      destinationHref: buildInviteDestinationHref('creator_league', creatorResult.creatorLeagueId),
    }
  }

  return { ok: false, error: creatorResult.error ?? 'Invalid or expired invite' }
}

export async function recordInviteEvent(
  inviteLinkId: string,
  eventType: InviteEventType | string,
  channel?: string | null,
  metadata?: Record<string, unknown>
) {
  await prisma.inviteLinkEvent.create({
    data: {
      inviteLinkId,
      eventType: String(eventType),
      channel: channel ?? undefined,
      metadata: (metadataToRecord(metadata ?? {}) as object) || {},
    },
  })
}

function buildLinkDto(
  link: {
    id: string
    type: string
    token: string
    createdByUserId: string
    targetId: string | null
    expiresAt: Date | null
    maxUses: number
    useCount: number
    status: string
    metadata: unknown
    createdAt: Date
    updatedAt: Date
  },
  baseUrl: string,
  eventCountMap: Map<string, Record<string, number>>
): InviteLinkDto {
  const nextStatus = deriveInviteStatus({
    status: link.status,
    expiresAt: link.expiresAt,
    maxUses: link.maxUses,
    useCount: link.useCount,
  })
  const counts = eventCountMap.get(link.id) ?? {}
  const inviteUrl = buildInviteUrl(link.token, baseUrl)
  return {
    id: link.id,
    type: link.type,
    token: link.token,
    createdByUserId: link.createdByUserId,
    targetId: link.targetId,
    expiresAt: toIsoString(link.expiresAt),
    maxUses: link.maxUses,
    useCount: link.useCount,
    status: nextStatus,
    metadata: metadataToRecord(link.metadata),
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
    inviteUrl,
    previewUrl: inviteUrl,
    deepLinkUrl: buildInviteDeepLink(link.token),
    destinationHref: buildInviteDestinationHref(link.type as InviteType, link.targetId),
    destinationLabel: buildInviteDestinationLabel(link.type as InviteType, link.targetId),
    viewCount: counts.viewed ?? 0,
    shareCount: counts.shared ?? 0,
    acceptedCount: counts.accepted ?? 0,
  }
}

export async function listMyInviteLinks(userId: string, type?: InviteType, baseUrl = baseUrlFallback()) {
  const where: { createdByUserId: string; type?: InviteType } = { createdByUserId: userId }
  if (type) where.type = type

  const links = await prisma.inviteLink.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  if (links.length === 0) return []

  const eventCounts = await prisma.inviteLinkEvent.groupBy({
    by: ['inviteLinkId', 'eventType'],
    where: { inviteLinkId: { in: links.map((entry) => entry.id) } },
    _count: { id: true },
  })

  const eventCountMap = new Map<string, Record<string, number>>()
  for (const row of eventCounts) {
    const entry = eventCountMap.get(row.inviteLinkId) ?? {}
    entry[row.eventType] = row._count.id
    eventCountMap.set(row.inviteLinkId, entry)
  }

  return links.map((link) => buildLinkDto(link, baseUrl, eventCountMap))
}

export async function getInviteStats(userId: string): Promise<InviteStatsDto> {
  const [links, byType, shareChannels, recentEvents, eventCounts, referredSignups] = await Promise.all([
    prisma.inviteLink.findMany({
      where: { createdByUserId: userId },
      select: {
        id: true,
        type: true,
        token: true,
        targetId: true,
        status: true,
        expiresAt: true,
        maxUses: true,
        useCount: true,
      },
    }),
    prisma.inviteLink.groupBy({
      by: ['type'],
      where: { createdByUserId: userId },
      _count: { id: true },
    }),
    prisma.inviteLinkEvent.groupBy({
      by: ['channel'],
      where: {
        eventType: 'shared',
        inviteLink: { createdByUserId: userId },
        channel: { not: null },
      },
      _count: { id: true },
    }),
    prisma.inviteLinkEvent.findMany({
      where: { inviteLink: { createdByUserId: userId } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        eventType: true,
        channel: true,
        createdAt: true,
        inviteLink: { select: { type: true } },
      },
    }),
    prisma.inviteLinkEvent.groupBy({
      by: ['inviteLinkId', 'eventType'],
      where: { inviteLink: { createdByUserId: userId } },
      _count: { id: true },
    }),
    prisma.referralEvent.count({
      where: { referrerId: userId, type: 'signup' },
    }),
  ])

  let activeLinks = 0
  let expiredLinks = 0
  let revokedLinks = 0
  let maxUsedLinks = 0

  const eventCountMap = new Map<string, Record<string, number>>()
  for (const row of eventCounts) {
    const entry = eventCountMap.get(row.inviteLinkId) ?? {}
    entry[row.eventType] = row._count.id
    eventCountMap.set(row.inviteLinkId, entry)
  }

  const topInvites = links
    .map((link) => {
      const lifecycle = deriveInviteStatus({
        status: link.status,
        expiresAt: link.expiresAt,
        maxUses: link.maxUses,
        useCount: link.useCount,
      })
      if (lifecycle === 'active') activeLinks += 1
      if (lifecycle === 'expired') expiredLinks += 1
      if (lifecycle === 'revoked') revokedLinks += 1
      if (lifecycle === 'max_used') maxUsedLinks += 1

      const counts = eventCountMap.get(link.id) ?? {}
      const views = counts.viewed ?? 0
      const shares = counts.shared ?? 0
      const accepted = counts.accepted ?? 0
      const denominator = Math.max(1, views || shares || 1)
      return {
        inviteLinkId: link.id,
        token: link.token,
        type: link.type,
        inviteUrl: buildInviteUrl(link.token, baseUrlFallback()),
        destinationHref: buildInviteDestinationHref(link.type as InviteType, link.targetId),
        viewCount: views,
        shareCount: shares,
        acceptedCount: accepted,
        conversionRate: Math.round((accepted / denominator) * 1000) / 1000,
      }
    })
    .sort((left, right) => {
      if (right.acceptedCount !== left.acceptedCount) return right.acceptedCount - left.acceptedCount
      if (right.shareCount !== left.shareCount) return right.shareCount - left.shareCount
      return right.viewCount - left.viewCount
    })
    .slice(0, 5)

  const totalCreated = links.length
  const totalAccepted = eventCounts
    .filter((row) => row.eventType === 'accepted')
    .reduce((total, row) => total + row._count.id, 0)
  const totalViews = eventCounts
    .filter((row) => row.eventType === 'viewed')
    .reduce((total, row) => total + row._count.id, 0)
  const totalShares = eventCounts
    .filter((row) => row.eventType === 'shared')
    .reduce((total, row) => total + row._count.id, 0)

  return {
    totalCreated,
    totalAccepted,
    totalViews,
    totalShares,
    activeLinks,
    expiredLinks,
    revokedLinks,
    maxUsedLinks,
    conversionRate: Math.round((totalAccepted / Math.max(1, totalViews || totalCreated)) * 1000) / 1000,
    byType: Object.fromEntries(byType.map((entry) => [entry.type, entry._count.id])),
    byChannel: Object.fromEntries(
      shareChannels.map((entry) => [entry.channel ?? 'unknown', entry._count.id])
    ),
    recentEvents: recentEvents.map((event) => ({
      eventType: event.eventType,
      channel: event.channel,
      type: event.inviteLink.type,
      createdAt: event.createdAt.toISOString(),
    })),
    topInvites,
    referredSignups,
  }
}

export async function revokeInviteLink(inviteLinkId: string, userId: string): Promise<boolean> {
  const link = await prisma.inviteLink.findFirst({
    where: { id: inviteLinkId, createdByUserId: userId },
  })
  if (!link) return false
  await prisma.inviteLink.update({
    where: { id: inviteLinkId },
    data: { status: 'revoked' },
  })
  return true
}
