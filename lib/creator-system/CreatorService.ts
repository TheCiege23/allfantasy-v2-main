/**
 * Creator League System (PROMPT 141) - service layer.
 * Handles creator profiles, branded leagues, invites, follows, analytics, and share URLs.
 */

import { prisma } from '@/lib/prisma'
import { isAdminEmailAllowed } from '@/lib/adminAuth'
import {
  clampCareerTier,
  extractLeagueCareerTier,
  getCareerTierName,
  isLeagueVisibleForCareerTier,
} from '@/lib/ranking/tier-visibility'
import { isSupportedSport } from '@/lib/sport-scope'
import type {
  CreatorAnalyticsSummaryDto,
  CreatorBranding,
  CreatorLeagueDto,
  CreatorLeaguePreviewDto,
  CreatorLeagueType,
  CreatorProfileDto,
  CreatorSocialHandles,
  CreatorVisibility,
  UpsertCreatorLeagueInput,
  UpsertCreatorProfileInput,
} from './types'

const CREATOR_ANALYTICS_EVENTS = [
  'profile_view',
  'follow',
  'league_join',
  'invite_share',
] as const

type CreatorAnalyticsEventType = (typeof CREATOR_ANALYTICS_EVENTS)[number]

function trimToNull(value: unknown, maxLength = 512): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

/** An absolute http(s) URL, or null. Rendered as a link, so no other scheme is safe. */
function httpUrlOrNull(value: string | null): string | null {
  if (!value) return null
  try {
    const u = new URL(value)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

function normalizeHexColor(value: unknown): string | null {
  const trimmed = trimToNull(value, 16)
  if (!trimmed) return null
  const normalized = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toUpperCase() : null
}

function isVisibleCreatorSetting(value: unknown): value is CreatorVisibility {
  return value === 'public' || value === 'unlisted' || value === 'private'
}

function sanitizeVisibility(value: unknown, fallback: CreatorVisibility = 'public'): CreatorVisibility {
  return isVisibleCreatorSetting(value) ? value : fallback
}

function coerceSocialHandles(value: unknown): CreatorSocialHandles | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const socialHandles: CreatorSocialHandles = {
    twitter: trimToNull(input.twitter, 64),
    youtube: trimToNull(input.youtube, 128),
    twitch: trimToNull(input.twitch, 64),
    instagram: trimToNull(input.instagram, 64),
    tiktok: trimToNull(input.tiktok, 64),
    podcast: trimToNull(input.podcast, 128),
  }
  return Object.values(socialHandles).some(Boolean) ? socialHandles : null
}

export function coerceCreatorBranding(value: unknown): CreatorBranding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const branding: CreatorBranding = {
    logoUrl: trimToNull(input.logoUrl),
    coverImageUrl: trimToNull(input.coverImageUrl),
    primaryColor: normalizeHexColor(input.primaryColor),
    accentColor: normalizeHexColor(input.accentColor),
    backgroundColor: normalizeHexColor(input.backgroundColor),
    tagline: trimToNull(input.tagline, 120),
    communityName: trimToNull(input.communityName, 120),
    fontFamily: trimToNull(input.fontFamily, 80),
    inviteHeadline: trimToNull(input.inviteHeadline, 140),
    cardStyle: trimToNull(input.cardStyle, 40),
  }
  return Object.values(branding).some(Boolean) ? branding : null
}

export function normalizeCreatorHandle(raw: string | null | undefined): string {
  const normalized = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/['\".,]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return normalized || 'creator'
}

export function normalizeCreatorSlug(raw: string | null | undefined): string {
  return normalizeCreatorHandle(raw)
}

function sanitizeCreatorType(raw: unknown): string | null {
  return trimToNull(raw, 32)
}

function normalizeLeagueType(raw: unknown): CreatorLeagueType {
  return raw === 'BRACKET' ? 'BRACKET' : 'FANTASY'
}

function normalizeSport(raw: unknown): string {
  const sport = trimToNull(raw, 16)?.toUpperCase()
  if (!sport || !isSupportedSport(sport)) {
    return 'NFL'
  }
  return sport
}

function clampMembers(raw: unknown): number {
  const num = Number(raw)
  if (!Number.isFinite(num)) return 100
  return Math.max(2, Math.min(5000, Math.round(num)))
}

function resolveBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function buildCreatorLeaguePreview(
  league: {
    id: string
    name: string
    sport: string
    inviteCode: string
    leagueTier?: number | null
    canJoinByRanking?: boolean
    inviteOnlyByTier?: boolean
  },
  baseUrl: string
): CreatorLeaguePreviewDto {
  return {
    id: league.id,
    name: league.name,
    sport: league.sport,
    inviteUrl: buildLeagueShareUrl(league.id, league.inviteCode, baseUrl),
    leagueTier: league.leagueTier ?? null,
    canJoinByRanking: league.canJoinByRanking ?? true,
    inviteOnlyByTier: league.inviteOnlyByTier ?? false,
  }
}

export function buildCreatorFeaturedScore(input: {
  followerCount?: number
  totalLeagueMembers?: number
  leagueCount?: number
  isVerified?: boolean
}): number {
  const followerWeight = (input.followerCount ?? 0) * 0.45
  const memberWeight = (input.totalLeagueMembers ?? 0) * 0.9
  const leagueWeight = (input.leagueCount ?? 0) * 6
  const verificationWeight = input.isVerified ? 35 : 0
  return Math.round((followerWeight + memberWeight + leagueWeight + verificationWeight) * 100) / 100
}

export function buildCreatorLeagueNarrative(input: {
  leagueName: string
  creatorName: string
  sport: string
  memberCount: number
  isPublic: boolean
}) {
  const visibilityLabel = input.isPublic ? 'open community' : 'private invite room'
  return {
    title: `${input.creatorName} recap: ${input.leagueName}`,
    summary: `${input.leagueName} is a ${visibilityLabel} for ${input.sport} fans, with ${input.memberCount} members already in the mix.`,
    commentary: `${input.creatorName} is leaning into a ${input.sport} room built around conversation, competition, and fast recap storytelling every week.`,
  }
}

export function buildCreatorAnalyticsSnapshot(input: {
  profileViews: number
  followCount: number
  leagueJoins: number
  inviteShares: number
  leagueMembers: number
  publicLeagues: number
  topShareChannel: string | null
  featuredRank: number | null
  periodDays: number
}): CreatorAnalyticsSummaryDto {
  const denominator = Math.max(1, input.profileViews)
  const conversionRate = Math.round((input.leagueJoins / denominator) * 1000) / 1000
  return {
    profileViews: input.profileViews,
    followCount: input.followCount,
    leagueJoins: input.leagueJoins,
    inviteShares: input.inviteShares,
    leagueMembers: input.leagueMembers,
    publicLeagues: input.publicLeagues,
    conversionRate,
    topShareChannel: input.topShareChannel,
    featuredRank: input.featuredRank,
    period: `${input.periodDays}d`,
  }
}

function canManageCreator(
  creator: { userId: string },
  viewerUserId?: string | null,
  viewerEmail?: string | null
) {
  return creator.userId === viewerUserId || isAdminEmailAllowed(viewerEmail)
}

function canViewCreator(
  creator: { userId: string; visibility: string },
  viewerUserId?: string | null,
  viewerEmail?: string | null
) {
  if (creator.visibility !== 'private') return true
  return canManageCreator(creator, viewerUserId, viewerEmail)
}

function canViewLeague(
  league: {
    inviteCode: string
    isPublic: boolean
    creator: { userId: string; visibility: string }
  },
  viewerUserId?: string | null,
  viewerEmail?: string | null,
  inviteCode?: string | null
) {
  if (!canViewCreator(league.creator, viewerUserId, viewerEmail)) return false
  if (league.isPublic) return true
  if (canManageCreator(league.creator, viewerUserId, viewerEmail)) return true
  return !!inviteCode && inviteCode.trim().toUpperCase() === league.inviteCode
}

async function ensureUniqueCreatorHandleAndSlug(
  desiredHandle: string,
  existingProfileId?: string
) {
  const baseHandle = normalizeCreatorHandle(desiredHandle)
  let handle = baseHandle
  let slug = normalizeCreatorSlug(baseHandle)
  let attempt = 0

  while (true) {
    const existing = await prisma.creatorProfile.findFirst({
      where: {
        OR: [{ handle }, { slug }],
        ...(existingProfileId ? { NOT: { id: existingProfileId } } : {}),
      },
      select: { id: true },
    })
    if (!existing) return { handle, slug }

    attempt += 1
    handle = `${baseHandle}-${attempt}`.slice(0, 48)
    slug = normalizeCreatorSlug(handle)
  }
}

async function ensureUniqueLeagueSlug(
  creatorId: string,
  desiredSlug: string,
  existingLeagueId?: string
) {
  const baseSlug = normalizeCreatorSlug(desiredSlug)
  let slug = baseSlug
  let attempt = 0

  while (true) {
    const existing = await prisma.creatorLeague.findFirst({
      where: {
        creatorId,
        slug,
        ...(existingLeagueId ? { NOT: { id: existingLeagueId } } : {}),
      },
      select: { id: true },
    })
    if (!existing) return slug

    attempt += 1
    slug = `${baseSlug}-${attempt}`.slice(0, 96)
  }
}

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let output = ''
  for (let index = 0; index < 10; index += 1) {
    output += chars[Math.floor(Math.random() * chars.length)]
  }
  return output
}

