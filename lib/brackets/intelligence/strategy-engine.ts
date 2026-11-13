import { computeWinProbability } from "./data-engine"

export type RiskProfile = {
  riskTolerance: "conservative" | "balanced" | "chaos"
  poolCount: number
  poolSizeEstimate: number
  goal: "mincash" | "win_big"
}

export const DEFAULT_RISK_PROFILE: RiskProfile = {
  riskTolerance: "balanced",
  poolCount: 1,
  poolSizeEstimate: 20,
  goal: "mincash",
}

export type BracketStyle = "safe" | "balanced" | "upset_heavy" | "chaos"

export type StrategyRecommendation = {
  recommendedPick: string
  confidence: number
  reasoning: string
  leveragePlay: boolean
  style: BracketStyle
}

export type MultiBracketPlan = {
  count: number
  brackets: Array<{
    style: BracketStyle
    label: string
    upsetFrequency: number
    description: string
  }>
}

export function getStrategyBias(profile: RiskProfile): {
  upsetWeight: number
  chalkWeight: number
  leverageWeight: number
  varianceTarget: number
} {
  const { riskTolerance, poolCount, poolSizeEstimate, goal } = profile

  let upsetWeight = 0.2
  let chalkWeight = 0.6
  let leverageWeight = 0.2
  let varianceTarget = 0.3

  if (riskTolerance === "conservative") {
    upsetWeight = 0.1
    chalkWeight = 0.75
    leverageWeight = 0.15
    varianceTarget = 0.15
  } else if (riskTolerance === "chaos") {
    upsetWeight = 0.45
    chalkWeight = 0.25
    leverageWeight = 0.3
    varianceTarget = 0.7
  }

  if (poolCount > 5) {
    varianceTarget = Math.min(0.9, varianceTarget + 0.15)
    leverageWeight = Math.min(0.5, leverageWeight + 0.1)
  }

  if (poolSizeEstimate > 50) {
    leverageWeight = Math.min(0.5, leverageWeight + 0.1)
    upsetWeight = Math.min(0.5, upsetWeight + 0.05)
    chalkWeight = Math.max(0.2, chalkWeight - 0.1)
  }

  if (goal === "win_big") {
    upsetWeight = Math.min(0.55, upsetWeight + 0.1)
    chalkWeight = Math.max(0.15, chalkWeight - 0.15)
    leverageWeight = Math.min(0.5, leverageWeight + 0.1)
    varianceTarget = Math.min(0.85, varianceTarget + 0.2)
  }

  const total = upsetWeight + chalkWeight + leverageWeight
  upsetWeight = Math.round((upsetWeight / total) * 100) / 100
  chalkWeight = Math.round((chalkWeight / total) * 100) / 100
  leverageWeight = Math.round((leverageWeight / total) * 100) / 100

  return { upsetWeight, chalkWeight, leverageWeight, varianceTarget }
}

export function recommendPick(
  teamA: string,
  teamB: string,
  seedA: number | null,
  seedB: number | null,
  publicPickPctA: number,
  publicPickPctB: number,
  profile: RiskProfile,
  round: number
): StrategyRecommendation {
  const { teamA: probA, teamB: probB } = computeWinProbability(seedA, seedB)
  const bias = getStrategyBias(profile)

  const scoreA =
    probA * bias.chalkWeight +
    (1 - publicPickPctA) * bias.leverageWeight +
    (seedA != null && seedB != null && seedA > seedB ? 0.3 : 0) * bias.upsetWeight

  const scoreB =
    probB * bias.chalkWeight +
    (1 - publicPickPctB) * bias.leverageWeight +
    (seedB != null && seedA != null && seedB > seedA ? 0.3 : 0) * bias.upsetWeight

  const recommended = scoreA >= scoreB ? teamA : teamB
  const isUpsetPick = recommended === teamA
    ? (seedA != null && seedB != null && seedA > seedB)
    : (seedB != null && seedA != null && seedB > seedA)

  const leveragePlay = isUpsetPick && (
    (recommended === teamA && publicPickPctA < 0.3) ||
    (recommended === teamB && publicPickPctB < 0.3)
  )

  let style: BracketStyle = "balanced"
  if (profile.riskTolerance === "conservative") style = "safe"
  else if (profile.riskTolerance === "chaos") style = isUpsetPick ? "chaos" : "upset_heavy"
  else if (isUpsetPick) style = "upset_heavy"

  const confidence = Math.round(Math.max(scoreA, scoreB) * 100)

  const favoredTeam = probA >= probB ? teamA : teamB
  const reasoning = recommended === favoredTeam
    ? `${recommended} is the higher-probability pick with a ${Math.round(Math.max(probA, probB) * 100)}% win probability.`
    : `${recommended} offers leverage value — only ${Math.round((recommended === teamA ? publicPickPctA : publicPickPctB) * 100)}% of the pool is picking them.`

  return {
    recommendedPick: recommended,
    confidence,
    reasoning,
    leveragePlay,
    style,
  }
}

