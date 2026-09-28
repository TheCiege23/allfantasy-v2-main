import { prisma } from "@/lib/prisma"
import type { LeagueSport } from "@prisma/client"
import { extractLeagueCareerTier } from "@/lib/ranking/tier-visibility"
import { isSupportedSport, normalizeToSupportedSport } from "@/lib/sport-scope"
import { CURRENT_DRAFT_SESSION_ORDER } from "@/lib/draft-room/currentDraftSession"
import type { DiscoveryCard, DiscoveryLeagueStyle } from "./types"

const DEFAULT_BASE_URL =
  typeof process !== "undefined" ? process.env.NEXTAUTH_URL ?? "https://allfantasy.ai" : "https://allfantasy.ai"

const LEAGUE_VISIBILITY_KEY = "league_privacy_visibility"
const LEAGUE_ALLOW_INVITE_LINK_KEY = "league_allow_invite_link"
const LEAGUE_INVITE_CODE_KEY = "inviteCode"
const LEAGUE_PUBLIC_DASHBOARD_KEY = "publicDashboard"
const LEAGUE_DESCRIPTION_KEY = "description"
const DEFAULT_DISCOVERY_TAKE = 300

function resolveBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function normalizeLeagueStyleCandidate(value: unknown): DiscoveryLeagueStyle | null {
  const raw = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "_")
  if (!raw) return null
  if (raw.includes("best") && raw.includes("ball")) return "best_ball"
  if (raw.includes("dynasty")) return "dynasty"
  if (raw.includes("redraft")) return "redraft"
  if (raw.includes("keeper")) return "keeper"
  if (raw.includes("survivor")) return "survivor"
  if (raw.includes("bracket")) return "bracket"
  if (raw.includes("community")) return "community"
  return null
}

function resolveFantasyLeagueStyle(input: {
  leagueVariant?: string | null
  isDynasty?: boolean | null
  settings?: Record<string, unknown>
}): DiscoveryLeagueStyle {
  const settings = input.settings ?? {}
  if (input.isDynasty || settings.isDynasty === true) return "dynasty"
  if (settings.bestBall === true || settings.best_ball === true) return "best_ball"

  const candidates = [
    input.leagueVariant,
    settings.leagueType,
    settings.format,
    settings.mode,
    settings.scoringMode,
    settings.rosterMode,
  ]

  for (const candidate of candidates) {
    const normalized = normalizeLeagueStyleCandidate(candidate)
    if (normalized) return normalized
  }

  return "redraft"
}

function resolveCreatorLeagueStyle(input: {
  creatorLeagueType: string
  linkedLeague?: { leagueVariant?: string | null; isDynasty?: boolean | null; settings?: unknown } | null
}): DiscoveryLeagueStyle {
  if (String(input.creatorLeagueType).toUpperCase() === "BRACKET") return "bracket"
  if (input.linkedLeague) {
    return resolveFantasyLeagueStyle({
      leagueVariant: input.linkedLeague.leagueVariant ?? null,
      isDynasty: input.linkedLeague.isDynasty ?? false,
      settings: toRecord(input.linkedLeague.settings),
    })
  }
  return "community"
}

function resolvePaidFlag(raw: Record<string, unknown>): boolean {
  if (typeof raw.isPaidLeague === "boolean") return raw.isPaidLeague
  if (typeof raw.paid === "boolean") return raw.paid
  if (typeof raw.entryFee === "number") return raw.entryFee > 0
  if (typeof raw.entryFee === "string") return Number(raw.entryFee) > 0
  if (typeof raw.buyIn === "number") return raw.buyIn > 0
  if (typeof raw.buyIn === "string") return Number(raw.buyIn) > 0
  return false
}

function readString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key]
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeDraftType(value: string | null): string | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (normalized === "snake" || normalized === "linear" || normalized === "auction" || normalized === "slow_draft" || normalized === "mock_draft") {
    return normalized
  }
  return normalized.length > 0 ? normalized : null
}

function normalizeDraftStatus(value: string | null): string | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (
    normalized === "pre_draft" ||
    normalized === "in_progress" ||
    normalized === "paused" ||
    normalized === "completed"
  ) {
    return normalized
  }
  return normalized.length > 0 ? normalized : null
}