async function ensureUniqueInviteCode(existingLeagueId?: string) {
  let inviteCode = generateInviteCode()
  while (
    (await prisma.creatorLeague.findFirst({
      where: {
        inviteCode,
        ...(existingLeagueId ? { NOT: { id: existingLeagueId } } : {}),
      },
      select: { id: true },
    })) ||
    (await prisma.creatorInvite.findUnique({
      where: { code: inviteCode },
      select: { id: true },
    }))
  ) {
    inviteCode = generateInviteCode()
  }
  return inviteCode
}

async function syncCreatorLeagueInvite(league: {
  id: string
  creatorId: string
  inviteCode: string
}) {
  const existingInvite = await prisma.creatorInvite.findFirst({
    where: { creatorLeagueId: league.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })

  if (existingInvite) {
    await prisma.creatorInvite.update({
      where: { id: existingInvite.id },
      data: {
        code: league.inviteCode,
        metadata: {
          source: 'league_primary',
        },
      },
    })
    return
  }

  await prisma.creatorInvite.create({
    data: {
      creatorId: league.creatorId,
      creatorLeagueId: league.id,
      code: league.inviteCode,
      metadata: {
        source: 'league_primary',
      },
    },
  })
}

function buildTopSports(leagues: Array<{ sport: string }>) {
  const sportCounts = new Map<string, number>()
  for (const league of leagues) {
    sportCounts.set(league.sport, (sportCounts.get(league.sport) ?? 0) + 1)
  }
  return [...sportCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([sport]) => sport)
}

type CreatorLeagueTierSeed = {
  id: string
  type: string
  leagueId: string | null
  bracketLeagueId: string | null
}

type RankedCreatorLeaguePreview = {
  id: string
  name: string
  sport: string
  inviteCode: string
  leagueTier: number
  canJoinByRanking: boolean
  inviteOnlyByTier: boolean
}

function resolveCreatorLeagueTierWindow(
  viewerTier: number | null | undefined,
  leagueTier: number | null | undefined,
  options: {
    inviteOverride?: boolean
    visibilityBypass?: boolean
  } = {}
) {
  const safeViewerTier = clampCareerTier(viewerTier, 1)
  const safeLeagueTier = clampCareerTier(leagueTier, 1)
  const inWindow = isLeagueVisibleForCareerTier(safeViewerTier, safeLeagueTier)
  const inviteOverride = options.inviteOverride === true
  const visibilityBypass = options.visibilityBypass === true

  return {
    viewerTier: safeViewerTier,
    viewerTierName: getCareerTierName(safeViewerTier),
    leagueTier: safeLeagueTier,
    inWindow,
    canJoinByRanking: inWindow || inviteOverride,
    inviteOnlyByTier: !inWindow && !inviteOverride,
    visible: inWindow || inviteOverride || visibilityBypass,
  }
}

async function loadCreatorLeagueTierMap(
  leagues: CreatorLeagueTierSeed[]
): Promise<Map<string, number>> {
  const fantasyLeagueIds = [...new Set(leagues.map((league) => league.leagueId).filter(Boolean))]
  const bracketLeagueIds = [...new Set(leagues.map((league) => league.bracketLeagueId).filter(Boolean))]

  const [fantasyLeagues, bracketLeagues] = await Promise.all([
    fantasyLeagueIds.length
      ? prisma.league.findMany({
          where: { id: { in: fantasyLeagueIds as string[] } },
          select: {
            id: true,
            settings: true,
          },
        })
      : Promise.resolve([]),
    bracketLeagueIds.length
      ? prisma.bracketLeague.findMany({
          where: { id: { in: bracketLeagueIds as string[] } },
          select: {
            id: true,
            scoringRules: true,
          },
        })
      : Promise.resolve([]),
  ])

  const fantasyById = new Map(
    fantasyLeagues.map((league) => [league.id, extractLeagueCareerTier(league.settings, 1)])
  )
  const bracketById = new Map(
    bracketLeagues.map((league) => [league.id, extractLeagueCareerTier(league.scoringRules, 1)])
  )

  const tierByCreatorLeagueId = new Map<string, number>()
  for (const league of leagues) {
    const isBracket = String(league.type).toUpperCase() === 'BRACKET'
    const tier = isBracket
      ? bracketById.get(league.bracketLeagueId ?? '') ?? 1
      : fantasyById.get(league.leagueId ?? '') ?? 1
    tierByCreatorLeagueId.set(league.id, clampCareerTier(tier, 1))
  }

  return tierByCreatorLeagueId
}

function toProfileDto(
  profile: {
    id: string
    userId: string
    handle: string
    slug: string
    displayName: string | null
    creatorType: string | null
    bio: string | null
    communitySummary: string | null
    avatarUrl: string | null
    bannerUrl: string | null
    websiteUrl: string | null
    socialHandles: unknown
    verifiedAt: Date | null
    verificationBadge: string | null
    visibility: string
    communityVisibility: string
    branding: unknown
    featuredRank: number | null
    createdAt: Date
    updatedAt: Date
    user?: { avatarUrl: string | null; displayName: string | null } | null
    _count?: { leagues?: number }
  },
  options: {
    followerCount?: number
    totalLeagueMembers?: number
    isFollowing?: boolean
    leagueSample?: RankedCreatorLeaguePreview[]
    baseUrl?: string
    viewerTier?: number | null
    hiddenLeagueCount?: number
  } = {}
): CreatorProfileDto {
  const baseUrl = resolveBaseUrl(options.baseUrl ?? '')
  const leagueSample = options.leagueSample ?? []
  const featuredLeague = leagueSample[0]
    ? buildCreatorLeaguePreview(leagueSample[0], baseUrl)
    : null
  const followerCount = options.followerCount ?? 0
  const totalLeagueMembers = options.totalLeagueMembers ?? 0
  const leagueCount = profile._count?.leagues ?? leagueSample.length

  return {
    id: profile.id,
    userId: profile.userId,
    handle: profile.handle,
    slug: profile.slug,
    displayName: profile.displayName ?? profile.user?.displayName ?? profile.handle,
    creatorType: profile.creatorType,
    bio: profile.bio,
    communitySummary: profile.communitySummary,
    avatarUrl: profile.avatarUrl ?? profile.user?.avatarUrl ?? null,
    bannerUrl: profile.bannerUrl ?? null,
    websiteUrl: profile.websiteUrl,
    socialHandles: coerceSocialHandles(profile.socialHandles),
    isVerified: !!profile.verifiedAt,
    verificationBadge: profile.verificationBadge,
    visibility: sanitizeVisibility(profile.visibility),
    communityVisibility: sanitizeVisibility(profile.communityVisibility),
    branding: coerceCreatorBranding(profile.branding),
    followerCount,
    leagueCount,
    totalLeagueMembers,
    featuredRank: profile.featuredRank,
    featuredScore: buildCreatorFeaturedScore({
      followerCount,
      totalLeagueMembers,
      leagueCount,
      isVerified: !!profile.verifiedAt,
    }),
    isFollowing: options.isFollowing,
    topSports: buildTopSports(leagueSample),
    featuredLeague,
    viewerTier: options.viewerTier ?? null,
    viewerTierName:
      options.viewerTier != null ? getCareerTierName(clampCareerTier(options.viewerTier, 1)) : null,
    hiddenLeagueCount: options.hiddenLeagueCount ?? 0,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  }
}

function toLeagueDto(
  league: {
    id: string
    creatorId: string
    type: string
    leagueId: string | null
    bracketLeagueId: string | null
    name: string
    slug: string
    description: string | null
    sport: string
    inviteCode: string
    isPublic: boolean
    maxMembers: number
    memberCount: number
    joinDeadline: Date | null
    coverImageUrl: string | null
    communitySummary: string | null
    latestRecapTitle: string | null
    latestRecapSummary: string | null
    latestCommentary: string | null
    createdAt: Date
    updatedAt: Date
    creator?: Parameters<typeof toProfileDto>[0]
    isMember?: boolean
  },
  baseUrl: string,
  options: {
    viewerTier?: number | null
    leagueTier?: number | null
    canJoinByRanking?: boolean
    inviteOnlyByTier?: boolean
  } = {}
): CreatorLeagueDto {
  const creatorDisplayName =
    league.creator?.displayName ??
    league.creator?.user?.displayName ??
    league.creator?.handle ??
    'Creator'
  const generatedNarrative = buildCreatorLeagueNarrative({
    leagueName: league.name,
    creatorName: creatorDisplayName,
    sport: league.sport,
    memberCount: league.memberCount,
    isPublic: league.isPublic,
  })

  return {
    id: league.id,
    creatorId: league.creatorId,
    type: normalizeLeagueType(league.type),
    leagueId: league.leagueId,
    bracketLeagueId: league.bracketLeagueId,
    name: league.name,
    slug: league.slug,
    description: league.description,
    sport: league.sport,
    inviteCode: league.inviteCode,
    inviteUrl: buildLeagueShareUrl(league.id, league.inviteCode, baseUrl),
    shareUrl: `${resolveBaseUrl(baseUrl)}/creator/leagues/${league.id}`,
    isPublic: league.isPublic,
    maxMembers: league.maxMembers,
    memberCount: league.memberCount,
    fillRate: league.maxMembers > 0 ? Math.min(1, league.memberCount / league.maxMembers) : 0,
    joinDeadline: league.joinDeadline?.toISOString() ?? null,
    coverImageUrl: league.coverImageUrl ?? coerceCreatorBranding(league.creator?.branding)?.coverImageUrl ?? null,
    communitySummary: league.communitySummary,
    latestRecapTitle: league.latestRecapTitle ?? generatedNarrative.title,
    latestRecapSummary: league.latestRecapSummary ?? generatedNarrative.summary,
    latestCommentary: league.latestCommentary ?? generatedNarrative.commentary,
    creator: league.creator ? toProfileDto(league.creator, { baseUrl }) : null,
    isMember: league.isMember,
    leagueTier: options.leagueTier ?? null,
    canJoinByRanking: options.canJoinByRanking ?? true,
    inviteOnlyByTier: options.inviteOnlyByTier ?? false,
    viewerTier: options.viewerTier ?? null,
    viewerTierName:
      options.viewerTier != null ? getCareerTierName(clampCareerTier(options.viewerTier, 1)) : null,
    createdAt: league.createdAt.toISOString(),
    updatedAt: league.updatedAt.toISOString(),
  }
}

export async function getCreators(options: {
  visibility?: 'public' | 'unlisted' | 'all'
  sport?: string
  limit?: number
  cursor?: string
  baseUrl?: string
  viewerTier?: number | null
}) {
  const { visibility = 'public', sport, limit = 24, cursor, baseUrl = '', viewerTier } = options
  const where: {
    visibility?: string
    leagues?: { some: { sport?: string; isPublic?: boolean } }
  } = {}
  const safeViewerTier = clampCareerTier(viewerTier, 1)

  if (visibility === 'public') where.visibility = 'public'
  else if (visibility === 'unlisted') where.visibility = 'unlisted'

  if (sport && isSupportedSport(sport.toUpperCase())) {
    where.leagues = { some: { sport: sport.toUpperCase(), isPublic: true } }
  }

  const profiles = await prisma.creatorProfile.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: [{ featuredRank: 'asc' }, { updatedAt: 'desc' }],
    include: {
      user: {
        select: {
          avatarUrl: true,
          displayName: true,
        },
      },
      _count: { select: { leagues: true } },
      leagues: {
        where: { isPublic: true },
        orderBy: [{ memberCount: 'desc' }, { updatedAt: 'desc' }],
        take: 3,
        select: {
          id: true,
          type: true,
          leagueId: true,
          bracketLeagueId: true,
          name: true,
          sport: true,
          inviteCode: true,
          memberCount: true,
        },
      },
    },
  })

  const list = profiles.slice(0, limit)
  const nextCursor = profiles.length > limit ? list[list.length - 1]?.id ?? null : null
  const tierMap = await loadCreatorLeagueTierMap(
    list.flatMap((profile) =>
      profile.leagues.map((league) => ({
        id: league.id,
        type: league.type,
        leagueId: league.leagueId,
        bracketLeagueId: league.bracketLeagueId,
      }))
    )
  )

  const creators = (
    await Promise.all(
    list.map(async (profile) => {
      const followerCount = await prisma.userFollow.count({
        where: { followeeId: profile.userId },
      })
      const rankedLeagueSample: RankedCreatorLeaguePreview[] = profile.leagues.map((league) => {
        const tierWindow = resolveCreatorLeagueTierWindow(safeViewerTier, tierMap.get(league.id) ?? 1)
        return {
          id: league.id,
          name: league.name,
          sport: league.sport,
          inviteCode: league.inviteCode,
          leagueTier: tierWindow.leagueTier,
          canJoinByRanking: tierWindow.canJoinByRanking,
          inviteOnlyByTier: tierWindow.inviteOnlyByTier,
        }
      })
      const visibleLeagueSample = rankedLeagueSample.filter((league) => league.canJoinByRanking)
      const totalLeagueMembers = profile.leagues
        .filter((league) => visibleLeagueSample.some((sample) => sample.id === league.id))
        .reduce((sum, league) => sum + league.memberCount, 0)

      return toProfileDto(profile, {
        followerCount,
        totalLeagueMembers,
        leagueSample: visibleLeagueSample,
        baseUrl,
        viewerTier: safeViewerTier,
        hiddenLeagueCount: Math.max(0, rankedLeagueSample.length - visibleLeagueSample.length),
      })
    })
  )
  ).filter((creator) => (creator.hiddenLeagueCount ?? 0) === 0 || !!creator.featuredLeague)

  return {
    creators,
    nextCursor,
  }
}

