/**
 * Champion Pick Leverage Calculator
 *
 * In bracket competitions (WC, March Madness, etc.), the champion pick is
 * worth a large number of points and is made up-front. This calculator
 * measures how much leverage — differentiation advantage — each champion
 * pick gives in the pool.
 *
 * High leverage = few others picked the same team AND points are large.
 * Chalk = most popular pick. Contrarian = picked by 15–39%.
 * Rare = picked by fewer than 15% of entries.
 */
import type { InsightEntry } from "./types"

type ChampionLeverage = {
  teamName: string
  entriesPicked: number
  pickPercent: number
  /** Points at stake for the champion pick. */
  pointsAtStake: number
  /**
   * 0–100: how much does picking this team separate you from the pack?
   * Higher = fewer others picked it relative to points at stake.
   */
  leverageScore: number
  differentiationLabel: "chalk" | "contrarian" | "rare"
  isCurrentUserPick: boolean
}

type ChampionPickLeverageResult = {
  picks: ChampionLeverage[]
  topPickTeam: string | null
  rarestPick: string | null
  /** Points the pool-wide chalk would lose if they're wrong. */
  chalkLossImpact: number
}

export function computeChampionPickLeverage(
  entries: InsightEntry[],
  championRound: string,
  championPointValue: number,
  currentUserEntryId?: string,
): ChampionPickLeverageResult {
  const champPicks = entries.flatMap((e) =>
    e.picks
      .filter((p) => p.round === championRound)
      .map((p) => ({ team: p.pickedTeam, isCurrentUser: e.entryId === currentUserEntryId })),
  )
  const total = champPicks.length || 1

  const countByTeam = new Map<string, { count: number; isCurrentUser: boolean }>()
  for (const p of champPicks) {
    const existing = countByTeam.get(p.team)
    countByTeam.set(p.team, {
      count: (existing?.count ?? 0) + 1,
      isCurrentUser: (existing?.isCurrentUser ?? false) || p.isCurrentUser,
    })
  }

  const picks: ChampionLeverage[] = [...countByTeam.entries()]
    .map(([teamName, { count, isCurrentUser }]) => {
      const pct = Math.round((count / total) * 100)
      // Leverage: inversely proportional to pick share, scaled by point value
      // A rare pick on a high-points game = high leverage
      const leverageScore = Math.min(
        100,
        Math.round((1 - count / total) * (championPointValue / 20) * 100),
      )
      const differentiationLabel: ChampionLeverage["differentiationLabel"] =
        pct >= 40 ? "chalk" : pct >= 15 ? "contrarian" : "rare"
      return {
        teamName,
        entriesPicked: count,
        pickPercent: pct,
        pointsAtStake: championPointValue,
        leverageScore: Math.max(1, leverageScore),
        differentiationLabel,
        isCurrentUserPick: isCurrentUser,
      }
    })
    .sort((a, b) => b.entriesPicked - a.entriesPicked)

  const topPickTeam = picks[0]?.teamName ?? null
  const rarestPick =
    [...picks].sort((a, b) => a.entriesPicked - b.entriesPicked)[0]?.teamName ?? null
  const chalkCount = picks[0]?.entriesPicked ?? 0
  const chalkLossImpact = chalkCount * championPointValue

  return { picks, topPickTeam, rarestPick, chalkLossImpact }
}
