/**
 * LeagueDiscoveryService — discover bracket leagues with filters, search, and pagination.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { openaiChatJson, parseJsonContentFromChatCompletion } from "@/lib/openai-client"
import {
  buildDiscoveryWhere,
  resolveFilters,
  matchesLeagueTypeAndFee,
} from "./LeagueFilterResolver"
import { buildSearchWhere } from "./LeagueSearchResolver"
import {
  extractLeagueCareerTier,
  isLeagueVisibleForCareerTier,
} from "@/lib/ranking/tier-visibility"
import {
  DEFAULT_SPORT,
  normalizeToSupportedSport,
  isSupportedSport,
} from "@/lib/sport-scope"
import type {
  LeagueCard,
  CandidateLeague,
  UserDiscoveryPreferences,
  SuggestLeaguesResult,
  LeagueMatchSuggestion,
  SkillLevel,
  ActivityPreference,
  CompetitionBalancePreference,
} from "./types"

export interface DiscoverLeaguesInput {
  query?: string | null
  sport?: string | null
  leagueType?: string | null
  entryFee?: string | null
  visibility?: string | null
  difficulty?: string | null
  page?: number
  limit?: number
  viewerTier?: number
}

export interface DiscoverLeaguesResult {
  leagues: LeagueCard[]
  total: number
  page: number
  limit: number
  totalPages: number
}

/**
 * What the discovery query joins.
 *
 * 🛑 ONLY RELATIONS BELONG IN AN `include`, AND A SCALAR HERE IS A 500, NOT A
 * TYPE ERROR — because the call used to go through `(prisma as any)`. From
 * `be9816c52` (2026-03-17) until this was fixed, this block also listed
 * `scoringRules: true`, which is a `Json?` COLUMN on BracketLeague, and every
 * request to /api/bracket/discover died with
 * "Invalid `prisma.bracketLeague.findMany()` invocation". Six months of a
 * public endpoint returning 500, and /brackets/discover showing nothing.
 *
 * ⚠ THE SCALAR WAS NEVER NEEDED. `include` returns every scalar column by
 * default, so `lg.scoringRules` below has always been populated — the line
 * bought nothing and cost the whole endpoint.
 *
 * Exported so `__tests__/league-discovery-include-shape.test.ts` can check it
 * against the generated client's own field list.
 *
 * 🛑 THE `Prisma.BracketLeagueInclude` ANNOTATION IS LOAD-BEARING AND IS NOT
 * DECORATION. Excess-property checking fires on an object LITERAL, not on a
 * variable passed by reference — so once this moved out of the call into a
 * named const, `include: DISCOVERY_INCLUDE` type-checked happily with the
 * scalar still in it. Measured: with the cast removed but no annotation,
 * reinstating `scoringRules: true` produced ZERO compiler errors. Annotating
 * the declaration is what moves the check to where the literal is written.
 */
export const DISCOVERY_INCLUDE: Prisma.BracketLeagueInclude = {
  owner: { select: { displayName: true, avatarUrl: true } },
  tournament: { select: { id: true, name: true, season: true, sport: true } },
  _count: { select: { members: true, entries: true } },
}

const SKILL_BY_TEAMS: Record<SkillLevel, number> = {
  beginner: 10,
  intermediate: 12,
  advanced: 14,
  expert: 16,
}

function normalizeSkillLevel(value: unknown): SkillLevel {
  const v = String(value ?? '').trim().toLowerCase()
  if (v === 'beginner' || v === 'intermediate' || v === 'advanced' || v === 'expert') return v
  return 'intermediate'
}

function normalizeActivityPreference(value: unknown): ActivityPreference {
  const v = String(value ?? '').trim().toLowerCase()
  if (v === 'quiet' || v === 'moderate' || v === 'active') return v
  return 'moderate'
}

function normalizeCompetitionBalance(value: unknown): CompetitionBalancePreference {
  const v = String(value ?? '').trim().toLowerCase()
  if (v === 'casual' || v === 'balanced' || v === 'competitive') return v
  return 'balanced'
}

function normalizeSportsPreferences(value: unknown): string[] {
  const list = Array.isArray(value) ? value : []
  const out = list
    .map((s) => String(s ?? '').trim())
    .filter((s): s is string => isSupportedSport(s))
    .map((s) => normalizeToSupportedSport(s))
  return out.length > 0 ? [...new Set(out)] : [DEFAULT_SPORT]
}

function normalizeCandidateSport(sport: unknown): string {
  const raw = typeof sport === 'string' ? sport : null
  return normalizeToSupportedSport(raw)
}

function normalizeActivityLevel(value: unknown): ActivityPreference {
  const v = String(value ?? '').trim().toLowerCase()
  if (v === 'quiet' || v === 'moderate' || v === 'active') return v
  return 'moderate'
}

function normalizeCompetitionSpread(value: unknown): CompetitionBalancePreference {
  const v = String(value ?? '').trim().toLowerCase()
  if (v === 'casual' || v === 'balanced' || v === 'competitive') return v
  return 'balanced'
}

