import "server-only"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import type { WorldCupScoringValues } from "./types"

export const WORLD_CUP_GROUP_STAGE_ROUND_KEYS = {
  rankings: "group_stage_rankings",
  perfectGroupBonus: "group_stage_perfect_group_bonus",
  thirdPlaceAdvancers: "group_stage_third_place_advancers",
} as const

export type WorldCupGroupStageScoringValues = Partial<WorldCupScoringValues> & {
  groupExactPlacementPoints?: number | null
  groupQualifiedTeamPoints?: number | null
  perfectGroupBonusPoints?: number | null
  thirdPlaceAdvancerPoints?: number | null
}

export type WorldCupGroupRankingPickForScoring = {
  id?: string
  groupId: string
  teamId: string
  predictedRank: number
  actualRank?: number | null
  pointsAwarded?: number | null
  isCorrect?: boolean | null
}

export type WorldCupThirdPlaceAdvancerPickForScoring = {
  id?: string
  groupId: string
  teamId: string
  isSelected: boolean
  actualAdvanced?: boolean | null
  pointsAwarded?: number | null
  isCorrect?: boolean | null
}

export type WorldCupGroupStageScoreSummary = {
  groupRankingScore: number
  perfectGroupBonusScore: number
  thirdPlaceAdvancerScore: number
  groupStageScore: number
  maxPossibleGroupStageScore: number
  correctPicks: number
  incorrectPicks: number
  roundBreakdown: Record<string, number>
  groupsRankedCount: number
  thirdPlaceSelectedCount: number
  groupStageComplete: boolean
}

function groupScoring(scoring?: WorldCupGroupStageScoringValues | null) {
  return {
    exact: Number(scoring?.groupExactPlacementPoints ?? 5),
    qualified: Number(scoring?.groupQualifiedTeamPoints ?? 2),
    perfectBonus: Number(scoring?.perfectGroupBonusPoints ?? 10),
    thirdPlace: Number(scoring?.thirdPlaceAdvancerPoints ?? 5),
  }
}

export function evaluateWorldCupGroupRankingPick(
  pick: WorldCupGroupRankingPickForScoring,
  scoring?: WorldCupGroupStageScoringValues | null
) {
  const actualRank = pick.actualRank
  if (!actualRank || actualRank < 1) {
    return { isCorrect: null, pointsAwarded: 0, actualRank: actualRank ?? null }
  }
  const values = groupScoring(scoring)
  if (pick.predictedRank === actualRank) {
    return { isCorrect: true, pointsAwarded: values.exact, actualRank }
  }
  const qualifiedWrongOrder = pick.predictedRank <= 2 && actualRank <= 2
  return {
    isCorrect: qualifiedWrongOrder,
    pointsAwarded: qualifiedWrongOrder ? values.qualified : 0,
    actualRank,
  }
}

