import type { SupportedSport } from "@/lib/sport-scope"

type PlayoffChallengeRef = {
  challengeId: string
  sport: "nba" | "nhl" | "mlb" | "ncaaf" | "nba_cup"
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

    if (["nba", "nhl", "mlb", "ncaaf", "nba_cup"].includes(normalizedSport)) {
      return `/brackets/leagues/new?sport=${normalizedSport}&challengeType=playoff_challenge`
    }

    if (normalizedSport === "soccer") {
      // Soccer pools live in the World Cup product, not the legacy bracket league stack.
      return "/brackets/world-cup"
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
