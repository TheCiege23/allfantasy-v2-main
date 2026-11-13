export type ScoringMode = "fancred_edge" | "momentum" | "accuracy_boldness" | "streak_survival"

export type BonusFlags = {
  upsetDeltaEnabled?: boolean
  leverageBonusEnabled?: boolean
  insuranceEnabled?: boolean
}

export type ScoringRules = {
  mode: ScoringMode
  maxEntriesPerUser?: number
  isPaidLeague?: boolean
  insuranceEnabled?: boolean
  insurancePerEntry?: number
  upsetDeltaEnabled?: boolean
  leverageBonusEnabled?: boolean
  allowCopyBracket?: boolean
  pickVisibility?: "visible" | "hidden_until_lock"
}

export function scoringConfigKey(mode: ScoringMode, flags: BonusFlags): string {
  const parts: string[] = [mode]
  if (flags.upsetDeltaEnabled) parts.push("upset")
  if (flags.leverageBonusEnabled) parts.push("leverage")
  if (flags.insuranceEnabled) parts.push("insurance")
  return parts.join("+")
}

export function bonusFlagsFromRules(rules: any): BonusFlags {
  return {
    upsetDeltaEnabled: rules.upsetDeltaEnabled !== false,
    leverageBonusEnabled: rules.leverageBonusEnabled !== false,
    insuranceEnabled: rules.insuranceEnabled === true,
  }
}

export type PickResult = {
  nodeId: string
  round: number
  pickedTeamName: string | null
  isCorrect: boolean | null
  pickedSeed: number | null
  actualWinnerSeed: number | null
  opponentSeed: number | null
}

export type LeaguePickDistribution = Record<string, Record<string, number>>

export function pointsForRound(round: number, roundPoints?: Record<number, number>): number {
  if (roundPoints && Number.isFinite(roundPoints[round])) {
    return Math.max(0, Number(roundPoints[round]))
  }

  switch (round) {
    case 0: return 0
    case 1: return 1
    case 2: return 2
    case 3: return 4
    case 4: return 8
    case 5: return 16
    case 6: return 32
    default: return 0
  }
}

export function edgePointsForRound(round: number, roundPoints?: Record<number, number>): number {
  if (roundPoints && Number.isFinite(roundPoints[round])) {
    return Math.max(0, Number(roundPoints[round]))
  }

  switch (round) {
    case 1: return 1
    case 2: return 2
    case 3: return 5
    case 4: return 10
    case 5: return 18
    case 6: return 30
    default: return 0
  }
}

export function scoreFanCredEdge(
  picks: PickResult[],
  leagueDistribution: LeaguePickDistribution,
  insuranceNodeId?: string | null,
  flags?: BonusFlags,
  roundPoints?: Record<number, number>
): {
  total: number
  breakdown: Array<{
    nodeId: string
    base: number
    upsetDelta: number
    leverageBonus: number
    insured: boolean
    total: number
  }>
} {
  const enableUpset = flags?.upsetDeltaEnabled !== false
  const enableLeverage = flags?.leverageBonusEnabled !== false
  const enableInsurance = flags?.insuranceEnabled !== false

  const breakdown: Array<{
    nodeId: string
    base: number
    upsetDelta: number
    leverageBonus: number
    insured: boolean
    total: number
  }> = []
  let total = 0

  for (const pick of picks) {
    const isInsured = enableInsurance && insuranceNodeId === pick.nodeId

    if (pick.isCorrect !== true) {
      if (isInsured && pick.isCorrect === false) {
        const partialBase = Math.ceil(edgePointsForRound(pick.round, roundPoints) * 0.5)
        total += partialBase
        breakdown.push({
          nodeId: pick.nodeId,
          base: partialBase,
          upsetDelta: 0,
          leverageBonus: 0,
          insured: true,
          total: partialBase,
        })
      } else {
        breakdown.push({
          nodeId: pick.nodeId,
          base: 0,
          upsetDelta: 0,
          leverageBonus: 0,
          insured: isInsured,
          total: 0,
        })
      }
      continue
    }

    const base = edgePointsForRound(pick.round, roundPoints)

    let upsetDelta = 0
    if (
      enableUpset &&
      pick.pickedSeed != null &&
      pick.opponentSeed != null &&
      pick.pickedSeed > pick.opponentSeed
    ) {
      upsetDelta = Math.min(8, pick.pickedSeed - pick.opponentSeed)
    }

    let leverageBonus = 0
    if (enableLeverage) {
      const nodeDist = leagueDistribution[pick.nodeId]
      if (nodeDist && pick.pickedTeamName) {
        const totalPickers = Object.values(nodeDist).reduce((a, b) => a + b, 0)
        const thisPick = nodeDist[pick.pickedTeamName] ?? 0
        if (totalPickers > 0) {
          const pickPct = thisPick / totalPickers
          leverageBonus = Math.min(6, Math.round(base * (1 - pickPct) * 10) / 10)
        }
      }
    }

    const pts = base + upsetDelta + leverageBonus
    total += pts
    breakdown.push({
      nodeId: pick.nodeId,
      base,
      upsetDelta,
      leverageBonus,
      insured: isInsured,
      total: pts,
    })
  }

  return { total, breakdown }
}