export function generateMultiBracketPlan(
  profile: RiskProfile,
  count: number = 3
): MultiBracketPlan {
  const effectiveCount = Math.min(10, Math.max(1, count))
  const brackets: MultiBracketPlan["brackets"] = []

  if (profile.goal === "mincash" || profile.riskTolerance === "conservative") {
    const safeCount = Math.ceil(effectiveCount * 0.5)
    const balancedCount = Math.ceil(effectiveCount * 0.35)
    const upsetCount = effectiveCount - safeCount - balancedCount

    for (let i = 0; i < Math.max(safeCount, 1); i++) {
      brackets.push({ style: "safe", label: `Safe #${i + 1}`, upsetFrequency: 0.1, description: "Favors higher seeds. Maximizes probability of a solid finish." })
    }
    for (let i = 0; i < Math.max(balancedCount, 0); i++) {
      brackets.push({ style: "balanced", label: `Balanced #${i + 1}`, upsetFrequency: 0.25, description: "Mix of chalk and smart upsets. A well-rounded bracket." })
    }
    for (let i = 0; i < Math.max(upsetCount, 0); i++) {
      brackets.push({ style: "upset_heavy", label: `Upset Dart #${i + 1}`, upsetFrequency: 0.45, description: "Targeted upsets in high-leverage spots." })
    }
  } else if (profile.goal === "win_big" || profile.riskTolerance === "chaos") {
    const chaosCount = Math.ceil(effectiveCount * 0.4)
    const upsetCount = Math.ceil(effectiveCount * 0.35)
    const balancedCount = effectiveCount - chaosCount - upsetCount

    for (let i = 0; i < Math.max(balancedCount, 1); i++) {
      brackets.push({ style: "balanced", label: `Balanced #${i + 1}`, upsetFrequency: 0.25, description: "Your anchor bracket. Solid base with calculated upsets." })
    }
    for (let i = 0; i < upsetCount; i++) {
      brackets.push({ style: "upset_heavy", label: `High Variance #${i + 1}`, upsetFrequency: 0.5, description: "Aggressive upset picks targeting low-ownership teams." })
    }
    for (let i = 0; i < chaosCount; i++) {
      brackets.push({ style: "chaos", label: `Chaos #${i + 1}`, upsetFrequency: 0.65, description: "Maximum differentiation. Designed to win in large pools." })
    }
  } else {
    const safeCount = 1
    const balancedCount = Math.max(1, Math.floor((effectiveCount - 1) * 0.6))
    const upsetCount = effectiveCount - safeCount - balancedCount

    brackets.push({ style: "safe", label: "Safe #1", upsetFrequency: 0.1, description: "Your safety net. Mostly chalk picks." })
    for (let i = 0; i < balancedCount; i++) {
      brackets.push({ style: "balanced", label: `Balanced #${i + 1}`, upsetFrequency: 0.25, description: "Smart mix of favorites and targeted upsets." })
    }
    for (let i = 0; i < Math.max(upsetCount, 0); i++) {
      brackets.push({ style: "upset_heavy", label: `Upset #${i + 1}`, upsetFrequency: 0.45, description: "Bold picks in spots where upsets have historical support." })
    }
  }

  return { count: brackets.length, brackets: brackets.slice(0, effectiveCount) }
}

export function shouldUpset(
  seedFavorite: number,
  seedUnderdog: number,
  upsetFrequency: number,
  round: number
): boolean {
  const historicalUpsetRate: Record<string, number> = {
    "1-16": 0.01, "2-15": 0.06, "3-14": 0.15, "4-13": 0.21,
    "5-12": 0.35, "6-11": 0.37, "7-10": 0.39, "8-9": 0.49,
  }

  const key = `${seedFavorite}-${seedUnderdog}`
  const baseRate = historicalUpsetRate[key] ?? 0.3

  const adjustedRate = baseRate * (0.5 + upsetFrequency)
  const roundPenalty = round > 3 ? (round - 3) * 0.05 : 0

  return Math.random() < (adjustedRate - roundPenalty)
}