export async function getCreatorsLeaderboard(options?: {
  limit?: number
  sort?: 'members' | 'leagues'
}) {
  const limit = Math.min(50, Math.max(1, options?.limit ?? 25))
  const sort = options?.sort ?? 'members'

  const profiles = await prisma.creatorProfile.findMany({
    where: {
      visibility: 'public',
      verifiedAt: { not: null },
    },
    take: limit * 3,
    include: {
      user: { select: { avatarUrl: true, displayName: true } },
      _count: { select: { leagues: true } },
      leagues: {
        where: { isPublic: true },
        select: { memberCount: true },
      },
    },
  })

  const rows = profiles.map((profile) => {
    const totalMembers = profile.leagues.reduce((sum, league) => sum + league.memberCount, 0)
    return {
      userId: profile.userId,
      handle: profile.handle,
      slug: profile.slug,
      displayName: profile.displayName ?? profile.user?.displayName ?? profile.handle,
      avatarUrl: profile.avatarUrl ?? profile.user?.avatarUrl ?? null,
      verified: !!profile.verifiedAt,
      verificationBadge: profile.verificationBadge ?? null,
      leagueCount: profile._count?.leagues ?? 0,
      totalMembers,
    }
  })

  rows.sort((left, right) => {
    if (sort === 'leagues') {
      return right.leagueCount - left.leagueCount || right.totalMembers - left.totalMembers
    }
    return right.totalMembers - left.totalMembers || right.leagueCount - left.leagueCount
  })

  return rows.slice(0, limit).map((row, index) => ({
    ...row,
    rank: index + 1,
  }))
}