function resolveAiFeatures(raw: Record<string, unknown>): string[] {
  const explicit = raw.aiFeatures
  if (Array.isArray(explicit)) {
    const values = explicit.map((feature) => String(feature).trim()).filter(Boolean)
    if (values.length > 0) return values.slice(0, 4)
  }

  const featureMap: Array<{ key: string; label: string }> = [
    { key: "ai_adp_enabled", label: "AI ADP" },
    { key: "draft_helper_enabled", label: "Draft helper" },
    { key: "orphan_team_ai_manager_enabled", label: "AI manager" },
    { key: "ai_feature_trade_analyzer_enabled", label: "Trade analyzer" },
    { key: "ai_feature_waiver_ai_enabled", label: "Waiver AI" },
    { key: "ai_feature_player_comparison_enabled", label: "Player compare" },
    { key: "ai_feature_matchup_simulator_enabled", label: "Matchup AI" },
    { key: "ai_feature_fantasy_coach_enabled", label: "Fantasy coach" },
    { key: "ai_feature_ai_chat_chimmy_enabled", label: "Chimmy chat" },
  ]

  const enabled = featureMap
    .filter((feature) => raw[feature.key] === true)
    .map((feature) => feature.label)

  return enabled.slice(0, 4)
}

function isFantasyLeagueDiscoverable(settings: Record<string, unknown>): boolean {
  const visibility = String(settings[LEAGUE_VISIBILITY_KEY] ?? "").trim().toLowerCase()
  const hasPublicDashboard = settings[LEAGUE_PUBLIC_DASHBOARD_KEY] === true
  const inviteCode = String(settings[LEAGUE_INVITE_CODE_KEY] ?? "").trim()
  const allowInviteLink =
    typeof settings[LEAGUE_ALLOW_INVITE_LINK_KEY] === "boolean"
      ? Boolean(settings[LEAGUE_ALLOW_INVITE_LINK_KEY])
      : true

  return Boolean(inviteCode) && allowInviteLink && (visibility === "public" || hasPublicDashboard)
}

function buildFillPct(memberCount: number, maxMembers: number): number {
  if (maxMembers <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((memberCount / maxMembers) * 100)))
}

function normalizeSportFilter(sport: string | null): LeagueSport | null {
  if (!sport) return null
  if (!isSupportedSport(sport)) return null
  return normalizeToSupportedSport(sport) as LeagueSport
}

