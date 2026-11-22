/**
 * worldCupAiInsights.ts
 *
 * Deterministic helper functions for AI-assisted World Cup bracket strategy.
 * These run purely from available match/team data — no LLM calls.
 * They produce structured outputs that can be shown directly to users OR
 * passed as context to an LLM for a richer generative summary.
 */
import type { WorldCupAiStrategy, WorldCupBracketHealth, WorldCupMatchView, WorldCupPickView } from "./types"
import { hasWorldCupPickSelection } from "./worldCupProjectedBracket"

// ── FIFA seed / rank lookup ───────────────────────────────────────────────────
// Slot-key-based rough strength tier for the 2026 World Cup.
// These are approximate and should be overridden by real FIFA rank data when available.
const SLOT_STRENGTH: Record<string, number> = {
  // Group A contenders
  "A1": 85, "A2": 68, "A3": 55, "A4": 42,
  "B1": 82, "B2": 70, "B3": 54, "B4": 40,
  "C1": 78, "C2": 65, "C3": 52, "C4": 38,
  "D1": 88, "D2": 72, "D3": 58, "D4": 44,
  "E1": 80, "E2": 67, "E3": 53, "E4": 39,
  "F1": 90, "F2": 74, "F3": 60, "F4": 46,
  "G1": 84, "G2": 69, "G3": 56, "G4": 43,
  "H1": 86, "H2": 71, "H3": 57, "H4": 45,
  "I1": 79, "I2": 63, "I3": 50, "I4": 37,
  "J1": 81, "J2": 66, "J3": 51, "J4": 38,
  "K1": 76, "K2": 62, "K3": 49, "K4": 36,
  "L1": 83, "L2": 68, "L3": 54, "L4": 41,
}

const DEFAULT_STRENGTH = 60

/** Exported seed/strength proxy used for UI comparisons (0–100). */
export function getWorldCupSeedStrength(slotKey: string): number {
  return SLOT_STRENGTH[slotKey] ?? DEFAULT_STRENGTH
}

function getSlotStrength(slotKey: string): number {
  return getWorldCupSeedStrength(slotKey)
}

// ── Team strength ─────────────────────────────────────────────────────────────

// ── Win probability ───────────────────────────────────────────────────────────

/**
 * Estimates win probability based on team strength delta.
 * Returns home/away probabilities summing to 1.0 (ignoring draw for picks).
 */
export function estimateWorldCupWinProbability(match: WorldCupMatchView): {
  homeWinProbability: number
  awayWinProbability: number
  confidence: "low" | "medium" | "high"
  explanationFactors: string[]
} {
  const homeStrength = getSlotStrength(match.homeSlotKey)
  const awayStrength = getSlotStrength(match.awaySlotKey)

  const homeName = match.homeTeamName || match.homeSlotKey
  const awayName = match.awayTeamName || match.awaySlotKey

  const isTbd = !match.homeTeamId || !match.awayTeamId
  const delta = homeStrength - awayStrength
  const absDelta = Math.abs(delta)

  // Logistic-style smoothing: map delta → probability
  // delta=0 → 50/50; delta=20 → ~65/35; delta=40 → ~80/20
  const rawHomeProb = 0.5 + (delta / 100) * 0.9
  const clampedHomeProb = Math.max(0.15, Math.min(0.85, rawHomeProb))
  const clampedAwayProb = 1 - clampedHomeProb

  const confidence: "low" | "medium" | "high" = isTbd
    ? "low"
    : absDelta < 8
    ? "low"
    : absDelta < 20
    ? "medium"
    : "high"

  const explanationFactors: string[] = []
  if (isTbd) {
    explanationFactors.push("Teams not yet confirmed — using group seed estimates")
  } else {
    if (absDelta >= 20) {
      explanationFactors.push(
        `${delta > 0 ? homeName : awayName} has a significant strength advantage`
      )
    } else if (absDelta >= 8) {
      explanationFactors.push(`${delta > 0 ? homeName : awayName} has a slight edge`)
    } else {
      explanationFactors.push("Evenly matched teams — coin-flip territory")
    }
    explanationFactors.push(`Seed estimates: ${homeName} ${homeStrength} vs ${awayName} ${awayStrength}`)
  }

  return {
    homeWinProbability: Math.round(clampedHomeProb * 100) / 100,
    awayWinProbability: Math.round(clampedAwayProb * 100) / 100,
    confidence,
    explanationFactors,
  }
}

// ── Upset risk ────────────────────────────────────────────────────────────────