export async function getCreatorBySlugOrId(
  creatorIdOrSlug: string,
  viewerUserId?: string | null,
  viewerEmail?: string | null,
  baseUrl = '',
  viewerTier?: number | null
) {
  const safeViewerTier = clampCareerTier(viewerTier, 1)
  const isSlug = !/^[0-9a-f-]{36}$/i.test(creatorIdOrSlug)
  const profile = await prisma.creatorProfile.findFirst({
    where: isSlug ? { slug: creatorIdOrSlug } : { id: creatorIdOrSlug },
    include: {
      user: {
        select: {
          avatarUrl: true,
          displayName: true,
        },
      },
      _count: { select: { leagues: true } },
      leagues: {
        where: { isPublic: true },
        orderBy: [{ memberCount: 'desc' }, { updatedAt: 'desc' }],
        take: 3,
        select: {
          id: true,
          type: true,
          leagueId: true,
          bracketLeagueId: true,
          name: true,
          sport: true,
          inviteCode: true,
          memberCount: true,
          isPublic: true,
        },
      },
    },
  })
  if (!profile) return null
  if (!canViewCreator(profile, viewerUserId, viewerEmail)) return null

  const [followerCount, followRow] = await Promise.all([
    prisma.userFollow.count({
      where: { followeeId: profile.userId },
    }),
    viewerUserId
      ? prisma.userFollow.findUnique({
          where: {
            followerId_followeeId: {
              followerId: viewerUserId,
              followeeId: profile.userId,
            },
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ])

  const tierMap = await loadCreatorLeagueTierMap(
    profile.leagues.map((league) => ({
      id: league.id,
      type: league.type,
      leagueId: league.leagueId,
      bracketLeagueId: league.bracketLeagueId,
    }))
  )
  const rankedLeagueSample: RankedCreatorLeaguePreview[] = profile.leagues
    .filter((league) => league.isPublic)
    .map((league) => {
      const tierWindow = resolveCreatorLeagueTierWindow(safeViewerTier, tierMap.get(league.id) ?? 1)
      return {
        id: league.id,
        name: league.name,
        sport: league.sport,
        inviteCode: league.inviteCode,
        leagueTier: tierWindow.leagueTier,
        canJoinByRanking: tierWindow.canJoinByRanking,
        inviteOnlyByTier: tierWindow.inviteOnlyByTier,
      }
    })
  const visibleLeagueSample = rankedLeagueSample.filter((league) => league.canJoinByRanking)
  const totalLeagueMembers = profile.leagues
    .filter((league) => visibleLeagueSample.some((sample) => sample.id === league.id))
    .reduce((sum, league) => sum + league.memberCount, 0)

  return toProfileDto(profile, {
    followerCount,
    totalLeagueMembers,
    isFollowing: !!followRow,
    leagueSample: visibleLeagueSample,
    baseUrl,
    viewerTier: safeViewerTier,
    hiddenLeagueCount: Math.max(0, rankedLeagueSample.length - visibleLeagueSample.length),
  })
}

export async function getCreatorLeagues(
  creatorIdOrSlug: string,
  viewerUserId?: string | null,
  baseUrl = '',
  viewerEmail?: string | null,
  viewerTier?: number | null
) {
  const creator = await prisma.creatorProfile.findFirst({
    where: {
      OR: [{ id: creatorIdOrSlug }, { slug: creatorIdOrSlug }],
    },
    select: {
      id: true,
      userId: true,
      visibility: true,
    },
  })
  if (!creator) return []
  if (!canViewCreator(creator, viewerUserId, viewerEmail)) return []

  const manageAccess = canManageCreator(creator, viewerUserId, viewerEmail)
  const safeViewerTier = clampCareerTier(viewerTier, 1)
  const leagues = await prisma.creatorLeague.findMany({
    where: {
      creatorId: creator.id,
      ...(manageAccess ? {} : { isPublic: true }),
    },
    orderBy: [{ memberCount: 'desc' }, { updatedAt: 'desc' }],
    include: {
      creator: {
        include: {
          user: {
            select: {
              avatarUrl: true,
              displayName: true,
            },
          },
          _count: { select: { leagues: true } },
        },
      },
    },
  })
  const tierMap = await loadCreatorLeagueTierMap(
    leagues.map((league) => ({
      id: league.id,
      type: league.type,
      leagueId: league.leagueId,
      bracketLeagueId: league.bracketLeagueId,
    }))
  )

  const withMembership = await Promise.all(
    leagues.map(async (league) => {
      const membership = viewerUserId
        ? await prisma.creatorLeagueMember.findUnique({
            where: {
              creatorLeagueId_userId: {
                creatorLeagueId: league.id,
                userId: viewerUserId,
              },
            },
            select: { id: true },
          })
        : null
      const tierWindow = resolveCreatorLeagueTierWindow(safeViewerTier, tierMap.get(league.id) ?? 1, {
        visibilityBypass: !!manageAccess,
      })
      return {
        ...league,
        isMember: !!membership,
        tierWindow,
      }
    })
  )

  return withMembership
    .filter((league) => league.tierWindow.visible)
    .map((league) =>
      toLeagueDto(league, baseUrl, {
        viewerTier: safeViewerTier,
        leagueTier: league.tierWindow.leagueTier,
        canJoinByRanking: league.tierWindow.canJoinByRanking || !!league.isMember,
        inviteOnlyByTier: league.tierWindow.inviteOnlyByTier && !league.isMember,
      })
    )
}

export async function upsertCreatorProfile(
  userId: string,
  viewerEmail: string | null | undefined,
  input: UpsertCreatorProfileInput
) {
  const existing = await prisma.creatorProfile.findUnique({
    where: { userId },
  })

  const appUser = await prisma.appUser.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
    },
  })
  if (!appUser) return null

  const requestedHandle =
    trimToNull(input.handle, 48) ??
    existing?.handle ??
    trimToNull(appUser.displayName, 48) ??
    trimToNull(appUser.username, 48) ??
    'creator'
  const { handle, slug } = await ensureUniqueCreatorHandleAndSlug(requestedHandle, existing?.id)
  const branding = coerceCreatorBranding({
    ...(coerceCreatorBranding(existing?.branding) ?? {}),
    ...(input.branding ?? {}),
  })
  const socialHandles = coerceSocialHandles(input.socialHandles ?? existing?.socialHandles)
  const isAdmin = isAdminEmailAllowed(viewerEmail)
  const visibility = sanitizeVisibility(input.visibility, sanitizeVisibility(existing?.visibility))
  const communityVisibility = sanitizeVisibility(
    input.communityVisibility,
    sanitizeVisibility(existing?.communityVisibility, visibility)
  )

  const data = {
    handle,
    slug,
    displayName:
      trimToNull(input.displayName, 128) ??
      existing?.displayName ??
      appUser.displayName ??
      handle,
    creatorType: sanitizeCreatorType(input.creatorType ?? existing?.creatorType),
    bio: trimToNull(input.bio, 1000) ?? existing?.bio ?? null,
    communitySummary:
      trimToNull(input.communitySummary, 1200) ?? existing?.communitySummary ?? null,
    avatarUrl: trimToNull(input.avatarUrl) ?? existing?.avatarUrl ?? appUser.avatarUrl ?? null,
    bannerUrl: trimToNull(input.bannerUrl) ?? existing?.bannerUrl ?? null,
    // http(s) only — anything else (javascript:, data:) is dropped, never stored.
    websiteUrl: httpUrlOrNull(trimToNull(input.websiteUrl)) ?? existing?.websiteUrl ?? null,
    socialHandles: (socialHandles ?? undefined) as object | undefined,
    visibility,
    communityVisibility,
    branding: (branding ?? undefined) as object | undefined,
    verificationBadge: isAdmin
      ? trimToNull(input.verificationBadge, 32) ?? existing?.verificationBadge ?? null
      : existing?.verificationBadge ?? null,
    verifiedAt:
      isAdmin && input.isVerified
        ? existing?.verifiedAt ?? new Date()
        : isAdmin && input.isVerified === false
          ? null
          : existing?.verifiedAt ?? null,
    featuredRank:
      isAdmin && typeof input.featuredRank === 'number'
        ? Math.max(1, Math.min(999, Math.round(input.featuredRank)))
        : existing?.featuredRank ?? null,
    featuredAt:
      isAdmin && typeof input.featuredRank === 'number'
        ? existing?.featuredAt ?? new Date()
        : existing?.featuredAt ?? null,
  }

  const profile = existing
    ? await prisma.creatorProfile.update({
        where: { id: existing.id },
        data,
        include: {
          user: {
            select: {
              avatarUrl: true,
              displayName: true,
            },
          },
          _count: { select: { leagues: true } },
        },
      })
    : await prisma.creatorProfile.create({
        data: {
          userId,
          ...data,
        },
        include: {
          user: {
            select: {
              avatarUrl: true,
              displayName: true,
            },
          },
          _count: { select: { leagues: true } },
        },
      })

  const followerCount = await prisma.userFollow.count({
    where: { followeeId: profile.userId },
  })

  return toProfileDto(profile, {
    followerCount,
    totalLeagueMembers: 0,
  })
}

