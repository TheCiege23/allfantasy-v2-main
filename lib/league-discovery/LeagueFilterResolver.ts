/**
 * LeagueFilterResolver — filter options and Prisma where for bracket league discovery.
 */

import type { Prisma } from "@prisma/client"
import { SUPPORTED_SPORTS } from "@/lib/sport-scope"

export const LEAGUE_TYPE_IDS = [
  "fancred_edge",
  "momentum",
  "accuracy_boldness",
  "streak_survival",
] as const
export type LeagueTypeId = (typeof LEAGUE_TYPE_IDS)[number]

export const ENTRY_FEE_IDS = ["all", "free", "paid"] as const
export type EntryFeeId = (typeof ENTRY_FEE_IDS)[number]

export const VISIBILITY_IDS = ["all", "public", "private"] as const
export type VisibilityId = (typeof VISIBILITY_IDS)[number]

export const DIFFICULTY_IDS = ["all", "casual", "competitive"] as const
export type DifficultyId = (typeof DIFFICULTY_IDS)[number]

export interface LeagueFilterOptions {
  sports: { value: string; label: string }[]
  leagueTypes: { value: LeagueTypeId; label: string }[]
  entryFees: { value: EntryFeeId; label: string }[]
  visibilities: { value: VisibilityId; label: string }[]
  difficulties: { value: DifficultyId; label: string }[]
}

export function getLeagueFilterOptions(): LeagueFilterOptions {
  return {
    sports: SUPPORTED_SPORTS.map((s) => ({ value: s, label: s })),
    leagueTypes: [
      { value: "fancred_edge", label: "AF Edge" },
      { value: "momentum", label: "Momentum" },
      { value: "accuracy_boldness", label: "Accuracy + Boldness" },
      { value: "streak_survival", label: "Streak & Survival" },
    ],
    entryFees: [
      { value: "all", label: "Any entry fee" },
      { value: "free", label: "Free" },
      { value: "paid", label: "Paid" },
    ],
    visibilities: [
      { value: "all", label: "Any visibility" },
      { value: "public", label: "Public" },
      { value: "private", label: "Private" },
    ],
    difficulties: [
      { value: "all", label: "Any difficulty" },
      { value: "casual", label: "Casual" },
      { value: "competitive", label: "Competitive" },
    ],
  }
}

/** Difficulty maps to scoring mode: casual = momentum/streak_survival, competitive = fancred_edge/accuracy_boldness */
function difficultyToLeagueTypes(difficulty: DifficultyId): LeagueTypeId[] | null {
  if (difficulty === "all") return null
  if (difficulty === "casual") return ["momentum", "streak_survival"]
  if (difficulty === "competitive") return ["fancred_edge", "accuracy_boldness"]
  return null
}

export interface ResolvedFilters {
  sport: string | null
  leagueType: LeagueTypeId | null
  entryFee: EntryFeeId
  visibility: VisibilityId
  difficulty: DifficultyId | null
}

export function resolveFilters(params: {
  sport?: string | null
  leagueType?: string | null
  entryFee?: string | null
  visibility?: string | null
  difficulty?: string | null
}): ResolvedFilters {
  const sport =
    params.sport && SUPPORTED_SPORTS.includes(params.sport as any) ? params.sport : null
  const leagueType =
    params.leagueType && LEAGUE_TYPE_IDS.includes(params.leagueType as LeagueTypeId)
      ? (params.leagueType as LeagueTypeId)
      : null
  const entryFee = ENTRY_FEE_IDS.includes((params.entryFee as EntryFeeId) ?? "all")
    ? ((params.entryFee as EntryFeeId) ?? "all")
    : "all"
  const visibility = VISIBILITY_IDS.includes((params.visibility as VisibilityId) ?? "all")
    ? ((params.visibility as VisibilityId) ?? "all")
    : "all"
  const difficulty = DIFFICULTY_IDS.includes((params.difficulty as DifficultyId) ?? "all")
    ? ((params.difficulty as DifficultyId) ?? "all")
    : "all"
  return {
    sport,
    leagueType,
    entryFee,
    visibility,
    difficulty: difficulty === "all" ? null : difficulty,
  }
}

/**
 * Build Prisma where for BracketLeague (sport, visibility, search only).
 * leagueType, entryFee, difficulty are applied in-memory in LeagueDiscoveryService.
 */
export function buildDiscoveryWhere(
  resolved: ResolvedFilters,
  searchWhere?: Prisma.BracketLeagueWhereInput
): Prisma.BracketLeagueWhereInput {
  const and: Prisma.BracketLeagueWhereInput[] = []

  if (resolved.sport) {
    if (resolved.sport === 'NCAAB') {
      and.push({ tournament: { sport: { in: ['NCAAB', 'ncaam'] } } })
    } else {
      and.push({ tournament: { sport: resolved.sport } })
    }
  }

  if (resolved.visibility !== "all") {
    and.push({ isPrivate: resolved.visibility === "private" })
  }

  if (searchWhere) {
    and.push(searchWhere)
  }

  if (and.length === 0) return {}
  return { AND: and }
}

/** Apply in-memory filter by scoringRules (mode, isPaidLeague) and difficulty. */
export function matchesLeagueTypeAndFee(
  scoringRules: Record<string, unknown> | null | undefined,
  resolved: ResolvedFilters
): boolean {
  const rules = scoringRules || {}
  const mode = (rules.mode ?? rules.scoringMode ?? "momentum") as string
  const isPaid = Boolean(rules.isPaidLeague)

  if (resolved.leagueType && mode !== resolved.leagueType) return false
  if (resolved.entryFee === "free" && isPaid) return false
  if (resolved.entryFee === "paid" && !isPaid) return false

  if (resolved.difficulty && !resolved.leagueType) {
    const types = difficultyToLeagueTypes(resolved.difficulty)
    if (types && types.length > 0 && !types.includes(mode as LeagueTypeId)) return false
  }
  return true
}
