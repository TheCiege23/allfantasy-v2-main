/**
 * worldCupUniquenessInsights.ts
 *
 * Pure deterministic helper for "What Makes My Bracket Unique?"
 *
 * Compares the current user's own bracket picks against pre-aggregated
 * distributions of finalized pool entries. The helper itself never
 * touches the database, the network, or other users' raw picks — the
 * route does the aggregation server-side and passes counts only.
 *
 * No LLM call. No external fetch. No PII (counts only).
 */
import { WORLD_CUP_ROUND_LABELS, type WorldCupRound } from "./types"

type UniquenessTag =
  | "Champion"
  | "Finalist"
  | "Semifinal"
  | "Knockout"
  | "Group"
  | "Chalk"

export type UniquenessRarity = "common" | "uncommon" | "rare" | "very_rare"

export type UniquenessInsight = {
  label: string
  description: string
  rarity: UniquenessRarity
  /** Percent of finalized brackets sharing this pick (0–100). Omitted for Chalk insights. */
  percentage?: number
  tag: UniquenessTag
}

type UniquenessStatus =
  | "ready"
  | "no_entry"
  | "not_enough_pool_data"
  | "incomplete"

export type UniquenessResult = {
  status: UniquenessStatus
  insights: UniquenessInsight[]
  lockedLines?: string[]
  /** Number of finalized entries used in comparison (for client copy). */
  finalizedEntryCount?: number
}

type UniquenessDistributionRow = { teamName: string; count: number }
type UniquenessDistribution = UniquenessDistributionRow[]

type BuildUniquenessInput = {
  /** User's own champion pick team name. Null if no champion selected. */
  ownChampionTeamName: string | null
  /** User's own picks grouped by round (knockout team names only). */
  ownPicksByRound: Partial<Record<WorldCupRound, string[]>>
  /**
   * Server-aggregated pool distributions. Each value is an array of
   * `{ teamName, count }` — counts over finalized pool entries only.
   * "champion" key is the champion-pick distribution; the rest are
   * keyed by WorldCupRound.
   */
  poolDistributions: {
    champion?: UniquenessDistribution
  } & Partial<Record<WorldCupRound, UniquenessDistribution>>
  /** Number of finalized entries used in `poolDistributions`. */
  finalizedEntryCount: number
  /** AF Pro entitlement — controls free 1 vs Pro 5 insight cap. */
  hasBracketBrainAi?: boolean
  /** Minimum finalized entries before uniqueness is meaningful (default 3). */
  minFinalizedEntries?: number
}

const DEFAULT_MIN_FINALIZED = 3

function rarityForPercentage(pct: number): UniquenessRarity {
  if (pct <= 10) return "very_rare"
  if (pct <= 25) return "rare"
  if (pct <= 50) return "uncommon"
  return "common"
}

function rarityScore(r: UniquenessRarity): number {
  return r === "very_rare" ? 4 : r === "rare" ? 3 : r === "uncommon" ? 2 : 1
}

const ROUND_TAG: Partial<Record<WorldCupRound, UniquenessTag>> = {
  final: "Finalist",
  semifinal: "Semifinal",
  quarterfinal: "Knockout",
  round_of_16: "Knockout",
  round_of_32: "Knockout",
}

const KNOCKOUT_ROUNDS_FOR_UNIQUENESS: WorldCupRound[] = [
  "final",
  "semifinal",
  "quarterfinal",
  "round_of_16",
  "round_of_32",
]