export async function updateCreatorBranding(
  creatorProfileId: string,
  userId: string,
  branding: CreatorBranding,
  viewerEmail?: string | null
) {
  const profile = await prisma.creatorProfile.findUnique({
    where: { id: creatorProfileId },
    select: {
      id: true,
      userId: true,
      branding: true,
    },
  })
  if (!profile || !canManageCreator(profile, userId, viewerEmail)) return null

  const mergedBranding = coerceCreatorBranding({
    ...(coerceCreatorBranding(profile.branding) ?? {}),
    ...(branding ?? {}),
  })

  const updated = await prisma.creatorProfile.update({
    where: { id: creatorProfileId },
    data: {
      branding: (mergedBranding ?? undefined) as object | undefined,
    },
    include: {
      user: {
        select: {
          avatarUrl: true,
          displayName: true,
        },
      },
      _count: { select: { leagues: true } },
    },
  })

  return toProfileDto(updated)
}

export async function createCreatorLeague(
  creatorId: string,
  userId: string,
  input: UpsertCreatorLeagueInput,
  baseUrl = '',
  viewerEmail?: string | null
) {
  const profile = await prisma.creatorProfile.findUnique({
    where: { id: creatorId },
    select: {
      id: true,
      userId: true,
      visibility: true,
    },
  })
  if (!profile || !canManageCreator(profile, userId, viewerEmail)) return null

  const name = trimToNull(input.name, 256)
  if (!name) return null

  const slug = await ensureUniqueLeagueSlug(profile.id, input.slug ?? name)
  const inviteCode = await ensureUniqueInviteCode()
  const league = await prisma.creatorLeague.create({
    data: {
      creatorId: profile.id,
      type: normalizeLeagueType(input.type),
      leagueId: trimToNull(input.leagueId, 64),
      bracketLeagueId: trimToNull(input.bracketLeagueId, 64),
      name,
      slug,
      description: trimToNull(input.description, 1200),
      sport: normalizeSport(input.sport),
      inviteCode,
      isPublic: input.isPublic ?? true,
      maxMembers: clampMembers(input.maxMembers),
      joinDeadline: input.joinDeadline ? new Date(input.joinDeadline) : null,
      coverImageUrl: trimToNull(input.coverImageUrl),
      communitySummary: trimToNull(input.communitySummary, 1200),
      latestRecapTitle: trimToNull(input.latestRecapTitle, 160),
      latestRecapSummary: trimToNull(input.latestRecapSummary, 1200),
      latestCommentary: trimToNull(input.latestCommentary, 2000),
    },
    include: {
      creator: {
        include: {
          user: {
            select: {
              avatarUrl: true,
              displayName: true,
            },
          },
          _count: { select: { leagues: true } },
        },
      },
    },
  })

  await syncCreatorLeagueInvite(league)
  return toLeagueDto(league, baseUrl)
}

