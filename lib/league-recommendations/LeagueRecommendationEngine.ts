/**
 * League Recommendation Engine (PROMPT 219).
 * Mostly deterministic: score by favorite sports, past leagues, draft participation, league types.
 * AI can enhance explanations later.
 */

import { prisma } from "@/lib/prisma"
import { getDiscoverableLeaguesPool } from "@/lib/public-discovery"
import type { DiscoveryCard } from "@/lib/public-discovery"
import type { UserLeagueProfile, RecommendedLeagueWithExplanation } from "./types"
import { openaiChatJson, parseJsonContentFromChatCompletion } from "@/lib/openai-client"
import { isSupportedSport, normalizeToSupportedSport } from "@/lib/sport-scope"

const DEFAULT_BASE_URL = process.env.NEXTAUTH_URL ?? "https://allfantasy.ai"
const AI_USAGE_LOOKBACK_DAYS = 120
const AI_USAGE_EVENT_TYPES = ["ai_used", "trade_analyzer", "waiver_ai", "chimmy_chat", "mock_draft"] as const
const DRAFT_ACTIVE_STATUSES = new Set(["pre_draft", "in_progress", "paused"])

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function readString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key]
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function uniquePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function normalizeSports(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const normalized = value
    .map((entry) => String(entry ?? "").trim().toUpperCase())
    .filter((sport): sport is string => Boolean(sport) && isSupportedSport(sport))
    .map((sport) => normalizeToSupportedSport(sport))
  return uniquePreserveOrder(normalized)
}

function normalizeDraftType(value: unknown): string | null {
  const raw = String(value ?? "").trim().toLowerCase()
  if (!raw) return null
  if (raw === "snake" || raw === "linear" || raw === "auction") return raw
  return null
}

function normalizeFantasyLeagueStyle(input: {
  leagueVariant?: string | null
  isDynasty?: boolean | null
  settings?: Record<string, unknown>
}): string {
  if (input.isDynasty) return "dynasty"
  const settings = input.settings ?? {}
  if (settings.isDynasty === true) return "dynasty"
  if (settings.bestBall === true || settings.best_ball === true) return "best_ball"
  if (settings.keeperEnabled === true || settings.keeper_enabled === true) return "keeper"

  const candidates = [
    input.leagueVariant,
    readString(settings, "leagueType"),
    readString(settings, "league_type"),
    readString(settings, "leagueVariant"),
    readString(settings, "league_variant"),
    readString(settings, "format"),
    readString(settings, "rosterMode"),
  ]
    .filter((entry): entry is string => Boolean(entry))
    .map((entry) => entry.toLowerCase())

  for (const candidate of candidates) {
    if (candidate.includes("best") && candidate.includes("ball")) return "best_ball"
    if (candidate.includes("keeper")) return "keeper"
    if (candidate.includes("survivor")) return "survivor"
    if (candidate.includes("dynasty")) return "dynasty"
    if (candidate.includes("community")) return "community"
    if (candidate.includes("bracket")) return "bracket"
    if (candidate.includes("redraft")) return "redraft"
  }

  return "redraft"
}

function buildTypeKey(card: Pick<DiscoveryCard, "source" | "leagueStyle">): string {
  if (card.source === "fantasy") return `fantasy:${String(card.leagueStyle ?? "redraft")}`
  return `source:${card.source}`
}

function clamp(num: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, num))
}

export function summarizeRecommendationProfile(profile: UserLeagueProfile): {
  favoriteSports: string[]
  historicalSports: string[]
  pastLeagueCount: number
  hasDraftParticipation: boolean
  leagueTypesJoined: string[]
  aiUsageLevel: "low" | "medium" | "high"
} {
  const leagueTypesJoined = Object.entries(profile.leagueTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key]) => key)
  const aiUsageLevel = profile.aiUsageScore >= 0.65 ? "high" : profile.aiUsageScore >= 0.3 ? "medium" : "low"

  return {
    favoriteSports: profile.preferredSports,
    historicalSports: profile.historicalSports,
    pastLeagueCount: profile.pastLeagueCount,
    hasDraftParticipation: profile.hasDraftParticipation,
    leagueTypesJoined,
    aiUsageLevel,
  }
}

