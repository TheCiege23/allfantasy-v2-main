import type {
  WorldCupLeaderboardRow,
  WorldCupMatchView,
  WorldCupPickView,
} from "./types"
import type { WorldCupEntryCompletionReviewClient } from "./worldCupClientApi"
import { getWorldCupSeedStrength } from "./worldCupAiInsights"
import { hasWorldCupPickSelection } from "./worldCupProjectedBracket"

type EntryShape = {
  championTeamId: string | null
  championTeamName?: string | null
  totalScore?: number | null
  maxPossibleScore?: number | null
  submittedAt?: string | null
}

export type WorldCupBracketGradeInsight = {
  grade: string
  completionPercent: number
  groupCompletionPercent: number
  thirdPlaceCompletionPercent: number
  knockoutCompletionPercent: number
  championSelected: boolean
  missingPickCount: number
  riskLabel: "Low" | "Medium" | "High"
  upsetMeter: "Chalky" | "Balanced" | "Spicy" | "Chaos"
  championConfidence: number
  biggestRisk: string
  recommendation: string
}

type WorldCupLeaderboardAiInsight = {
  entryId: string
  aiWinProbability: number
  bracketHealth: "Excellent" | "Alive" | "Risky" | "Busted"
  maxPossiblePoints: number
  championAlive: boolean
}

export type WorldCupPathToWinInsight = {
  entryId: string | null
  locked: boolean
  title: string
  lines: string[]
}

function pct(done: number, total: number) {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)))
}

function gradeFromCompletion(completion: number, riskLabel: WorldCupBracketGradeInsight["riskLabel"]) {
  const penalty = riskLabel === "High" ? 4 : riskLabel === "Medium" ? 2 : 0
  const score = Math.max(0, completion - penalty)
  if (score >= 97) return "A+"
  if (score >= 92) return "A"
  if (score >= 88) return "B+"
  if (score >= 82) return "B"
  if (score >= 75) return "C+"
  if (score >= 65) return "C"
  if (score >= 50) return "D"
  return "Needs Picks"
}

function findMatchForPick(matches: WorldCupMatchView[], pick: WorldCupPickView) {
  return matches.find((match) => match.id === pick.matchId || match.matchNumber === pick.matchNumber) ?? null
}

function selectedSideStrength(match: WorldCupMatchView, pick: WorldCupPickView) {
  const selectedHome =
    (pick.selectedTeamId && pick.selectedTeamId === match.homeTeamId) ||
    (pick.selectedSlotKey && pick.selectedSlotKey === match.homeSlotKey) ||
    (pick.selectedTeamName && pick.selectedTeamName === match.homeTeamName)
  const selectedAway =
    (pick.selectedTeamId && pick.selectedTeamId === match.awayTeamId) ||
    (pick.selectedSlotKey && pick.selectedSlotKey === match.awaySlotKey) ||
    (pick.selectedTeamName && pick.selectedTeamName === match.awayTeamName)
  if (selectedHome) {
    return {
      selected: getWorldCupSeedStrength(match.homeSlotKey),
      opponent: getWorldCupSeedStrength(match.awaySlotKey),
    }
  }
  if (selectedAway) {
    return {
      selected: getWorldCupSeedStrength(match.awaySlotKey),
      opponent: getWorldCupSeedStrength(match.homeSlotKey),
    }
  }
  return null
}

export function calculateWorldCupBracketGrade(input: {
  completionReview: WorldCupEntryCompletionReviewClient
  entry: EntryShape | null
  picks: WorldCupPickView[]
  matches: WorldCupMatchView[]
}): WorldCupBracketGradeInsight {
  const { completionReview, entry, picks, matches } = input
  const groupCompletionPercent = pct(completionReview.groupsRankedCount, 12)
  const thirdPlaceCompletionPercent = pct(completionReview.thirdPlaceSelectedCount, 8)
  const knockoutCompletionPercent = pct(
    completionReview.completedKnockoutPicks,
    Math.max(1, completionReview.requiredKnockoutPicks)
  )
  const completionPercent = Math.round(
    groupCompletionPercent * 0.4 + thirdPlaceCompletionPercent * 0.15 + knockoutCompletionPercent * 0.45
  )
  const selectedPicks = picks.filter(hasWorldCupPickSelection)
  const upsetPickCount = selectedPicks.reduce((count, pick) => {
    const match = findMatchForPick(matches, pick)
    const strength = match ? selectedSideStrength(match, pick) : null
    return strength && strength.selected + 6 < strength.opponent ? count + 1 : count
  }, 0)
  const upsetRatio = selectedPicks.length > 0 ? upsetPickCount / selectedPicks.length : 0
  const riskLabel: WorldCupBracketGradeInsight["riskLabel"] =
    completionReview.fullEntryComplete && upsetRatio < 0.2
      ? "Low"
      : completionPercent >= 80 && upsetRatio < 0.35
        ? "Medium"
        : "High"
  const upsetMeter: WorldCupBracketGradeInsight["upsetMeter"] =
    upsetRatio >= 0.45 ? "Chaos" : upsetRatio >= 0.25 ? "Spicy" : upsetRatio >= 0.1 ? "Balanced" : "Chalky"
  const championPick = selectedPicks.find((pick) => pick.round === "final")
  const championMatch = championPick ? findMatchForPick(matches, championPick) : null
  const championStrength = championMatch && championPick ? selectedSideStrength(championMatch, championPick)?.selected ?? 60 : 0
  const championConfidence = championPick ? Math.max(35, Math.min(82, Math.round(championStrength * 0.75 + completionPercent * 0.25))) : 0
  const missingPickCount =
    Math.max(0, 12 - completionReview.groupsRankedCount) +
    Math.max(0, 8 - completionReview.thirdPlaceSelectedCount) +
    Math.max(0, completionReview.missingKnockoutPicks)
  const championSelected = Boolean(entry?.championTeamId || entry?.championTeamName || championPick)
  const biggestRisk = !championSelected
    ? "No champion pick is set yet."
    : riskLabel === "High"
      ? "Champion path depends on multiple swing picks."
      : upsetMeter === "Chalky"
        ? "Chalk-heavy brackets can be easier to catch if the pool clusters on the same champion."
        : "Your largest leverage comes from the knockout path staying alive."
  const recommendation = !completionReview.fullEntryComplete
    ? completionReview.thirdPlaceSelectedCount < 8
      ? "Finish third-place advancers before finalizing."
      : completionReview.missingKnockoutPicks > 0
        ? "Complete the remaining knockout picks, then finalize."
        : "Finish every group ranking before finalizing."
    : entry?.submittedAt
      ? "Finalized. Monitor champion status and max possible points as results land."
      : "Finalize to join the leaderboard while picks are still editable before lock."

  return {
    grade: gradeFromCompletion(completionPercent, riskLabel),
    completionPercent,
    groupCompletionPercent,
    thirdPlaceCompletionPercent,
    knockoutCompletionPercent,
    championSelected,
    missingPickCount,
    riskLabel,
    upsetMeter,
    championConfidence,
    biggestRisk,
    recommendation,
  }
}