export async function queryPublicFantasyLeagueCards(options: {
  sport: string | null
  query: string | null
  candidateLeagueIds?: string[] | null
  baseUrl?: string
  take?: number
}): Promise<DiscoveryCard[]> {
  const baseUrl = resolveBaseUrl(options.baseUrl)
  const sport = normalizeSportFilter(options.sport)
  const query = typeof options.query === "string" ? options.query.trim().toLowerCase() : null
  const candidateLeagueIds = Array.isArray(options.candidateLeagueIds)
    ? [...new Set(options.candidateLeagueIds.map((id) => String(id).trim()).filter(Boolean))]
    : null
  if (candidateLeagueIds != null && candidateLeagueIds.length === 0) return []

  const where = {
    ...(sport ? { sport } : {}),
    ...(candidateLeagueIds ? { id: { in: candidateLeagueIds } } : {}),
  }

  const leagues = await prisma.league.findMany({
    where,
    select: {
      id: true,
      userId: true,
      name: true,
      sport: true,
      season: true,
      leagueVariant: true,
      leagueSize: true,
      scoring: true,
      isDynasty: true,
      settings: true,
      createdAt: true,
      updatedAt: true,
      draftSessions: {
        orderBy: CURRENT_DRAFT_SESSION_ORDER,
        take: 1,
        select: {
          draftType: true,
          status: true,
        },
      },
      user: {
        select: {
          username: true,
          displayName: true,
          avatarUrl: true,
        },
      },
      _count: {
        select: {
          rosters: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: Math.min(options.take ?? DEFAULT_DISCOVERY_TAKE, DEFAULT_DISCOVERY_TAKE),
  })

  return leagues
    .map((league): DiscoveryCard | null => {
      const settings = toRecord(league.settings)
      if (!isFantasyLeagueDiscoverable(settings)) return null

      const inviteCode = String(settings[LEAGUE_INVITE_CODE_KEY] ?? "").trim()
      const name = league.name?.trim() || "Public league"
      const description =
        typeof settings[LEAGUE_DESCRIPTION_KEY] === "string" && settings[LEAGUE_DESCRIPTION_KEY].trim()
          ? String(settings[LEAGUE_DESCRIPTION_KEY]).trim()
          : null

      if (
        query &&
        !name.toLowerCase().includes(query) &&
        !(description?.toLowerCase().includes(query) ?? false) &&
        !String(league.user?.displayName ?? league.user?.username ?? "")
          .toLowerCase()
          .includes(query)
      ) {
        return null
      }

      const maxMembers = Math.max(2, Number(league.leagueSize ?? 12) || 12)
      const memberCount = Number(league._count?.rosters ?? 0)
      const leagueStyle = resolveFantasyLeagueStyle({
        leagueVariant: league.leagueVariant,
        isDynasty: league.isDynasty,
        settings,
      })
      const leagueTier = extractLeagueCareerTier(settings, 1)
      const latestDraftSession = league.draftSessions[0] ?? null
      const draftType =
        normalizeDraftType(latestDraftSession?.draftType ?? null) ??
        normalizeDraftType(readString(settings, "draft_type")) ??
        normalizeDraftType(readString(settings, "draftType")) ??
        null
      const draftStatus =
        normalizeDraftStatus(latestDraftSession?.status ?? null) ??
        normalizeDraftStatus(readString(settings, "draft_status")) ??
        normalizeDraftStatus(readString(settings, "draftStatus")) ??
        null

      return {
        source: "fantasy",
        id: league.id,
        name,
        description,
        sport: String(league.sport ?? "NFL"),
        memberCount,
        maxMembers,
        joinUrl: `${baseUrl}/join?code=${encodeURIComponent(inviteCode)}`,
        detailUrl: `${baseUrl}/leagues/${league.id}`,
        ownerName: league.user?.displayName ?? league.user?.username ?? "Commissioner",
        ownerAvatar: league.user?.avatarUrl ?? null,
        creatorSlug: null,
        creatorName: null,
        tournamentName: null,
        season: league.season ?? null,
        scoringMode: league.scoring ?? null,
        isPaid: resolvePaidFlag(settings),
        isPrivate: false,
        createdAt: league.createdAt.toISOString(),
        fillPct: buildFillPct(memberCount, maxMembers),
        leagueType: "fantasy",
        leagueStyle,
        draftType,
        draftStatus,
        teamCount: maxMembers,
        draftDate:
          typeof settings.draftDate === "string" && settings.draftDate.trim()
            ? String(settings.draftDate)
            : null,
        commissionerName: league.user?.displayName ?? league.user?.username ?? "Commissioner",
        aiFeatures: resolveAiFeatures(settings),
        leagueTier,
      }
    })
    .filter((card): card is DiscoveryCard => card != null)
}

export async function queryPublicBracketLeagueCards(options: {
  sport: string | null
  query: string | null
  baseUrl?: string
  take?: number
}): Promise<DiscoveryCard[]> {
  const baseUrl = resolveBaseUrl(options.baseUrl)
  const sport = normalizeSportFilter(options.sport)

  const where: {
    isPrivate: boolean
    tournament?: { sport?: string }
    OR?: Array<Record<string, unknown>>
  } = {
    isPrivate: false,
  }

  if (sport) {
    where.tournament = { sport }
  }

  if (options.query && options.query.trim().length >= 2) {
    where.OR = [
      { name: { contains: options.query.trim(), mode: "insensitive" } },
      { tournament: { name: { contains: options.query.trim(), mode: "insensitive" } } },
    ]
  }

  const leagues = await prisma.bracketLeague.findMany({
    where,
    select: {
      id: true,
      name: true,
      joinCode: true,
      isPrivate: true,
      maxManagers: true,
      deadline: true,
      createdAt: true,
      scoringRules: true,
      owner: {
        select: {
          displayName: true,
          avatarUrl: true,
        },
      },
      tournament: {
        select: {
          name: true,
          season: true,
          sport: true,
        },
      },
      _count: {
        select: {
          members: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }],
    take: Math.min(options.take ?? DEFAULT_DISCOVERY_TAKE, DEFAULT_DISCOVERY_TAKE),
  })

  return leagues.map((league) => {
    const rules = toRecord(league.scoringRules)
    const maxMembers = Math.max(2, Number(league.maxManagers ?? 100) || 100)
    const memberCount = Number(league._count?.members ?? 0)

    return {
      source: "bracket",
      id: league.id,
      name: league.name,
      description: null,
      sport: league.tournament?.sport ?? "NFL",
      memberCount,
      maxMembers,
      joinUrl: `${baseUrl}/brackets/join?code=${encodeURIComponent(league.joinCode)}`,
      detailUrl: `${baseUrl}/brackets/leagues/${league.id}`,
      ownerName: league.owner?.displayName ?? "Commissioner",
      ownerAvatar: league.owner?.avatarUrl ?? null,
      creatorSlug: null,
      creatorName: null,
      tournamentName: league.tournament?.name ?? null,
      season: league.tournament?.season != null ? Number(league.tournament.season) : null,
      scoringMode: String(rules.mode ?? rules.scoringMode ?? "bracket"),
      isPaid: resolvePaidFlag(rules),
      isPrivate: league.isPrivate,
      createdAt: league.createdAt.toISOString(),
      fillPct: buildFillPct(memberCount, maxMembers),
      leagueType: "bracket",
      leagueStyle: "bracket",
      draftType: null,
      draftStatus: null,
      teamCount: maxMembers,
      draftDate: league.deadline ? league.deadline.toISOString() : null,
      commissionerName: league.owner?.displayName ?? "Commissioner",
      aiFeatures: [],
      leagueTier: extractLeagueCareerTier(rules, 1),
    }
  })
}

export async function queryPublicCreatorLeagueCards(options: {
  sport: string | null
  query: string | null
  baseUrl?: string
  take?: number
}): Promise<DiscoveryCard[]> {
  const baseUrl = resolveBaseUrl(options.baseUrl)
  const sport = normalizeSportFilter(options.sport)

  const leagues = await prisma.creatorLeague.findMany({
    where: {
      isPublic: true,
      ...(sport ? { sport } : {}),
      creator: {
        visibility: "public",
      },
    },
    select: {
      id: true,
      creatorId: true,
      type: true,
      leagueId: true,
      bracketLeagueId: true,
      name: true,
      description: true,
      sport: true,
      inviteCode: true,
      maxMembers: true,
      memberCount: true,
      joinDeadline: true,
      createdAt: true,
      coverImageUrl: true,
      communitySummary: true,
      creator: {
        select: {
          slug: true,
          handle: true,
          displayName: true,
          avatarUrl: true,
          verifiedAt: true,
          user: {
            select: {
              displayName: true,
              avatarUrl: true,
            },
          },
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: Math.min(options.take ?? DEFAULT_DISCOVERY_TAKE, DEFAULT_DISCOVERY_TAKE),
  })

  const linkedLeagueIds = leagues.map((league) => league.leagueId).filter((value): value is string => Boolean(value))
  const linkedBracketIds = leagues
    .map((league) => league.bracketLeagueId)
    .filter((value): value is string => Boolean(value))

  const [linkedFantasyLeagues, linkedBracketLeagues] = await Promise.all([
    linkedLeagueIds.length
      ? prisma.league.findMany({
          where: { id: { in: [...new Set(linkedLeagueIds)] } },
          select: {
            id: true,
            leagueVariant: true,
            isDynasty: true,
            settings: true,
            scoring: true,
          },
        })
      : Promise.resolve([]),
    linkedBracketIds.length
      ? prisma.bracketLeague.findMany({
          where: { id: { in: [...new Set(linkedBracketIds)] } },
          select: {
            id: true,
            scoringRules: true,
          },
        })
      : Promise.resolve([]),
  ])
  const linkedFantasySessions = linkedLeagueIds.length
    ? await prisma.draftSession.findMany({
        where: { leagueId: { in: [...new Set(linkedLeagueIds)] } },
        select: {
          leagueId: true,
          status: true,
          draftType: true,
          updatedAt: true,
        },
        orderBy: [{ updatedAt: "desc" }],
      })
    : []

  const fantasyLeagueById = new Map(linkedFantasyLeagues.map((league) => [league.id, league]))
  const bracketLeagueById = new Map(linkedBracketLeagues.map((league) => [league.id, league]))
  const fantasySessionByLeagueId = new Map<string, { status: string; draftType: string }>()
  for (const session of linkedFantasySessions) {
    if (fantasySessionByLeagueId.has(session.leagueId)) continue
    fantasySessionByLeagueId.set(session.leagueId, {
      status: session.status,
      draftType: session.draftType,
    })
  }
  const query = typeof options.query === "string" ? options.query.trim().toLowerCase() : null

  return leagues
    .map((league): DiscoveryCard | null => {
      const linkedFantasyLeague = league.leagueId ? fantasyLeagueById.get(league.leagueId) ?? null : null
      const linkedBracketLeague = league.bracketLeagueId ? bracketLeagueById.get(league.bracketLeagueId) ?? null : null
      const description = league.description ?? league.communitySummary ?? null
      const creatorName = league.creator.displayName ?? league.creator.handle

      if (
        query &&
        !league.name.toLowerCase().includes(query) &&
        !(description?.toLowerCase().includes(query) ?? false) &&
        !creatorName.toLowerCase().includes(query)
      ) {
        return null
      }

      const linkedFantasySettings = toRecord(linkedFantasyLeague?.settings)
      const linkedBracketRules = toRecord(linkedBracketLeague?.scoringRules)
      const linkedSession =
        linkedFantasyLeague?.id != null ? fantasySessionByLeagueId.get(linkedFantasyLeague.id) ?? null : null
      const maxMembers = Math.max(2, Number(league.maxMembers ?? 100) || 100)
      const memberCount = Number(league.memberCount ?? 0)
      const leagueStyle = resolveCreatorLeagueStyle({
        creatorLeagueType: league.type,
        linkedLeague: linkedFantasyLeague,
      })
      const leagueTier =
        String(league.type).toUpperCase() === "BRACKET"
          ? extractLeagueCareerTier(linkedBracketRules, 1)
          : extractLeagueCareerTier(linkedFantasySettings, 1)

      const draftType =
        String(league.type).toUpperCase() === "BRACKET"
          ? null
          : normalizeDraftType(linkedSession?.draftType ?? null) ??
            normalizeDraftType(readString(linkedFantasySettings, "draft_type")) ??
            normalizeDraftType(readString(linkedFantasySettings, "draftType")) ??
            null
      const draftStatus =
        String(league.type).toUpperCase() === "BRACKET"
          ? null
          : normalizeDraftStatus(linkedSession?.status ?? null) ??
            normalizeDraftStatus(readString(linkedFantasySettings, "draft_status")) ??
            normalizeDraftStatus(readString(linkedFantasySettings, "draftStatus")) ??
            null

      return {
        source: "creator",
        id: league.id,
        name: league.name,
        description,
        sport: league.sport,
        memberCount,
        maxMembers,
        joinUrl: `${baseUrl}/creator/leagues/${league.id}?join=${encodeURIComponent(league.inviteCode)}`,
        detailUrl: `${baseUrl}/creator/leagues/${league.id}`,
        ownerName:
          league.creator.user?.displayName ?? league.creator.displayName ?? league.creator.handle ?? "Creator",
        ownerAvatar: league.creator.avatarUrl ?? league.creator.user?.avatarUrl ?? null,
        creatorSlug: league.creator.slug,
        creatorName,
        tournamentName: null,
        season: null,
        scoringMode:
          linkedFantasyLeague?.scoring ?? String(linkedBracketRules.mode ?? linkedBracketRules.scoringMode ?? "community"),
        isPaid: resolvePaidFlag(
          String(league.type).toUpperCase() === "BRACKET" ? linkedBracketRules : linkedFantasySettings
        ),
        isPrivate: false,
        createdAt: league.createdAt.toISOString(),
        fillPct: buildFillPct(memberCount, maxMembers),
        leagueType: "creator",
        leagueStyle,
        draftType,
        draftStatus,
        teamCount: maxMembers,
        draftDate: league.joinDeadline ? league.joinDeadline.toISOString() : null,
        commissionerName:
          league.creator.user?.displayName ?? league.creator.displayName ?? league.creator.handle ?? "Creator",
        aiFeatures:
          String(league.type).toUpperCase() === "BRACKET"
            ? []
            : resolveAiFeatures(linkedFantasySettings),
        creatorLeagueType: league.type,
        isCreatorVerified: !!league.creator.verifiedAt,
        leagueTier,
      }
    })
    .filter((card): card is DiscoveryCard => card != null)
}