function getLeagueSize(candidate: CandidateLeague): number {
  const explicit = Number(candidate.leagueSize ?? 0)
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  const maxManagers = Number(candidate.maxManagers ?? 0)
  if (Number.isFinite(maxManagers) && maxManagers > 0) return maxManagers
  const entry = Number(candidate.entryCount ?? 0)
  if (Number.isFinite(entry) && entry > 0) return entry
  const member = Number(candidate.memberCount ?? 0)
  if (Number.isFinite(member) && member > 0) return member
  return 12
}

function scoreSportMatch(candidateSport: string, preferredSports: string[]) {
  const matched = preferredSports.includes(candidateSport)
  return {
    score: matched ? 100 : 28,
    reason: matched
      ? `Matches your preferred sport (${candidateSport}).`
      : `Outside your primary sports set (${preferredSports.join(', ')}).`,
  }
}

function scoreSkillFit(candidate: CandidateLeague, skillLevel: SkillLevel) {
  const target = SKILL_BY_TEAMS[skillLevel]
  const leagueSize = getLeagueSize(candidate)
  const diff = Math.abs(leagueSize - target)
  const sizeScore = Math.max(0, 100 - diff * 12)
  const paidPenalty = candidate.isPaidLeague && skillLevel === 'beginner' ? 16 : 0
  const dynastyPenalty = candidate.isDynasty && skillLevel === 'beginner' ? 12 : 0
  const adjusted = Math.max(0, Math.round(sizeScore - paidPenalty - dynastyPenalty))
  const reason = `League size ${leagueSize} aligns with ${skillLevel} target (~${target} teams).`
  return { score: adjusted, reason }
}

function scoreActivityFit(candidate: CandidateLeague, preferredActivity: ActivityPreference) {
  const activity = normalizeActivityLevel(candidate.activityLevel)
  const order: ActivityPreference[] = ['quiet', 'moderate', 'active']
  const diff = Math.abs(order.indexOf(activity) - order.indexOf(preferredActivity))
  const score = diff === 0 ? 100 : diff === 1 ? 68 : 38
  return {
    score,
    reason: `Activity profile looks ${activity}, matching your ${preferredActivity} preference.`,
  }
}

function scoreCompetitionFit(candidate: CandidateLeague, desiredBalance: CompetitionBalancePreference) {
  const spread = normalizeCompetitionSpread(candidate.competitionSpread)
  const order: CompetitionBalancePreference[] = ['casual', 'balanced', 'competitive']
  const diff = Math.abs(order.indexOf(spread) - order.indexOf(desiredBalance))
  const score = diff === 0 ? 100 : diff === 1 ? 64 : 34
  return {
    score,
    reason: `Competition level appears ${spread}, relative to your ${desiredBalance} target.`,
  }
}

type CandidateScoreRow = {
  candidate: CandidateLeague
  matchScore: number
  reasons: string[]
}

function buildDeterministicSummary(row: CandidateScoreRow): string {
  return `Strong fit across sport, skill, and league environment (${row.matchScore}% match).`
}

async function buildAiNarratives(rows: CandidateScoreRow[]): Promise<Map<string, { summary: string; reasons: string[] }>> {
  if (rows.length === 0) return new Map()
  const trimmed = rows.slice(0, 10)
  const promptRows = trimmed.map((r) => ({
    id: r.candidate.id,
    name: r.candidate.name,
    sport: normalizeCandidateSport(r.candidate.sport),
    matchScore: r.matchScore,
    deterministicReasons: r.reasons,
  }))

  let res:
    | { ok: true; json: any; model: string; baseUrl: string }
    | { ok: false; status: number; details: string; model: string; baseUrl: string }
  try {
    res = await openaiChatJson({
      messages: [
        {
          role: 'system',
          content:
            'You are a fantasy sports matchmaking assistant. Return JSON only with { suggestions: [{ id, summary, reasons }] }. Provide 1 concise summary sentence and 1-3 short reasons grounded in given deterministic reasons. Never invent IDs.',
        },
        {
          role: 'user',
          content: JSON.stringify({ suggestions: promptRows }),
        },
      ],
      temperature: 0.35,
      maxTokens: 900,
    })
  } catch {
    return new Map()
  }

  const out = new Map<string, { summary: string; reasons: string[] }>()
  if (!res.ok || !res.json) return out
  const parsed = parseJsonContentFromChatCompletion(res.json) as
    | { suggestions?: Array<{ id?: string; summary?: string; reasons?: string[] }> }
    | null
  const list = Array.isArray(parsed?.suggestions) ? parsed!.suggestions! : []
  for (const item of list) {
    const id = String(item?.id ?? '').trim()
    if (!id) continue
    const summary = String(item?.summary ?? '').trim()
    const reasons = Array.isArray(item?.reasons)
      ? item!.reasons!.map((r) => String(r).trim()).filter(Boolean).slice(0, 3)
      : []
    if (!summary && reasons.length === 0) continue
    out.set(id, {
      summary: summary || 'Good overall league fit for your profile.',
      reasons,
    })
  }
  return out
}