export function evaluateWorldCupThirdPlaceAdvancerPick(
  pick: WorldCupThirdPlaceAdvancerPickForScoring,
  scoring?: WorldCupGroupStageScoringValues | null
) {
  if (!pick.isSelected || pick.actualAdvanced == null) {
    return { isCorrect: null, pointsAwarded: 0, actualAdvanced: pick.actualAdvanced ?? null }
  }
  const isCorrect = Boolean(pick.actualAdvanced)
  return {
    isCorrect,
    pointsAwarded: isCorrect ? groupScoring(scoring).thirdPlace : 0,
    actualAdvanced: pick.actualAdvanced,
  }
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

export function buildWorldCupGroupStageScoreSummary(input: {
  groupRankingPicks?: WorldCupGroupRankingPickForScoring[]
  thirdPlaceAdvancerPicks?: WorldCupThirdPlaceAdvancerPickForScoring[]
  scoring?: WorldCupGroupStageScoringValues | null
}): WorldCupGroupStageScoreSummary {
  const values = groupScoring(input.scoring)
  const rankingPicks = input.groupRankingPicks ?? []
  const thirdPlacePicks = input.thirdPlaceAdvancerPicks ?? []
  let groupRankingScore = 0
  let thirdPlaceAdvancerScore = 0
  let correctPicks = 0
  let incorrectPicks = 0
  const picksByGroup = new Map<string, WorldCupGroupRankingPickForScoring[]>()

  for (const pick of rankingPicks) {
    const result = evaluateWorldCupGroupRankingPick(pick, input.scoring)
    groupRankingScore += result.pointsAwarded
    if (result.isCorrect === true) correctPicks++
    if (result.isCorrect === false) incorrectPicks++
    const group = picksByGroup.get(pick.groupId) ?? []
    group.push(pick)
    picksByGroup.set(pick.groupId, group)
  }

  let perfectGroupBonusScore = 0
  for (const groupPicks of picksByGroup.values()) {
    if (groupPicks.length !== 4) continue
    const hasAllActualRanks = groupPicks.every((pick) => Number.isInteger(pick.actualRank))
    const allExact = hasAllActualRanks && groupPicks.every((pick) => pick.predictedRank === pick.actualRank)
    if (allExact) perfectGroupBonusScore += values.perfectBonus
  }

  for (const pick of thirdPlacePicks.filter((row) => row.isSelected)) {
    const result = evaluateWorldCupThirdPlaceAdvancerPick(pick, input.scoring)
    thirdPlaceAdvancerScore += result.pointsAwarded
    if (result.isCorrect === true) correctPicks++
    if (result.isCorrect === false) incorrectPicks++
  }

  const completion = getWorldCupGroupStageCompletionState({
    groupRankingPicks: rankingPicks,
    thirdPlaceAdvancerPicks: thirdPlacePicks,
  })
  const maxPossibleGroupStageScore =
    rankingPicks.reduce((sum, pick) => {
      if (!pick.actualRank) return sum + values.exact
      return sum + evaluateWorldCupGroupRankingPick(pick, input.scoring).pointsAwarded
    }, 0) +
    [...picksByGroup.values()].reduce((sum, groupPicks) => {
      if (groupPicks.length !== 4) return sum
      const hasAllActualRanks = groupPicks.every((pick) => Number.isInteger(pick.actualRank))
      if (!hasAllActualRanks) return sum + values.perfectBonus
      const allExact = groupPicks.every((pick) => pick.predictedRank === pick.actualRank)
      return sum + (allExact ? values.perfectBonus : 0)
    }, 0) +
    thirdPlacePicks
      .filter((row) => row.isSelected)
      .reduce((sum, pick) => {
        if (pick.actualAdvanced == null) return sum + values.thirdPlace
        return sum + evaluateWorldCupThirdPlaceAdvancerPick(pick, input.scoring).pointsAwarded
      }, 0)

  return {
    groupRankingScore,
    perfectGroupBonusScore,
    thirdPlaceAdvancerScore,
    groupStageScore: groupRankingScore + perfectGroupBonusScore + thirdPlaceAdvancerScore,
    maxPossibleGroupStageScore,
    correctPicks,
    incorrectPicks,
    groupsRankedCount: completion.groupsRankedCount,
    thirdPlaceSelectedCount: completion.thirdPlaceSelectedCount,
    groupStageComplete: completion.groupStageComplete,
    roundBreakdown: {
      [WORLD_CUP_GROUP_STAGE_ROUND_KEYS.rankings]: groupRankingScore,
      [WORLD_CUP_GROUP_STAGE_ROUND_KEYS.perfectGroupBonus]: perfectGroupBonusScore,
      [WORLD_CUP_GROUP_STAGE_ROUND_KEYS.thirdPlaceAdvancers]: thirdPlaceAdvancerScore,
    },
  }
}

async function actualRankLookup(challengeId: string) {
  const rows = await prisma.worldCupGroupTeam.findMany({
    where: { challengeId },
    select: { groupId: true, teamId: true, actualRank: true },
  })
  return new Map(rows.map((row) => [`${row.groupId}:${row.teamId}`, row.actualRank]))
}

export async function scoreWorldCupGroupRankingPicks(input: { challengeId: string; entryId: string }) {
  const [challenge, picks, actualRanks] = await Promise.all([
    prisma.worldCupBracketChallenge.findUnique({
      where: { id: input.challengeId },
      include: { scoringProfile: true },
    }),
    prisma.worldCupGroupRankingPick.findMany({
      where: { challengeId: input.challengeId, entryId: input.entryId },
      orderBy: [{ groupId: "asc" }, { predictedRank: "asc" }],
    }),
    actualRankLookup(input.challengeId),
  ])
  if (!challenge) throw new Error("World Cup bracket challenge not found")

  const scored = picks.map((pick) => {
    const actualRank = pick.actualRank ?? actualRanks.get(`${pick.groupId}:${pick.teamId}`) ?? null
    const result = evaluateWorldCupGroupRankingPick({ ...pick, actualRank }, challenge.scoringProfile)
    return { pick, actualRank, ...result }
  })

  await prisma.$transaction(
    scored.map((row) =>
      prisma.worldCupGroupRankingPick.update({
        where: { id: row.pick.id },
        data: {
          actualRank: row.actualRank,
          isCorrect: row.isCorrect,
          pointsAwarded: row.pointsAwarded,
        },
      })
    )
  )

  return buildWorldCupGroupStageScoreSummary({
    groupRankingPicks: scored.map((row) => ({ ...row.pick, actualRank: row.actualRank, pointsAwarded: row.pointsAwarded, isCorrect: row.isCorrect })),
    scoring: challenge.scoringProfile,
  })
}

export async function scoreWorldCupThirdPlaceAdvancerPicks(input: { challengeId: string; entryId: string }) {
  const [challenge, picks] = await Promise.all([
    prisma.worldCupBracketChallenge.findUnique({
      where: { id: input.challengeId },
      include: { scoringProfile: true },
    }),
    prisma.worldCupThirdPlaceAdvancerPick.findMany({
      where: { challengeId: input.challengeId, entryId: input.entryId },
      orderBy: [{ groupId: "asc" }],
    }),
  ])
  if (!challenge) throw new Error("World Cup bracket challenge not found")

  const scored = picks.map((pick) => ({ pick, ...evaluateWorldCupThirdPlaceAdvancerPick(pick, challenge.scoringProfile) }))
  await prisma.$transaction(
    scored.map((row) =>
      prisma.worldCupThirdPlaceAdvancerPick.update({
        where: { id: row.pick.id },
        data: {
          isCorrect: row.isCorrect,
          pointsAwarded: row.pointsAwarded,
        },
      })
    )
  )

  return buildWorldCupGroupStageScoreSummary({
    thirdPlaceAdvancerPicks: scored.map((row) => ({ ...row.pick, pointsAwarded: row.pointsAwarded, isCorrect: row.isCorrect })),
    scoring: challenge.scoringProfile,
  })
}

export async function recalculateWorldCupGroupStageEntryScore(input: { challengeId: string; entryId: string }) {
  await scoreWorldCupGroupRankingPicks(input)
  await scoreWorldCupThirdPlaceAdvancerPicks(input)
  const challenge = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: input.challengeId },
    include: {
      scoringProfile: true,
      entries: {
        where: { id: input.entryId },
        include: {
          groupRankingPicks: true,
          thirdPlaceAdvancerPicks: true,
        },
      },
    },
  })
  const entry = challenge?.entries[0]
  if (!challenge || !entry) throw new Error("Entry not found")
  return buildWorldCupGroupStageScoreSummary({
    groupRankingPicks: entry.groupRankingPicks,
    thirdPlaceAdvancerPicks: entry.thirdPlaceAdvancerPicks,
    scoring: challenge.scoringProfile,
  })
}