export function calculateWorldCupLeaderboardAiInsights(
  leaderboard: WorldCupLeaderboardRow[]
): WorldCupLeaderboardAiInsight[] {
  if (leaderboard.length === 0) return []
  const maxPossible = Math.max(...leaderboard.map((row) => Math.max(row.maxPossibleScore, row.totalScore, 1)))
  const raw = leaderboard.map((row) => {
    const rankScore = Math.max(0, leaderboard.length - row.rank + 1) / leaderboard.length
    const possibleScore = Math.max(row.maxPossibleScore, row.totalScore, 1) / maxPossible
    const championScore = row.championStillAlive ? 1 : 0.2
    const correctRate = (row.correctPicks + row.incorrectPicks) > 0
      ? row.correctPicks / (row.correctPicks + row.incorrectPicks)
      : 0.55
    const weight = rankScore * 0.35 + possibleScore * 0.35 + championScore * 0.2 + correctRate * 0.1
    return { row, weight }
  })
  const totalWeight = raw.reduce((sum, item) => sum + item.weight, 0) || raw.length

  return raw.map(({ row, weight }) => {
    const healthScore = Math.round(weight * 100)
    return {
      entryId: row.entryId,
      aiWinProbability: Math.max(1, Math.round((weight / totalWeight) * 100)),
      bracketHealth: healthScore >= 75 ? "Excellent" : healthScore >= 55 ? "Alive" : healthScore >= 30 ? "Risky" : "Busted",
      maxPossiblePoints: Math.max(row.maxPossibleScore, row.totalScore),
      championAlive: row.championStillAlive,
    }
  })
}

export function buildWorldCupPathToWinInsight(input: {
  selectedEntry: (EntryShape & { id: string; name: string }) | null
  leaderboard: WorldCupLeaderboardRow[]
  hasBracketBrainAi: boolean
}): WorldCupPathToWinInsight {
  const selectedEntry = input.selectedEntry
  if (!input.hasBracketBrainAi) {
    return {
      entryId: selectedEntry?.id ?? null,
      locked: true,
      title: "What needs to happen for me to win?",
      lines: ["AF Pro can show your path to win after you finalize."],
    }
  }

  if (!selectedEntry?.submittedAt) {
    return {
      entryId: selectedEntry?.id ?? null,
      locked: false,
      title: "What needs to happen for me to win?",
      lines: ["Finalize this entry to compare it against public leaderboard entries.", "Some unfinalized entries are hidden until submitted."],
    }
  }

  const sorted = [...input.leaderboard].sort((a, b) => a.rank - b.rank)
  const current = sorted.find((row) => row.entryId === selectedEntry.id) ?? null
  if (!current) {
    return {
      entryId: selectedEntry.id,
      locked: false,
      title: "What needs to happen for me to win?",
      lines: ["This finalized entry is not on the public leaderboard yet. Refresh after scoring recalculates."],
    }
  }

  const leader = sorted[0]
  const pointsGap = Math.max(0, (leader?.totalScore ?? 0) - current.totalScore)
  const possibleGap = Math.max(0, current.maxPossibleScore - (leader?.maxPossibleScore ?? current.maxPossibleScore))
  const lines = [
    current.rank === 1
      ? "You are currently leading. Protect the champion path and avoid losing max possible points."
      : `You need to close a ${pointsGap}-point gap to ${leader.entryName}.`,
    current.championStillAlive
      ? `Champion path is alive with ${current.championPickName ?? "your champion"} still carrying leverage.`
      : "Champion pick is busted, so your path depends on other entries losing higher-value rounds.",
    possibleGap > 0
      ? `Your max possible edge is ${possibleGap} points if remaining leverage breaks your way.`
      : "You need the leader's remaining path to miss while your live picks keep scoring.",
    "Some unfinalized entries are hidden until submitted.",
  ]

  return {
    entryId: selectedEntry.id,
    locked: false,
    title: "What needs to happen for me to win?",
    lines,
  }
}