/**
 * Returns how likely an upset is in this match.
 * Low = clear favorite; High = close match or unknown.
 */
export function getWorldCupUpsetRisk(match: WorldCupMatchView): "low" | "medium" | "high" {
  const homeStrength = getSlotStrength(match.homeSlotKey)
  const awayStrength = getSlotStrength(match.awaySlotKey)
  const absDelta = Math.abs(homeStrength - awayStrength)

  if (!match.homeTeamId || !match.awayTeamId) return "high"
  if (absDelta < 8) return "high"    // Very close — either team can win
  if (absDelta < 20) return "medium"
  return "low"
}

// ── Pick recommendation ───────────────────────────────────────────────────────

/**
 * Returns a recommended pick side and explanation based on strategy.
 */
export function getWorldCupPickRecommendation(
  match: WorldCupMatchView,
  strategy: WorldCupAiStrategy = "balanced"
): {
  recommendedSide: "home" | "away"
  recommendedTeamId: string | null
  recommendedTeamName: string
  safePick: string
  contrarianPick: string
  explanation: string
} {
  const homeStrength = getSlotStrength(match.homeSlotKey)
  const awayStrength = getSlotStrength(match.awaySlotKey)
  const upsetRisk = getWorldCupUpsetRisk(match)

  const homeName = match.homeTeamName || match.homeSlotKey
  const awayName = match.awayTeamName || match.awaySlotKey

  // Favorite = higher strength
  const favoriteSide: "home" | "away" = homeStrength >= awayStrength ? "home" : "away"
  const underdogSide: "home" | "away" = favoriteSide === "home" ? "away" : "home"
  const favoriteName = favoriteSide === "home" ? homeName : awayName
  const underdogName = underdogSide === "home" ? homeName : awayName

  const safePick = favoriteName
  const contrarianPick = underdogName

  let recommendedSide: "home" | "away"
  let explanation: string

  switch (strategy) {
    case "safe":
      recommendedSide = favoriteSide
      explanation = `${favoriteName} is the stronger team by seed. Safe bracket strategy picks the favorite.`
      break
    case "upset":
      if (upsetRisk !== "low") {
        recommendedSide = underdogSide
        explanation = `Upset risk is ${upsetRisk}. Upset strategy bets on ${underdogName} to maximize bracket differentiation.`
      } else {
        recommendedSide = favoriteSide
        explanation = `Even upset strategy sticks with ${favoriteName} — the gap is too large to gamble here.`
      }
      break
    case "chaos":
      // Chaos: always pick underdog or flip when even
      recommendedSide = upsetRisk === "low" ? favoriteSide : underdogSide
      explanation =
        upsetRisk === "low"
          ? `Even chaos can't overcome the gap. ${favoriteName} is the pick.`
          : `Chaos strategy goes bold with ${underdogName}. High variance, high reward.`
      break
    case "balanced":
    default:
      if (upsetRisk === "high") {
        // Close match — slight lean toward home advantage or seeded higher group rank
        recommendedSide = homeStrength >= awayStrength ? "home" : "away"
        explanation = `Close match — balanced strategy leans on ${recommendedSide === "home" ? homeName : awayName} by a thin margin.`
      } else {
        recommendedSide = favoriteSide
        explanation = `${favoriteName} has the edge. Balanced strategy follows the data.`
      }
  }

  return {
    recommendedSide,
    recommendedTeamId:
      recommendedSide === "home" ? match.homeTeamId : match.awayTeamId,
    recommendedTeamName:
      recommendedSide === "home" ? homeName : awayName,
    safePick,
    contrarianPick,
    explanation,
  }
}

// ── Bracket health ────────────────────────────────────────────────────────────

/**
 * Returns a bracket health assessment for a user's entry.
 */