export async function updateCreatorLeague(
  creatorLeagueId: string,
  userId: string,
  input: Partial<UpsertCreatorLeagueInput>,
  baseUrl = '',
  viewerEmail?: string | null
) {
  const existing = await prisma.creatorLeague.findUnique({
    where: { id: creatorLeagueId },
    include: {
      creator: {
        select: {
          id: true,
          userId: true,
          visibility: true,
        },
      },
    },
  })
  if (!existing || !canManageCreator(existing.creator, userId, viewerEmail)) return null

  const nextInviteCode = input.regenerateInvite
    ? await ensureUniqueInviteCode(existing.id)
    : existing.inviteCode
  const nextSlug = input.slug
    ? await ensureUniqueLeagueSlug(existing.creatorId, input.slug, existing.id)
    : existing.slug

  const updated = await prisma.creatorLeague.update({
    where: { id: creatorLeagueId },
    data: {
      type: input.type ? normalizeLeagueType(input.type) : existing.type,
      leagueId: input.leagueId !== undefined ? trimToNull(input.leagueId, 64) : undefined,
      bracketLeagueId:
        input.bracketLeagueId !== undefined ? trimToNull(input.bracketLeagueId, 64) : undefined,
      name: input.name !== undefined ? trimToNull(input.name, 256) ?? existing.name : undefined,
      slug: nextSlug,
      description:
        input.description !== undefined ? trimToNull(input.description, 1200) : undefined,
      sport: input.sport !== undefined ? normalizeSport(input.sport) : undefined,
      inviteCode: nextInviteCode,
      isPublic: input.isPublic,
      maxMembers: input.maxMembers !== undefined ? clampMembers(input.maxMembers) : undefined,
      joinDeadline:
        input.joinDeadline !== undefined
          ? input.joinDeadline
            ? new Date(input.joinDeadline)
            : null
          : undefined,
      coverImageUrl:
        input.coverImageUrl !== undefined ? trimToNull(input.coverImageUrl) : undefined,
      communitySummary:
        input.communitySummary !== undefined
          ? trimToNull(input.communitySummary, 1200)
          : undefined,
      latestRecapTitle:
        input.latestRecapTitle !== undefined ? trimToNull(input.latestRecapTitle, 160) : undefined,
      latestRecapSummary:
        input.latestRecapSummary !== undefined
          ? trimToNull(input.latestRecapSummary, 1200)
          : undefined,
      latestCommentary:
        input.latestCommentary !== undefined
          ? trimToNull(input.latestCommentary, 2000)
          : undefined,
    },
    include: {
      creator: {
        include: {
          user: {
            select: {
              avatarUrl: true,
              displayName: true,
            },
          },
          _count: { select: { leagues: true } },
        },
      },
    },
  })

  if (input.regenerateInvite) {
    await syncCreatorLeagueInvite(updated)
  }

  return toLeagueDto(updated, baseUrl)
}

