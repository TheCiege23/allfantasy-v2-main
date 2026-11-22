/**
 * Deterministic pick strategy helpers for World Cup bracket guidance.
 */
import { WORLD_CUP_ROUND_LABELS } from "./types"
import type { WorldCupMatchView } from "./types"
import { getWorldCupSeedStrength } from "./worldCupAiInsights"

type WinProbabilitySides = {
  safePickSide: "home" | "away"
  upsetPickSide: "home" | "away"
  safePickTeamName: string
  upsetPickTeamName: string
}

/**
 * Safe = higher model win probability; upset = lower (contrarian).
 */
export function getProbabilityBasedPickSides(
  match: WorldCupMatchView,
  homeWinProbability: number,
  awayWinProbability: number
): WinProbabilitySides {
  const homeName = match.homeTeamName || match.homeSlotKey
  const awayName = match.awayTeamName || match.awaySlotKey
  const safePickSide: "home" | "away" =
    homeWinProbability >= awayWinProbability ? "home" : "away"
  const upsetPickSide: "home" | "away" = safePickSide === "home" ? "away" : "home"
  return {
    safePickSide,
    upsetPickSide,
    safePickTeamName: safePickSide === "home" ? homeName : awayName,
    upsetPickTeamName: upsetPickSide === "home" ? homeName : awayName,
  }
}

export function buildRankingSeedComparison(match: WorldCupMatchView): string {
  const h = getWorldCupSeedStrength(match.homeSlotKey)
  const a = getWorldCupSeedStrength(match.awaySlotKey)
  const homeName = match.homeTeamName || match.homeSlotKey
  const awayName = match.awayTeamName || match.awaySlotKey
  if (h === a) {
    return `${homeName} and ${awayName} carry the same seed-strength estimate (${h}).`
  }
  const fav = h > a ? homeName : awayName
  const dog = h > a ? awayName : homeName
  return `Seed-strength proxy: ${fav} ${Math.max(h, a)} vs ${dog} ${Math.min(h, a)} — ${fav} is favored on paper.`
}

const RECENT_FORM_FALLBACK =
  "Live form and injury feeds are not wired for this challenge yet — projections use FIFA-style seed estimates only."

export function getRecentFormPlaceholder(): string {
  return RECENT_FORM_FALLBACK
}

export function describeBracketImpactIfTeamWins(
  match: WorldCupMatchView,
  side: "home" | "away"
): string {
  const name =
    side === "home"
      ? match.homeTeamName || match.homeSlotKey
      : match.awayTeamName || match.awaySlotKey
  const roundLabel = WORLD_CUP_ROUND_LABELS[match.round]

  if (match.round === "final") {
    return `If ${name} wins, they take the title — lock in championship-side points and any champion tie-breakers tied to this pick.`
  }
  if (match.round === "third_place") {
    return `If ${name} wins the ${roundLabel}, your bronze/medal-side picks resolve — check medal-game scoring if your challenge weights them.`
  }

  const slotHint =
    match.nextMatchSlot === "home" || match.nextMatchSlot === "away"
      ? ` They feed the ${match.nextMatchSlot} slot of the next knockout pairing.`
      : match.nextMatchId
        ? " They advance into the next knockout round on your bracket tree."
        : " They stay alive on that half of your bracket."

  return `If ${name} wins this ${roundLabel} matchup, that side of your bracket advances.${slotHint}`
}