export function calculateWorldCupBracketHealth(
  entry: { championTeamId: string | null; totalScore: number; maxPossibleScore: number },
  matches: WorldCupMatchView[],
  picks: WorldCupPickView[]
): WorldCupBracketHealth {
  const selectedPicks = picks.filter(hasWorldCupPickSelection)
  const correct = selectedPicks.filter((p) => p.isCorrect === true).length
  const incorrect = selectedPicks.filter((p) => p.isCorrect === false).length
  const total = selectedPicks.length

  // Champion still alive?
  const championAlive = entry.championTeamId
    ? !matches.some(
        (m) =>
          m.status === "final" &&
          m.winnerTeamId !== null &&
          m.winnerTeamId !== entry.championTeamId &&
          (m.homeTeamId === entry.championTeamId ||
            m.awayTeamId === entry.championTeamId)
      )
    : true // no champion pick = assume alive

  const maxPossible = entry.maxPossibleScore ?? 0
  const currentScore = entry.totalScore ?? 0

  // Health score: 0-100 blend of:
  // 40% = correct pick rate when picks exist
  // 30% = champion alive
  // 30% = max possible score ratio
  const pickRate = total > 0 ? correct / Math.max(total, 1) : 0.5
  const champBonus = championAlive ? 1 : 0
  const possibleRatio = maxPossible > 0 ? Math.min(maxPossible / 200, 1) : 0.5

  const raw = pickRate * 40 + champBonus * 30 + possibleRatio * 30
  const score = Math.round(raw)

  const label: WorldCupBracketHealth["label"] =
    score >= 75 ? "Excellent"
    : score >= 50 ? "Alive"
    : score >= 25 ? "Risky"
    : "Busted"

  let summary: string
  if (!championAlive && incorrect > correct) {
    summary = "Champion eliminated and more wrong than right — tough road ahead."
  } else if (!championAlive) {
    summary = "Champion pick eliminated — max possible score is capped."
  } else if (correct > incorrect * 2) {
    summary = "Strong pick accuracy. Champion still in — bracket looks healthy."
  } else if (incorrect > 0 && total < 5) {
    summary = "Early losses — still plenty of points available."
  } else {
    summary = `${correct} correct, ${incorrect} incorrect. Keep an eye on your champion pick.`
  }

  const possiblePointsRemaining = Math.max(0, maxPossible - currentScore)

  return {
    score,
    label,
    championAlive,
    possiblePointsRemaining,
    correctPicks: correct,
    incorrectPicks: incorrect,
    totalPicks: total,
    summary,
  }
}

// ── Group Stage AI insights (deterministic, per-group) ───────────────────────

type WorldCupGroupStageInsightTeam = {
  teamId: string
  name: string
  seedOrder: number
}

type WorldCupGroupStageGroupInsightInput = {
  /** Display name shown in copy (e.g. "Group A"). */
  groupName: string
  /** Group key used for slot-strength lookup (e.g. "A"). */
  groupKey: string
  /** Teams in this group (any order). */
  teams: WorldCupGroupStageInsightTeam[]
  /** Team IDs in the user's predicted rank order (winner first). */
  order: string[]
}

const GROUP_STAGE_FALLBACK_MISSING = (groupName: string) =>
  `${groupName} still has unranked teams. Finish those picks before finalizing.`

/**
 * Deterministic per-group insights based on the current user's own ranking
 * vs pre-tournament seed strength. Uses no external data — no LLM call.
 *
 * Returns 1–5 short lines:
 *  - Missing pick guidance when the group is not fully ranked.
 *  - Winner character (chalk / contrarian / risky).
 *  - Runner-up character.
 *  - Third-place candidate character.
 *  - Overall strategy line (pure chalk vs high variance vs safe top two).
 */