export async function createInvite(
  creatorId: string,
  userId: string,
  creatorLeagueId?: string | null,
  viewerEmail?: string | null
) {
  const profile = await prisma.creatorProfile.findUnique({
    where: { id: creatorId },
    select: { id: true, userId: true },
  })
  if (!profile || !canManageCreator(profile, userId, viewerEmail)) return null

  const code = await ensureUniqueInviteCode()
  return prisma.creatorInvite.create({
    data: {
      creatorId,
      creatorLeagueId: creatorLeagueId || null,
      code,
      metadata: {
        source: creatorLeagueId ? 'manual_league' : 'manual_creator',
      },
    },
  })
}

async function joinCreatorLeagueByResolvedInvite(input: {
  creatorId: string
  inviteId: string | null
  inviteCode: string
  league: {
    id: string
    maxMembers: number
    memberCount: number
    joinDeadline: Date | null
  }
  userId: string
}): Promise<{
  success: boolean
  creatorLeagueId: string | null
  alreadyMember: boolean
  error?: string
}> {
  const existingMembership = await prisma.creatorLeagueMember.findUnique({
    where: {
      creatorLeagueId_userId: {
        creatorLeagueId: input.league.id,
        userId: input.userId,
      },
    },
  })
  if (existingMembership) {
    return { success: true, creatorLeagueId: input.league.id, alreadyMember: true }
  }

  if (input.league.maxMembers > 0 && input.league.memberCount >= input.league.maxMembers) {
    return { success: false, creatorLeagueId: null, alreadyMember: false, error: 'League is full' }
  }
  if (input.league.joinDeadline && input.league.joinDeadline < new Date()) {
    return { success: false, creatorLeagueId: null, alreadyMember: false, error: 'Join deadline passed' }
  }

  await prisma.$transaction(async (tx) => {
    await tx.creatorLeagueMember.create({
      data: {
        creatorLeagueId: input.league.id,
        userId: input.userId,
        joinedViaCode: input.inviteCode,
      },
    })
    await tx.creatorLeague.update({
      where: { id: input.league.id },
      data: { memberCount: { increment: 1 } },
    })
    await tx.growthAttribution.upsert({
      where: { userId: input.userId },
      update: {
        source: 'league_invite',
        sourceId: input.league.id,
        metadata: {
          creatorId: input.creatorId,
          inviteCode: input.inviteCode,
          source: 'creator_league',
        },
      },
      create: {
        userId: input.userId,
        source: 'league_invite',
        sourceId: input.league.id,
        metadata: {
          creatorId: input.creatorId,
          inviteCode: input.inviteCode,
          source: 'creator_league',
        },
      },
    })

    if (input.inviteId) {
      await tx.creatorInvite.update({
        where: { id: input.inviteId },
        data: { useCount: { increment: 1 } },
      })
    }
  })
  await logAnalytics(input.creatorId, 'league_join', input.league.id, {
    inviteCode: input.inviteCode,
    source: 'creator_league',
  })
  return { success: true, creatorLeagueId: input.league.id, alreadyMember: false }
}

export async function joinByInviteCode(
  code: string,
  userId: string
): Promise<{
  success: boolean
  creatorLeagueId: string | null
  alreadyMember: boolean
  error?: string
}> {
  const normalizedCode = code.trim().toUpperCase()
  if (!normalizedCode) {
    return { success: false, creatorLeagueId: null, alreadyMember: false, error: 'Invalid invite code' }
  }

  const invite = await prisma.creatorInvite.findUnique({
    where: { code: normalizedCode },
    include: { league: true },
  })

  if (invite) {
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      return { success: false, creatorLeagueId: null, alreadyMember: false, error: 'Invite expired' }
    }
    if (invite.maxUses > 0 && invite.useCount >= invite.maxUses) {
      return { success: false, creatorLeagueId: null, alreadyMember: false, error: 'Invite limit reached' }
    }

    if (invite.creatorLeagueId && invite.league) {
      return joinCreatorLeagueByResolvedInvite({
        creatorId: invite.creatorId,
        inviteId: invite.id,
        inviteCode: invite.code,
        league: invite.league,
        userId,
      })
    }

    await prisma.creatorInvite.update({
      where: { id: invite.id },
      data: { useCount: { increment: 1 } },
    })
    return { success: true, creatorLeagueId: null, alreadyMember: false }
  }

  const creatorLeague = await prisma.creatorLeague.findUnique({
    where: { inviteCode: normalizedCode },
    select: {
      id: true,
      creatorId: true,
      maxMembers: true,
      memberCount: true,
      joinDeadline: true,
    },
  })
  if (!creatorLeague) {
    return { success: false, creatorLeagueId: null, alreadyMember: false, error: 'Invalid invite code' }
  }

  return joinCreatorLeagueByResolvedInvite({
    creatorId: creatorLeague.creatorId,
    inviteId: null,
    inviteCode: normalizedCode,
    league: creatorLeague,
    userId,
  })
}

export async function followCreator(creatorProfileId: string, followerUserId: string) {
  const profile = await prisma.creatorProfile.findUnique({
    where: { id: creatorProfileId },
    select: { id: true, userId: true },
  })
  if (!profile) return { success: false, error: 'Creator not found' }
  if (profile.userId === followerUserId) return { success: false, error: 'Cannot follow yourself' }

  await prisma.userFollow.upsert({
    where: {
      followerId_followeeId: {
        followerId: followerUserId,
        followeeId: profile.userId,
      },
    },
    create: {
      followerId: followerUserId,
      followeeId: profile.userId,
    },
    update: {},
  })

  await logAnalytics(profile.id, 'follow', null, { source: 'follow_button' })
  return { success: true }
}

