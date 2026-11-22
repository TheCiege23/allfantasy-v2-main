/**
 * Upset Impact Calculator
 *
 * For each upcoming match, assume the less-popular pick wins (the "upset").
 * Compute: who gains, who loses, does the leader take a hit, how dramatic is it?
 *
 * "favorite" = the team more pool entries picked (not necessarily Vegas favorite).
 * "underdog" = the team fewer pool entries picked.
 *
 * impactLabel:
 *   "pool-shaking" = chaos ≥ 8 AND the leader would lose points
 *   "significant"  = chaos ≥ 6
 *   "moderate"     = chaos ≥ 4
 *   "low"          = chaos < 4 or heavily one-sided
 */
import type { InsightPool } from "./types"

type UpsetImpactResult = {
  matchId: string
  matchDescription: string
  round: string
  /** Team with more pool picks — not necessarily Vegas favorite. */
  poolFavorite: string
  /** Team with fewer pool picks. */
  poolUnderdog: string
  favoritePickPercent: number
  underdogPickPercent: number
  /** Entries who picked the underdog — they benefit from the upset. */
  underdogWinnersCount: number
  /** Entries who picked the favorite — they get hurt. */
  favoritePickersCount: number
  /** Rank of the highest-ranked entry that benefits from the upset. */
  highestBeneficiaryRank: number | null
  /** Points the current leader stands to lose if they backed the favorite. */
  leaderExposure: number
  /** Whether the leader picked the favorite (upset hurts the leader). */
  leaderPickedFavorite: boolean
  /** 1–10 chaos rating for this match. */
  chaosRating: number
  impactLabel: "pool-shaking" | "significant" | "moderate" | "low"
}

type UpsetImpactSummary = {
  results: UpsetImpactResult[]
  /** The match where an upset would be most dramatic. */
  mostImpactful: UpsetImpactResult | null
}

const ROUND_WEIGHT: Record<string, number> = {
  group: 0.7,
  round_of_32: 0.75,
  round_of_16: 0.85,
  quarter_final: 0.9,
  semi_final: 1.0,
  final: 1.0,
  third_place: 0.6,
}

export function computeUpsetImpact(pool: InsightPool): UpsetImpactSummary {
  const upcoming = pool.matches.filter((m) => m.status === "scheduled")

  const results: UpsetImpactResult[] = upcoming.map((match) => {
    const { home, away } = match.pickDistribution
    const total = home + away || 1

    // Pool favorite = more picked team
    const [favTeam, favPicks, underdogTeam, underdogPicks] =
      home >= away
        ? [match.homeTeam, home, match.awayTeam, away]
        : [match.awayTeam, away, match.homeTeam, home]

    const balance = Math.min(favPicks, underdogPicks) / total
    const w = ROUND_WEIGHT[match.round] ?? 0.8
    const chaosRating = Math.max(1, Math.min(10, Math.round(balance * w * 20)))

    const underdogPickers = pool.entries.filter((e) =>
      e.picks.some((p) => p.matchId === match.matchId && p.pickedTeam === underdogTeam),
    )
    const favoritePickers = pool.entries.filter((e) =>
      e.picks.some((p) => p.matchId === match.matchId && p.pickedTeam === favTeam),
    )

    const highestBeneficiary = underdogPickers.reduce<(typeof pool.entries)[0] | null>(
      (best, e) => (!best || e.rank < best.rank ? e : best),
      null,
    )

    const leader = pool.entries.find((e) => e.rank === 1)
    const leaderPickedFavorite =
      leader?.picks.some(
        (p) => p.matchId === match.matchId && p.pickedTeam === favTeam,
      ) ?? false
    const leaderExposure = leaderPickedFavorite ? match.pointsAtStake : 0

    const impactLabel: UpsetImpactResult["impactLabel"] =
      chaosRating >= 8 && leaderExposure > 0
        ? "pool-shaking"
        : chaosRating >= 6
          ? "significant"
          : chaosRating >= 4
            ? "moderate"
            : "low"

    return {
      matchId: match.matchId,
      matchDescription: `${match.homeTeam} vs ${match.awayTeam}`,
      round: match.round,
      poolFavorite: favTeam,
      poolUnderdog: underdogTeam,
      favoritePickPercent: Math.round((favPicks / total) * 100),
      underdogPickPercent: Math.round((underdogPicks / total) * 100),
      underdogWinnersCount: underdogPickers.length,
      favoritePickersCount: favoritePickers.length,
      highestBeneficiaryRank: highestBeneficiary?.rank ?? null,
      leaderExposure,
      leaderPickedFavorite,
      chaosRating,
      impactLabel,
    }
  })

  const mostImpactful =
    results.length > 0
      ? results.reduce((best, r) =>
          r.chaosRating + r.leaderExposure > best.chaosRating + best.leaderExposure ? r : best,
        )
      : null

  return { results, mostImpactful }
}