/** Build user profile from leagues, bracket/creator memberships, and draft participation. */
export async function getUserLeagueProfile(userId: string): Promise<UserLeagueProfile> {
  const aiSince = new Date()
  aiSince.setDate(aiSince.getDate() - AI_USAGE_LOOKBACK_DAYS)

  const [profile, ownedLeagues, rosterMemberships, bracketMembers, creatorMembers, aiUsageEvents, engagementDraftCompletions] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { userId },
      select: { preferredSports: true },
    }),
    prisma.league.findMany({
      where: { userId },
      select: { id: true },
    }),
    prisma.roster.findMany({
      where: { platformUserId: userId },
      select: { leagueId: true },
    }),
    prisma.bracketLeagueMember.findMany({
      where: { userId },
      select: { leagueId: true },
    }),
    prisma.creatorLeagueMember.findMany({
      where: { userId },
      select: { creatorLeagueId: true },
    }),
    (prisma as any).engagementEvent.count({
      where: {
        userId,
        createdAt: { gte: aiSince },
        eventType: { in: [...AI_USAGE_EVENT_TYPES] },
      },
    }),
    (prisma as any).engagementEvent.count({
      where: { userId, eventType: "draft_completed" },
    }),
  ])

  const fantasyLeagueIds = uniquePreserveOrder([
    ...ownedLeagues.map((league) => league.id),
    ...rosterMemberships.map((membership) => membership.leagueId),
  ])

  const participatedLeagues =
    fantasyLeagueIds.length > 0
      ? await prisma.league.findMany({
          where: { id: { in: fantasyLeagueIds } },
          select: {
            id: true,
            sport: true,
            leagueSize: true,
            isDynasty: true,
            leagueVariant: true,
            settings: true,
          },
        })
      : []

  const completedDraftCount =
    fantasyLeagueIds.length > 0
      ? await prisma.draftSession.count({
          where: {
            leagueId: { in: fantasyLeagueIds },
            status: "completed",
          },
        })
      : 0

  const draftTypesRaw =
    fantasyLeagueIds.length > 0
      ? await prisma.draftSession.findMany({
          where: { leagueId: { in: fantasyLeagueIds } },
          select: { draftType: true },
          orderBy: { updatedAt: "desc" },
          take: 200,
        })
      : []

  const sportCounts: Record<string, number> = {}
  const teamCounts: number[] = []
  const leagueTypeCounts: Record<string, number> = {}
  for (const l of participatedLeagues) {
    const s = String(l.sport ?? "").toUpperCase()
    if (s) {
      sportCounts[s] = (sportCounts[s] ?? 0) + 1
    }
    if (l.leagueSize != null && l.leagueSize > 0) {
      teamCounts.push(l.leagueSize)
    }
    const style = normalizeFantasyLeagueStyle({
      leagueVariant: l.leagueVariant,
      isDynasty: l.isDynasty,
      settings: toRecord(l.settings),
    })
    const typeKey = `fantasy:${style}`
    leagueTypeCounts[typeKey] = (leagueTypeCounts[typeKey] ?? 0) + 1
    leagueTypeCounts["source:fantasy"] = (leagueTypeCounts["source:fantasy"] ?? 0) + 1
  }
  leagueTypeCounts["source:bracket"] = bracketMembers.length
  leagueTypeCounts["source:creator"] = creatorMembers.length

  const historicalSports = Object.entries(sportCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s)
  const favoriteSports = normalizeSports(profile?.preferredSports ?? null)
  const preferredSports = uniquePreserveOrder([...favoriteSports, ...historicalSports])

  const preferredTeamCounts = [...new Set(teamCounts)].sort((a, b) => a - b)
  if (preferredTeamCounts.length === 0) preferredTeamCounts.push(12)

  const preferredDraftTypes = uniquePreserveOrder(
    draftTypesRaw
      .map((row) => normalizeDraftType(row.draftType))
      .filter((entry): entry is string => Boolean(entry))
  )

  const aiEvents = Number(aiUsageEvents ?? 0)
  const aiUsageScore = clamp(aiEvents / 16, 0, 1)
  const draftParticipationCount = Number(completedDraftCount ?? 0) + Number(engagementDraftCompletions ?? 0)

  return {
    preferredSports,
    historicalSports,
    preferredTeamCounts,
    leagueTypeCounts,
    preferredDraftTypes,
    hasBracketLeagues: bracketMembers.length > 0,
    hasCreatorLeagues: creatorMembers.length > 0,
    hasDraftParticipation: draftParticipationCount > 0,
    draftParticipationCount,
    aiUsageEvents: aiEvents,
    aiUsageScore,
    pastLeagueCount: participatedLeagues.length + bracketMembers.length + creatorMembers.length,
    fantasyLeagueIds,
    bracketLeagueIds: bracketMembers.map((m) => m.leagueId),
    creatorLeagueIds: creatorMembers.map((m) => m.creatorLeagueId),
  }
}