export async function unfollowCreator(creatorProfileId: string, followerUserId: string) {
  const profile = await prisma.creatorProfile.findUnique({
    where: { id: creatorProfileId },
    select: { userId: true },
  })
  if (!profile) return { success: false, error: 'Creator not found' }

  await prisma.userFollow.deleteMany({
    where: {
      followerId: followerUserId,
      followeeId: profile.userId,
    },
  })

  return { success: true }
}

export async function getCreatorLeagueByInviteCode(code: string, baseUrl = '') {
  const normalizedCode = code.trim().toUpperCase()
  if (!normalizedCode) return null

  const invite = await prisma.creatorInvite.findUnique({
    where: { code: normalizedCode },
    include: {
      league: {
        include: {
          creator: {
            include: {
              user: {
                select: {
                  avatarUrl: true,
                  displayName: true,
                },
              },
              _count: { select: { leagues: true } },
            },
          },
        },
      },
    },
  })

  if (invite?.league) return toLeagueDto(invite.league, baseUrl)

  const league = await prisma.creatorLeague.findUnique({
    where: { inviteCode: normalizedCode },
    include: {
      creator: {
        include: {
          user: {
            select: {
              avatarUrl: true,
              displayName: true,
            },
          },
          _count: { select: { leagues: true } },
        },
      },
    },
  })
  return league ? toLeagueDto(league, baseUrl) : null
}

export function buildShareUrl(creatorSlug: string, baseUrl: string): string {
  return `${resolveBaseUrl(baseUrl)}/creators/${encodeURIComponent(creatorSlug)}`
}

export function buildLeagueShareUrl(
  creatorLeagueId: string,
  inviteCode: string,
  baseUrl: string
): string {
  return `${resolveBaseUrl(baseUrl)}/creator/leagues/${encodeURIComponent(creatorLeagueId)}?join=${encodeURIComponent(inviteCode)}`
}

export async function logAnalytics(
  creatorId: string,
  eventType: CreatorAnalyticsEventType,
  leagueId?: string | null,
  metadata?: Record<string, unknown>
) {
  if (!CREATOR_ANALYTICS_EVENTS.includes(eventType)) return

  await prisma.creatorAnalyticsEvent.create({
    data: {
      creatorId,
      eventType,
      leagueId: leagueId ?? null,
      metadata: (metadata ?? {}) as object,
    },
  })
}

export async function getCreatorAnalyticsSummary(
  creatorId: string,
  userId: string,
  periodDays = 30,
  viewerEmail?: string | null
) {
  const profile = await prisma.creatorProfile.findUnique({
    where: { id: creatorId },
    select: {
      id: true,
      userId: true,
      featuredRank: true,
    },
  })
  if (!profile || !canManageCreator(profile, userId, viewerEmail)) return null

  const since = new Date()
  since.setDate(since.getDate() - periodDays)

  const [events, followCount, publicLeagueAggregate, publicLeagues] = await Promise.all([
    prisma.creatorAnalyticsEvent.findMany({
      where: {
        creatorId,
        createdAt: { gte: since },
      },
      select: {
        eventType: true,
        metadata: true,
      },
    }),
    prisma.userFollow.count({
      where: { followeeId: profile.userId },
    }),
    prisma.creatorLeague.aggregate({
      where: {
        creatorId,
        isPublic: true,
      },
      _sum: {
        memberCount: true,
      },
    }),
    prisma.creatorLeague.count({
      where: {
        creatorId,
        isPublic: true,
      },
    }),
  ])

  let profileViews = 0
  let leagueJoins = 0
  let inviteShares = 0
  const shareChannels = new Map<string, number>()

  for (const event of events) {
    if (event.eventType === 'profile_view') profileViews += 1
    if (event.eventType === 'league_join') leagueJoins += 1
    if (event.eventType === 'invite_share') {
      inviteShares += 1
      const channel =
        typeof (event.metadata as Record<string, unknown> | null)?.channel === 'string'
          ? String((event.metadata as Record<string, unknown>).channel)
          : 'direct'
      shareChannels.set(channel, (shareChannels.get(channel) ?? 0) + 1)
    }
  }

  const topShareChannel =
    [...shareChannels.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null

  return buildCreatorAnalyticsSnapshot({
    profileViews,
    followCount,
    leagueJoins,
    inviteShares,
    leagueMembers: publicLeagueAggregate._sum.memberCount ?? 0,
    publicLeagues,
    topShareChannel,
    featuredRank: profile.featuredRank,
    periodDays,
  })
}

export async function getCreatorLeagueById(
  creatorLeagueId: string,
  viewerUserId?: string | null,
  baseUrl = '',
  viewerEmail?: string | null,
  inviteCode?: string | null,
  viewerTier?: number | null
) {
  const league = await prisma.creatorLeague.findUnique({
    where: { id: creatorLeagueId },
    include: {
      creator: {
        include: {
          user: {
            select: {
              avatarUrl: true,
              displayName: true,
            },
          },
          _count: { select: { leagues: true } },
        },
      },
    },
  })
  if (!league) return null
  if (!canViewLeague(league, viewerUserId, viewerEmail, inviteCode)) return null
  const manageAccess = canManageCreator(league.creator, viewerUserId, viewerEmail)
  const tierMap = await loadCreatorLeagueTierMap([
    {
      id: league.id,
      type: league.type,
      leagueId: league.leagueId,
      bracketLeagueId: league.bracketLeagueId,
    },
  ])
  const tierWindow = resolveCreatorLeagueTierWindow(
    clampCareerTier(viewerTier, 1),
    tierMap.get(league.id) ?? 1,
    {
      inviteOverride:
        !!inviteCode && inviteCode.trim().toUpperCase() === league.inviteCode.trim().toUpperCase(),
      visibilityBypass: !!manageAccess,
    }
  )

  const membership = viewerUserId
    ? await prisma.creatorLeagueMember.findUnique({
        where: {
          creatorLeagueId_userId: {
            creatorLeagueId: league.id,
            userId: viewerUserId,
          },
        },
        select: { id: true },
      })
    : null

  return toLeagueDto(
    { ...league, isMember: !!membership },
    baseUrl,
    {
      viewerTier: tierWindow.viewerTier,
      leagueTier: tierWindow.leagueTier,
      canJoinByRanking: tierWindow.canJoinByRanking || !!membership,
      inviteOnlyByTier: tierWindow.inviteOnlyByTier && !membership,
    }
  )
}

export async function ensureCreatorProfile(
  userId: string,
  handle: string,
  viewerEmail?: string | null
) {
  return upsertCreatorProfile(userId, viewerEmail, { handle, displayName: handle })
}