export function scoreMomentum(
  picks: PickResult[],
  roundPoints?: Record<number, number>
): {
  total: number
  breakdown: Array<{ nodeId: string; base: number; upsetBonus: number; total: number }>
} {
  const breakdown: Array<{ nodeId: string; base: number; upsetBonus: number; total: number }> = []
  let total = 0

  for (const pick of picks) {
    if (pick.isCorrect !== true) {
      breakdown.push({ nodeId: pick.nodeId, base: 0, upsetBonus: 0, total: 0 })
      continue
    }

    const base = pointsForRound(pick.round, roundPoints)

    let upsetBonus = 0
    if (
      pick.pickedSeed != null &&
      pick.opponentSeed != null &&
      pick.pickedSeed > pick.opponentSeed
    ) {
      const seedGap = pick.pickedSeed - pick.opponentSeed
      upsetBonus = Math.floor(seedGap * (1 + pick.round * 0.5))
    }

    const pts = base + upsetBonus
    total += pts
    breakdown.push({ nodeId: pick.nodeId, base, upsetBonus, total: pts })
  }

  return { total, breakdown }
}

export function scoreAccuracyBoldness(
  picks: PickResult[],
  leagueDistribution: LeaguePickDistribution,
  roundPoints?: Record<number, number>
): {
  total: number
  breakdown: Array<{ nodeId: string; base: number; uniquenessBonus: number; total: number }>
} {
  const breakdown: Array<{ nodeId: string; base: number; uniquenessBonus: number; total: number }> = []
  let total = 0

  for (const pick of picks) {
    if (pick.isCorrect !== true || !pick.pickedTeamName) {
      breakdown.push({ nodeId: pick.nodeId, base: 0, uniquenessBonus: 0, total: 0 })
      continue
    }

    const base = pointsForRound(pick.round, roundPoints)

    let uniquenessBonus = 0
    const nodeDist = leagueDistribution[pick.nodeId]
    if (nodeDist) {
      const totalPickers = Object.values(nodeDist).reduce((a, b) => a + b, 0)
      const thisPick = nodeDist[pick.pickedTeamName] ?? 0
      if (totalPickers > 0) {
        const pickPct = thisPick / totalPickers
        if (pickPct < 0.25) {
          uniquenessBonus = Math.ceil(base * 1.5)
        } else if (pickPct < 0.40) {
          uniquenessBonus = Math.ceil(base * 0.75)
        } else if (pickPct < 0.50) {
          uniquenessBonus = Math.ceil(base * 0.25)
        }
      }
    }

    const pts = base + uniquenessBonus
    total += pts
    breakdown.push({ nodeId: pick.nodeId, base, uniquenessBonus, total: pts })
  }

  return { total, breakdown }
}

export function scoreStreakSurvival(
  picks: PickResult[],
  roundPoints?: Record<number, number>
): {
  total: number
  currentStreak: number
  longestStreak: number
  breakdown: Array<{ nodeId: string; base: number; streakBonus: number; total: number }>
} {
  const sorted = [...picks].sort((a, b) => a.round - b.round)

  const breakdown: Array<{ nodeId: string; base: number; streakBonus: number; total: number }> = []
  let total = 0
  let currentStreak = 0
  let longestStreak = 0

  for (const pick of sorted) {
    if (pick.isCorrect !== true) {
      currentStreak = 0
      breakdown.push({ nodeId: pick.nodeId, base: 0, streakBonus: 0, total: 0 })
      continue
    }

    currentStreak++
    longestStreak = Math.max(longestStreak, currentStreak)

    const base = pointsForRound(pick.round, roundPoints)

    let streakBonus = 0
    if (currentStreak >= 3) {
      const streakMultiplier = Math.min(currentStreak - 2, 5)
      const roundScale = Math.max(1, pick.round)
      streakBonus = streakMultiplier * roundScale
    }

    const pts = base + streakBonus
    total += pts
    breakdown.push({ nodeId: pick.nodeId, base, streakBonus, total: pts })
  }

  return { total, currentStreak, longestStreak, breakdown }
}

export function scoreEntry(
  mode: ScoringMode,
  picks: PickResult[],
  leagueDistribution?: LeaguePickDistribution,
  insuranceNodeId?: string | null,
  flags?: BonusFlags,
  roundPoints?: Record<number, number>
): { total: number; details: any } {
  switch (mode) {
    case "fancred_edge": {
      const result = scoreFanCredEdge(picks, leagueDistribution || {}, insuranceNodeId, flags, roundPoints)
      return { total: result.total, details: result }
    }
    case "accuracy_boldness": {
      const result = scoreAccuracyBoldness(picks, leagueDistribution || {}, roundPoints)
      return { total: result.total, details: result }
    }
    case "streak_survival": {
      const result = scoreStreakSurvival(picks, roundPoints)
      return { total: result.total, details: result }
    }
    case "momentum":
    default: {
      const result = scoreMomentum(picks, roundPoints)
      return { total: result.total, details: result }
    }
  }
}

export const SCORING_MODE_INFO: Record<ScoringMode, { label: string; description: string }> = {
  fancred_edge: {
    label: "AF March Madness",
    description: "Headline scoring: R64=1, R32=2, S16=5, E8=10, F4=18, CH=30. Upset Delta Bonus + Leverage Bonus from league pick rarity. Optional Insurance Token protects one pick.",
  },
  momentum: {
    label: "Momentum Scoring",
    description: "Base points per round + upset seed-gap bonus. Rewards correctly picking underdogs with bonus points that scale by round depth.",
  },
  accuracy_boldness: {
    label: "Accuracy + Boldness",
    description: "Base points per round + uniqueness bonus based on league pick distribution. Bold, less popular correct picks earn extra points.",
  },
  streak_survival: {
    label: "Streak & Survival",
    description: "Base points per round + streak bonuses that scale deeper into the tournament. Consecutive correct picks build multiplying bonuses.",
  },
}