/** Deterministic score for one league (higher = better match). */
function scoreLeague(card: DiscoveryCard, profile: UserLeagueProfile): {
  score: number
  reasons: string[]
  matchedSignals: string[]
} {
  let score = 0
  const reasons: string[] = []
  const matchedSignals: string[] = []
  const sport = String(card.sport ?? "").toUpperCase()

  const favoriteSportIdx = profile.preferredSports.indexOf(sport)
  if (favoriteSportIdx === 0) {
    score += 36
    reasons.push(`Strong sport match with your top preference (${sport}).`)
    matchedSignals.push("favorite_sport")
  } else if (favoriteSportIdx > 0) {
    score += 27
    reasons.push(`Matches one of your favorite sports (${sport}).`)
    matchedSignals.push("favorite_sport")
  } else if (profile.historicalSports.includes(sport)) {
    score += 18
    reasons.push(`Fits your past league history in ${sport}.`)
    matchedSignals.push("past_leagues")
  } else if (profile.preferredSports.length === 0 && profile.historicalSports.length === 0) {
    score += 8
  }

  const typeKey = buildTypeKey(card)
  const sourceTypeKey = `source:${card.source}`
  const typeCount = profile.leagueTypeCounts[typeKey] ?? profile.leagueTypeCounts[sourceTypeKey] ?? 0
  if (typeCount > 0) {
    const boost = Math.min(22, 6 + typeCount * 4)
    const typeLabel = typeKey.startsWith("fantasy:") ? typeKey.replace("fantasy:", "") : card.source
    score += boost
    reasons.push(`Similar league type to what you usually join (${typeLabel}).`)
    matchedSignals.push("league_type")
  } else if (Object.keys(profile.leagueTypeCounts).length === 0) {
    score += 5
  }

  const sizeMatch = profile.preferredTeamCounts.some(
    (n) => card.teamCount > 0 && Math.abs(card.teamCount - n) <= 2
  )
  if (sizeMatch) {
    score += 11
    reasons.push(`Team count aligns with your past leagues (${card.teamCount} teams).`)
    matchedSignals.push("past_leagues")
  }

  if (profile.hasDraftParticipation) {
    if (card.source !== "bracket" && DRAFT_ACTIVE_STATUSES.has(String(card.draftStatus ?? "").toLowerCase())) {
      score += 8
      reasons.push("Draft-ready room based on your prior draft participation.")
      matchedSignals.push("draft_participation")
    }
    const draftType = normalizeDraftType(card.draftType)
    if (draftType && profile.preferredDraftTypes.includes(draftType)) {
      score += 6
      reasons.push(`Draft format match (${draftType}).`)
      matchedSignals.push("draft_participation")
    }
  }

  if (profile.aiUsageScore >= 0.55 && card.aiFeatures.length > 0) {
    score += 8
    reasons.push("Includes Chimmy tools you frequently use.")
    matchedSignals.push("ai_usage")
  } else if (profile.aiUsageScore <= 0.2 && card.aiFeatures.length === 0) {
    score += 4
    reasons.push("Leans deterministic, matching your lower Chimmy usage pattern.")
    matchedSignals.push("ai_usage")
  } else if (card.aiFeatures.length > 0) {
    score += 2
  }

  const notFull = card.maxMembers <= 0 || card.memberCount < card.maxMembers
  if (notFull) {
    score += 6
    const fillPct = Number(card.fillPct ?? 0)
    if (fillPct >= 45 && fillPct < 100) {
      score += 3
      reasons.push("Healthy fill pace with open spots.")
    }
  } else {
    score -= 12
  }

  if (typeof card.rankingEffectScore === "number") {
    score += Math.min(12, Math.round(card.rankingEffectScore / 5))
  }

  return { score, reasons: uniquePreserveOrder(reasons), matchedSignals: uniquePreserveOrder(matchedSignals) }
}

/** Build a short deterministic explanation for a recommendation. */
function buildDeterministicExplanation(reasons: string[]): string {
  if (reasons.length === 0) return "Deterministic recommendation based on your league behavior."
  return reasons.slice(0, 2).join(" ")
}