/** Suggest leagues from candidate set using skill/sport/activity/competition match. */
export async function suggestLeagues(input: {
  preferences: UserDiscoveryPreferences
  candidates: CandidateLeague[]
}): Promise<SuggestLeaguesResult> {
  const skillLevel = normalizeSkillLevel(input.preferences.skillLevel)
  const preferredActivity = normalizeActivityPreference(input.preferences.preferredActivity)
  const competitionBalance = normalizeCompetitionBalance(input.preferences.competitionBalance)
  const sportsPreferences = normalizeSportsPreferences(input.preferences.sportsPreferences)

  const rows: CandidateScoreRow[] = input.candidates.map((candidate) => {
    const normalizedSport = normalizeCandidateSport(candidate.sport)
    const sport = scoreSportMatch(normalizedSport, sportsPreferences)
    const skill = scoreSkillFit(candidate, skillLevel)
    const activity = scoreActivityFit(candidate, preferredActivity)
    const competition = scoreCompetitionFit(candidate, competitionBalance)
    const weighted =
      sport.score * 0.35 +
      skill.score * 0.25 +
      activity.score * 0.2 +
      competition.score * 0.2
    return {
      candidate: {
        ...candidate,
        sport: normalizedSport,
      },
      matchScore: Math.round(Math.max(0, Math.min(100, weighted))),
      reasons: [sport.reason, skill.reason, activity.reason, competition.reason],
    }
  })

  rows.sort((a, b) => b.matchScore - a.matchScore)
  const topRows = rows.slice(0, 20)
  const aiNarratives = await buildAiNarratives(topRows)

  const suggestions: LeagueMatchSuggestion[] = topRows.map((row) => {
    const ai = aiNarratives.get(row.candidate.id)
    return {
      ...row.candidate,
      matchScore: row.matchScore,
      summary: ai?.summary ?? buildDeterministicSummary(row),
      reasons: (ai?.reasons?.length ? ai.reasons : row.reasons).slice(0, 3),
    }
  })

  return {
    suggestions,
    generatedAt: new Date().toISOString(),
  }
}

export async function discoverLeagues(input: DiscoverLeaguesInput): Promise<DiscoverLeaguesResult> {
  const page = Math.max(1, Number(input.page) || 1)
  const limit = Math.min(50, Math.max(5, Number(input.limit) || 20))
  const viewerTier = Math.max(1, Math.floor(Number(input.viewerTier) || 1))
  const resolved = resolveFilters({
    sport: input.sport,
    leagueType: input.leagueType,
    entryFee: input.entryFee,
    visibility: input.visibility,
    difficulty: input.difficulty,
  })

  const searchWhere = buildSearchWhere(input.query)
  const where = buildDiscoveryWhere(resolved, searchWhere)

  const allMatching = await prisma.bracketLeague.findMany({
    where,
    include: DISCOVERY_INCLUDE,
    orderBy: { createdAt: "desc" },
    take: 2000,
  })

  const filtered = allMatching.filter((lg: any) => {
    const rules = lg.scoringRules as Record<string, unknown>
    if (!matchesLeagueTypeAndFee(rules, resolved)) return false
    const leagueTier = extractLeagueCareerTier(rules, viewerTier)
    return isLeagueVisibleForCareerTier(viewerTier, leagueTier, 1)
  })
  const total = filtered.length
  const leagues = filtered.slice((page - 1) * limit, page * limit)

  const baseUrl = typeof process !== "undefined" ? process.env.NEXTAUTH_URL ?? "https://allfantasy.ai" : "https://allfantasy.ai"
  const cards: LeagueCard[] = leagues.map((lg: any) => {
    const rules = (lg.scoringRules || {}) as any
    const mode = rules.mode || rules.scoringMode || "momentum"
    const joinUrl = `${baseUrl}/brackets/join?code=${encodeURIComponent(lg.joinCode)}`
    return {
      id: lg.id,
      name: lg.name,
      joinCode: lg.joinCode,
      sport: lg.tournament?.sport ?? "NFL",
      challengeType: typeof rules.challengeType === "string" ? rules.challengeType : null,
      bracketType: typeof rules.bracketType === "string" ? rules.bracketType : null,
      season: lg.tournament?.season ?? 0,
      tournamentName: lg.tournament?.name ?? "",
      tournamentId: lg.tournamentId,
      scoringMode: mode,
      isPaidLeague: Boolean(rules.isPaidLeague),
      isPrivate: Boolean(lg.isPrivate),
      memberCount: lg._count?.members ?? 0,
      entryCount: lg._count?.entries ?? 0,
      maxManagers: Number(lg.maxManagers) || 100,
      ownerName: lg.owner?.displayName ?? "Anonymous",
      ownerAvatar: lg.owner?.avatarUrl ?? null,
      joinUrl,
    }
  })

  return {
    leagues: cards,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  }
}