export function buildWorldCupGroupStageGroupInsights(
  input: WorldCupGroupStageGroupInsightInput
): string[] {
  const { groupName, groupKey, teams, order } = input

  if (teams.length < 4 || order.length < 4) {
    return [GROUP_STAGE_FALLBACK_MISSING(groupName)]
  }

  const teamById = new Map(teams.map((t) => [t.teamId, t]))
  const orderedTeams = order
    .map((id) => teamById.get(id))
    .filter((t): t is WorldCupGroupStageInsightTeam => Boolean(t))

  if (orderedTeams.length < 4) {
    return [GROUP_STAGE_FALLBACK_MISSING(groupName)]
  }

  const winner = orderedTeams[0]
  const runnerUp = orderedTeams[1]
  const third = orderedTeams[2]

  const winnerStrength = getWorldCupSeedStrength(`${groupKey}${winner.seedOrder}`)
  const runnerUpStrength = getWorldCupSeedStrength(`${groupKey}${runnerUp.seedOrder}`)

  // Upset index: sum of |predictedRank − seedOrder| for top 3 ranks.
  const upsetIndex = orderedTeams.slice(0, 3).reduce((acc, team, idx) => {
    return acc + Math.abs((idx + 1) - team.seedOrder)
  }, 0)

  const lines: string[] = []

  // Winner character — chalk / contrarian / risky.
  if (winner.seedOrder === 1) {
    lines.push(
      `Safest group winner: ${winner.name} aligns with top seeding (strength ${winnerStrength}/100).`
    )
  } else if (winner.seedOrder === 2) {
    lines.push(
      `Contrarian lean: ${winner.name} (seed #${winner.seedOrder}) over the top seed — moderate upset value.`
    )
  } else {
    lines.push(
      `Risky winner: ${winner.name} (seed #${winner.seedOrder}) is a higher-risk call based on pre-tournament strength.`
    )
  }

  // Runner-up character.
  if (runnerUp.seedOrder === 1) {
    lines.push(
      `Runner-up: ${runnerUp.name} as #2 leaves the top seed out of your winner slot.`
    )
  } else if (runnerUp.seedOrder === 2) {
    lines.push(
      `Runner-up: ${runnerUp.name} matches expected top-two seeding — predictable shape.`
    )
  } else {
    lines.push(
      `Runner-up: ${runnerUp.name} (seed #${runnerUp.seedOrder}) is a low-seed advancer — adds knockout-round volatility.`
    )
  }

  // Third-place candidate (slot 3 in the user's order).
  if (third.seedOrder <= 2) {
    lines.push(
      `Third-place candidate: ${third.name} as #3 means a top seed is in your third-place advancer pool.`
    )
  } else {
    lines.push(
      `Third-place candidate: ${third.name} (seed #${third.seedOrder}) — standard low-seed shape.`
    )
  }

  // Overall character.
  if (upsetIndex === 0) {
    lines.push(
      `Strategy: pure chalk — your group order matches the pre-tournament seeding exactly.`
    )
  } else if (upsetIndex >= 4) {
    lines.push(
      `Strategy: high-variance — your group order departs significantly from seeding (upset index ${upsetIndex}).`
    )
  } else if (winnerStrength + runnerUpStrength >= 140) {
    lines.push(
      `Strategy: safe top two — winner and runner-up combine ${winnerStrength + runnerUpStrength}/200 strength.`
    )
  }

  return lines
}

// ── Third-place advancer insights (deterministic, pool-wide) ─────────────────

type WorldCupGroupStageThirdPlaceInsightInput = {
  groups: Array<{
    id: string
    groupKey: string
    displayName: string
    teams: WorldCupGroupStageInsightTeam[]
  }>
  thirdPlacePicks: Array<{ groupId: string; teamId: string; isSelected: boolean }>
  /** Required number of third-place advancers (default 8 for 2026 format). */
  requiredCount?: number
}

/**
 * Deterministic insights for the user's third-place advancer pool.
 * Uses only the user's own picks + public team metadata.
 *
 * Returns 1–3 short lines:
 *  - Selection progress (selected of required).
 *  - Strength balance (chalk-heavy vs upside-heavy).
 *  - Differentiation lean when balanced.
 */
export function buildWorldCupGroupStageThirdPlaceInsights(
  input: WorldCupGroupStageThirdPlaceInsightInput
): string[] {
  const { groups, thirdPlacePicks, requiredCount = 8 } = input
  const selected = thirdPlacePicks.filter((p) => p.isSelected)

  if (selected.length === 0) {
    return [
      `Select ${requiredCount} third-place advancers to unlock personalized differentiation insights.`,
    ]
  }

  const lines: string[] = []

  lines.push(
    selected.length >= requiredCount
      ? `All ${requiredCount} third-place advancers selected.`
      : `Current selected: ${selected.length} of ${requiredCount}. ${requiredCount - selected.length} more to lock in.`
  )

  const selectedTeams = selected
    .map((p) => {
      const g = groups.find((gr) => gr.id === p.groupId)
      const t = g?.teams.find((tt) => tt.teamId === p.teamId)
      return t && g ? { team: t, group: g } : null
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))

  if (selectedTeams.length === 0) return lines

  const lowSeedCount = selectedTeams.filter((x) => x.team.seedOrder >= 3).length
  const highSeedCount = selectedTeams.filter((x) => x.team.seedOrder <= 2).length

  if (highSeedCount > lowSeedCount && selectedTeams.length >= 4) {
    lines.push(
      `Strong third-place pool: ${highSeedCount} of ${selectedTeams.length} picks are top-seeded — safer advancement odds.`
    )
  } else if (lowSeedCount >= Math.ceil(requiredCount / 2)) {
    lines.push(
      `You advanced ${lowSeedCount} lower-seed third-place teams — raises upside but adds volatility.`
    )
  } else if (selectedTeams.length >= 2) {
    lines.push(
      `Your third-place selections create differentiation if those groups break your way.`
    )
  }

  return lines
}

// ── Round scoring weights (for builder ordering) ──────────────────────────────

