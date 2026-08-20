import type { SupportedSport } from "@/lib/sport-scope"

type PlayoffChallengeRef = {
  challengeId: string
  sport: string
}

type MyPoolCardInput = {
  poolId: string
  sport: string | null | undefined
  challengeType?: string | null
  bracketType?: string | null
  playoffBySport: Map<string, PlayoffChallengeRef>
}

export function resolvePlayoffCardHref(input: {
  sport: SupportedSport | string
  playoffBySport: Map<string, PlayoffChallengeRef>
}): string {
  try {
    const normalizedSport = String(input?.sport ?? "").toLowerCase()
    if (!normalizedSport) return "/brackets"
    if (normalizedSport === "soccer" || normalizedSport === "fifa" || normalizedSport === "world_cup") {
      return "/brackets/world-cup/create"
    }

    const bySport = input?.playoffBySport
    const existing = bySport instanceof Map ? bySport.get(normalizedSport) : undefined
    if (existing?.challengeId) {
      return `/brackets/leagues/${existing.challengeId}`
    }

    if (normalizedSport === "nhl") {
      return "/brackets/nhl"
    }

    if (normalizedSport === "nba") {
      return "/brackets/nba"
    }

    return "/brackets"
  } catch {
    return "/brackets"
  }
}

export function resolvePlayoffCardMode(input: {
  sport: SupportedSport | string
  playoffBySport: Map<string, PlayoffChallengeRef>
}): "open" | "create" {
  try {
    const normalizedSport = String(input?.sport ?? "").toLowerCase()
    if (!normalizedSport) return "create"
    const bySport = input?.playoffBySport
    if (!(bySport instanceof Map)) return "create"
    return bySport.has(normalizedSport) ? "open" : "create"
  } catch {
    return "create"
  }
}

export function resolveMyPoolCardHref(input: MyPoolCardInput): string {
  try {
    const poolId = String(input?.poolId ?? "").trim()
    if (!poolId) return "/brackets"

    return `/brackets/leagues/${poolId}`
  } catch {
    return "/brackets"
  }
}
