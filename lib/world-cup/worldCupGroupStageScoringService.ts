import "server-only"

type WorldCupGroupRankingPickForScoring = {
  id?: string
  groupId: string
  teamId: string
  predictedRank: number
  actualRank?: number | null
  pointsAwarded?: number | null
  isCorrect?: boolean | null
}

type WorldCupThirdPlaceAdvancerPickForScoring = {
  id?: string
  groupId: string
  teamId: string
  isSelected: boolean
  actualAdvanced?: boolean | null
  pointsAwarded?: number | null
  isCorrect?: boolean | null
}

export function getWorldCupGroupStageCompletionState(input: {
  groupRankingPicks: Array<Pick<WorldCupGroupRankingPickForScoring, "groupId" | "predictedRank">>
  thirdPlaceAdvancerPicks: Array<Pick<WorldCupThirdPlaceAdvancerPickForScoring, "isSelected">>
  knockoutComplete?: boolean
}) {
  const rankedGroups = new Map<string, Set<number>>()
  for (const pick of input.groupRankingPicks) {
    const ranks = rankedGroups.get(pick.groupId) ?? new Set<number>()
    ranks.add(pick.predictedRank)
    rankedGroups.set(pick.groupId, ranks)
  }
  const groupsRankedCount = [...rankedGroups.values()].filter((ranks) => [1, 2, 3, 4].every((rank) => ranks.has(rank))).length
  const allGroupsRanked = groupsRankedCount === 12
  const thirdPlaceSelectedCount = input.thirdPlaceAdvancerPicks.filter((pick) => pick.isSelected).length
  const thirdPlaceComplete = thirdPlaceSelectedCount === 8
  const groupStageComplete = allGroupsRanked && thirdPlaceComplete
  const knockoutComplete = Boolean(input.knockoutComplete)
  return {
    groupsRankedCount,
    allGroupsRanked,
    thirdPlaceSelectedCount,
    thirdPlaceComplete,
    groupStageComplete,
    knockoutComplete,
    fullEntryComplete: groupStageComplete && knockoutComplete,
  }
}