async function maybeEnhanceWithAi(
  rows: Array<{ id: string; leagueName: string; sport: string; deterministicExplanation: string; reasons: string[] }>,
  enableAiExplain: boolean
): Promise<Map<string, string>> {
  const enhanced = new Map<string, string>()
  if (!enableAiExplain || rows.length === 0) return enhanced

  const response = await openaiChatJson({
    messages: [
      {
        role: "system",
        content:
          "You improve deterministic league recommendation explanations. Return JSON only: { items: [{ id, explanation }] }. Keep each explanation under 22 words, factual, and grounded only in provided reasons.",
      },
      {
        role: "user",
        content: JSON.stringify({
          items: rows.slice(0, 8).map((row) => ({
            id: row.id,
            leagueName: row.leagueName,
            sport: row.sport,
            deterministicExplanation: row.deterministicExplanation,
            reasons: row.reasons.slice(0, 3),
          })),
        }),
      },
    ],
    temperature: 0.3,
    maxTokens: 500,
  })

  if (!response.ok || !response.json) return enhanced
  const parsed = parseJsonContentFromChatCompletion(response.json) as
    | { items?: Array<{ id?: string; explanation?: string }> }
    | null
  const items = Array.isArray(parsed?.items) ? parsed.items : []

  for (const item of items) {
    const id = String(item?.id ?? "").trim()
    const explanation = String(item?.explanation ?? "").trim()
    if (!id || !explanation) continue
    enhanced.set(id, explanation)
  }

  return enhanced
}

/**
 * Get personalized league recommendations for a user.
 * Deterministic scoring; optional AI-enhanced explanations can be layered later.
 */
export async function getPersonalizedRecommendations(
  userId: string,
  baseUrl: string = DEFAULT_BASE_URL,
  options: {
    limit?: number
    sport?: string | null
    viewerTier?: number | null
    viewerIsAdmin?: boolean
    aiExplain?: boolean
    profile?: UserLeagueProfile
  } = {}
): Promise<RecommendedLeagueWithExplanation[]> {
  const limit = Math.min(24, Math.max(1, options.limit ?? 6))
  let profile = options.profile
  let pool: DiscoveryCard[] = []
  if (profile) {
    pool = await getDiscoverableLeaguesPool(baseUrl, {
      sport: options.sport ?? null,
      maxTotal: 120,
      viewerContext: {
        viewerTier: options.viewerTier ?? null,
        viewerUserId: userId,
        viewerIsAdmin: options.viewerIsAdmin === true,
      },
    })
  } else {
    ;[profile, pool] = await Promise.all([
      getUserLeagueProfile(userId),
      getDiscoverableLeaguesPool(baseUrl, {
        sport: options.sport ?? null,
        maxTotal: 120,
        viewerContext: {
          viewerTier: options.viewerTier ?? null,
          viewerUserId: userId,
          viewerIsAdmin: options.viewerIsAdmin === true,
        },
      }),
    ])
  }

  const excludeIds = new Set([
    ...profile.fantasyLeagueIds.map((id) => `fantasy-${id}`),
    ...profile.bracketLeagueIds.map((id) => `bracket-${id}`),
    ...profile.creatorLeagueIds.map((id) => `creator-${id}`),
  ])

  const scored = pool
    .filter((c) => !excludeIds.has(`${c.source}-${c.id}`))
    .filter((c) => c.maxMembers <= 0 || c.memberCount < c.maxMembers)
    .map((card) => ({
      card,
      ...scoreLeague(card, profile),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return Number(b.card.rankingEffectScore ?? 0) - Number(a.card.rankingEffectScore ?? 0)
    })
    .slice(0, limit)

  const deterministicRows = scored.map(({ card, score, reasons, matchedSignals }) => {
    const deterministicExplanation = buildDeterministicExplanation(reasons)
    return {
      id: `${card.source}:${card.id}`,
      league: card,
      explanation: deterministicExplanation,
      reasons,
      matchedSignals,
      score,
    }
  })

  const aiEnhancedMap = await maybeEnhanceWithAi(
    deterministicRows.map((row) => ({
      id: row.id,
      leagueName: row.league.name,
      sport: row.league.sport,
      deterministicExplanation: row.explanation,
      reasons: row.reasons,
    })),
    options.aiExplain === true
  )

  return deterministicRows.map((row) => {
    const aiExplanation = aiEnhancedMap.get(row.id)
    return {
      league: row.league,
      explanation: aiExplanation ?? row.explanation,
      reasons: row.reasons,
      explanationSource: aiExplanation ? "ai" : "deterministic",
      matchedSignals: row.matchedSignals,
      score: row.score,
    }
  })
}