export function buildWorldCupBracketUniquenessInsights(
  input: BuildUniquenessInput
): UniquenessResult {
  const {
    ownChampionTeamName,
    ownPicksByRound,
    poolDistributions,
    finalizedEntryCount,
    hasBracketBrainAi = false,
    minFinalizedEntries = DEFAULT_MIN_FINALIZED,
  } = input

  if (finalizedEntryCount < minFinalizedEntries) {
    return {
      status: "not_enough_pool_data",
      insights: [],
      finalizedEntryCount,
      lockedLines: [
        `Uniqueness unlocks after more finalized brackets are submitted (${finalizedEntryCount}/${minFinalizedEntries}).`,
      ],
    }
  }

  const totalOwnPicks = Object.values(ownPicksByRound).reduce(
    (sum, arr) => sum + (arr?.length ?? 0),
    0
  )
  if (!ownChampionTeamName && totalOwnPicks === 0) {
    return {
      status: "incomplete",
      insights: [],
      finalizedEntryCount,
      lockedLines: [
        "Make group and knockout picks to see how unique your bracket is.",
      ],
    }
  }

  const insights: UniquenessInsight[] = []

  // 1. Champion uniqueness — highest priority.
  if (ownChampionTeamName && poolDistributions.champion) {
    const entry = poolDistributions.champion.find(
      (d) => d.teamName === ownChampionTeamName
    )
    const ownCount = entry?.count ?? 0
    const pct = Math.round((ownCount / finalizedEntryCount) * 100)
    const rarity = rarityForPercentage(pct)

    const description =
      rarity === "very_rare"
        ? `Your champion pick ${ownChampionTeamName} is shared by only ${pct}% of finalized brackets — a high-upside contrarian call.`
        : rarity === "rare"
        ? `Your champion pick ${ownChampionTeamName} is held by ${pct}% of finalized brackets — uncommon enough to create separation if it hits.`
        : rarity === "uncommon"
        ? `Your champion pick ${ownChampionTeamName} is held by ${pct}% of finalized brackets — moderate uniqueness.`
        : `Your champion pick ${ownChampionTeamName} is held by ${pct}% of finalized brackets — popular pick, protects floor more than upside.`

    insights.push({
      label: `Champion: ${ownChampionTeamName}`,
      description,
      rarity,
      percentage: pct,
      tag: "Champion",
    })
  }

  // 2-5. Per-round knockout uniqueness — surface the rarest own pick per round.
  for (const round of KNOCKOUT_ROUNDS_FOR_UNIQUENESS) {
    const ownPicks = ownPicksByRound[round] ?? []
    const dist = poolDistributions[round]
    if (!dist || ownPicks.length === 0) continue

    let rarest:
      | { name: string; pct: number; rarity: UniquenessRarity; count: number }
      | null = null
    for (const teamName of ownPicks) {
      const distEntry = dist.find((d) => d.teamName === teamName)
      const count = distEntry?.count ?? 0
      const pct = Math.round((count / finalizedEntryCount) * 100)
      const rarity = rarityForPercentage(pct)
      if (!rarest || rarityScore(rarity) > rarityScore(rarest.rarity)) {
        rarest = { name: teamName, pct, rarity, count }
      }
    }

    if (!rarest || rarest.rarity === "common") continue

    const tag = ROUND_TAG[round] ?? "Knockout"
    const roundLabel = WORLD_CUP_ROUND_LABELS[round]
    const matchingBracketCount = Math.max(1, rarest.count)
    const description =
      rarest.rarity === "very_rare"
        ? `You're one of just ${matchingBracketCount} finalized brackets with ${rarest.name} reaching the ${roundLabel}.`
        : `${rarest.name} reaching the ${roundLabel} is held by ${rarest.pct}% of finalized brackets.`

    insights.push({
      label: `${tag}: ${rarest.name} in ${roundLabel}`,
      description,
      rarity: rarest.rarity,
      percentage: rarest.pct,
      tag,
    })
  }

  // 6. Chalk fallback when nothing interesting bubbled up.
  if (insights.length === 0) {
    insights.push({
      label: "Mostly chalk",
      description:
        "Your bracket aligns closely with the most popular pool picks. You'll need your champion path to hit to separate from the field.",
      rarity: "common",
      tag: "Chalk",
    })
  }

  // Sort by rarity desc, then by rarest percentage asc.
  insights.sort((a, b) => {
    const rarityDiff = rarityScore(b.rarity) - rarityScore(a.rarity)
    if (rarityDiff !== 0) return rarityDiff
    return (a.percentage ?? 100) - (b.percentage ?? 100)
  })

  const limit = hasBracketBrainAi ? 5 : 1
  const limited = insights.slice(0, limit)

  const result: UniquenessResult = {
    status: "ready",
    insights: limited,
    finalizedEntryCount,
  }

  if (!hasBracketBrainAi && insights.length > 1) {
    result.lockedLines = [
      `AF Pro unlocks ${Math.min(5, insights.length)} uniqueness insights with rarity breakdown.`,
    ]
  }

  return result
}
