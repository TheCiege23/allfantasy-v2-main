import "server-only"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { isWorldCupChallengeLocked } from "./worldCupBracketBuilder"
import {
  WORLD_CUP_BRACKET_LOCKED_MESSAGE,
  emitWorldCupKnockoutOverrideAuditEvent,
} from "./worldCupBracketService"
import { isWorldCupPostLockKnockoutEditOverrideEnabled } from "./worldCupBracketSettingsService"
import { buildWorldCupMatchesFromGroupPredictions, isWorldCupMatchPickable } from "./worldCupProjectedBracket"
import {
  getWorldCupKnockoutModeFromPayload,
  hasOfficialWorldCupReseededKnockoutFixtures,
} from "./worldCupKnockoutMode"
import {
  getWorldCupGroupStageCompletionState,
} from "./worldCupGroupStageScoringService"
import { isWorldCupEntryCompleteFromSelections } from "./worldCupScoringService"
import { getWorldCupGroupStageView } from "./worldCupGroupStageService"

type WorldCupEntryCompletionReview = {
  challengeId: string
  entryId: string
  groupStageComplete: boolean
  knockoutComplete: boolean
  fullEntryComplete: boolean
  groupsRankedCount: number
  missingGroups: string[]
  thirdPlaceSelectedCount: number
  missingKnockoutPicks: number
  requiredKnockoutPicks: number
  completedKnockoutPicks: number
  isLocked: boolean
  postLockKnockoutOverrideEnabled: boolean
  isComplete: boolean
  submittedAt: string | null
  staleSubmittedIncomplete: boolean
  needsRefinalize: boolean
}

const WORLD_CUP_FINALIZE_PICK_WITH_MATCH_SELECT = {
  id: true,
  matchId: true,
  round: true,
  selectedTeamId: true,
  selectedTeamName: true,
  selectedSlotKey: true,
  pointsAwarded: true,
  isCorrect: true,
  match: true,
} satisfies Prisma.WorldCupBracketPickSelect

function rankedGroupKeys(input: {
  groups: Array<{ id: string; groupKey: string }>
  groupRankingPicks: Array<{ groupId: string; predictedRank: number }>
}) {
  const byGroup = new Map<string, Set<number>>()
  for (const pick of input.groupRankingPicks) {
    const ranks = byGroup.get(pick.groupId) ?? new Set<number>()
    ranks.add(pick.predictedRank)
    byGroup.set(pick.groupId, ranks)
  }
  return new Set(
    input.groups
      .filter((group) => {
        const ranks = byGroup.get(group.id)
        return ranks && [1, 2, 3, 4].every((rank) => ranks.has(rank))
      })
      .map((group) => group.groupKey)
  )
}

export async function getWorldCupEntryCompletionReview(input: {
  challengeId: string
  entryId: string
  userId: string
}): Promise<WorldCupEntryCompletionReview> {
  const entry = await prisma.worldCupBracketEntry.findUnique({
    where: { id: input.entryId },
    include: {
      challenge: {
        include: {
          groups: { orderBy: { sortOrder: "asc" } },
          matches: true,
        },
      },
      picks: { select: WORLD_CUP_FINALIZE_PICK_WITH_MATCH_SELECT },
      groupRankingPicks: true,
      thirdPlaceAdvancerPicks: true,
    },
  })
  if (!entry || entry.challengeId !== input.challengeId) throw new Error("Entry not found")
  if (entry.userId !== input.userId) {
    throw new Error("Entry not found")
  }

  const knockoutMode = getWorldCupKnockoutModeFromPayload(entry.challenge.sourcePayload)
  const knockoutOnly = knockoutMode === "knockout_only"
  const groupCompletion = knockoutOnly
    ? {
        groupsRankedCount: 0,
        allGroupsRanked: true,
        thirdPlaceSelectedCount: 0,
        thirdPlaceComplete: true,
        groupStageComplete: true,
      }
    : getWorldCupGroupStageCompletionState({
        groupRankingPicks: entry.groupRankingPicks,
        thirdPlaceAdvancerPicks: entry.thirdPlaceAdvancerPicks,
      })
  const rankedKeys = rankedGroupKeys({
    groups: entry.challenge.groups,
    groupRankingPicks: entry.groupRankingPicks,
  })
  const missingGroups = knockoutOnly
    ? []
    : entry.challenge.groups
        .map((group) => group.groupKey)
        .filter((groupKey) => !rankedKeys.has(groupKey))
  const reseededReady = hasOfficialWorldCupReseededKnockoutFixtures(
    entry.challenge.matches as Parameters<typeof hasOfficialWorldCupReseededKnockoutFixtures>[0]
  )
  const groupStageView = knockoutOnly ? null : await getWorldCupGroupStageView(input)
  const generatedKnockoutMatches =
    knockoutMode === "reseeded" || knockoutOnly
      ? entry.challenge.matches
      : buildWorldCupMatchesFromGroupPredictions({
          matches: entry.challenge.matches as Parameters<typeof isWorldCupEntryCompleteFromSelections>[0]["matches"],
          groupStageView,
          bestThirdMappingConfirmed: false,
        }).matches
  const knockoutComplete = isWorldCupEntryCompleteFromSelections({
    matches: generatedKnockoutMatches,
    picks: entry.picks,
    includeThirdPlace: entry.challenge.includeThirdPlace,
  }) && (knockoutMode !== "reseeded" || reseededReady)
  const pickableKnockoutMatches = generatedKnockoutMatches.filter(
    (match) =>
      (knockoutMode !== "reseeded" || reseededReady) &&
      (match.round !== "third_place" || entry.challenge.includeThirdPlace) &&
      isWorldCupMatchPickable(match)
  )
  const completedKnockoutPicks = pickableKnockoutMatches.filter((match) =>
    entry.picks.some((pick) => pick.matchId === match.id && (pick.selectedTeamId || pick.selectedSlotKey))
  ).length
  const requiredKnockoutPicks = pickableKnockoutMatches.length
  const lock = isWorldCupChallengeLocked({
    challenge: entry.challenge,
    matches: entry.challenge.matches,
    entry,
  })
  const postLockKnockoutOverrideEnabled = isWorldCupPostLockKnockoutEditOverrideEnabled(entry.challenge.sourcePayload)
  const fullEntryComplete = groupCompletion.groupStageComplete && knockoutComplete
  const rawSubmittedAt = entry.submittedAt ? entry.submittedAt.toISOString() : null
  const staleSubmittedIncomplete = Boolean(rawSubmittedAt && !fullEntryComplete)
  const needsRefinalize = staleSubmittedIncomplete
  const submittedAt = fullEntryComplete && !needsRefinalize ? rawSubmittedAt : null

  return {
    challengeId: input.challengeId,
    entryId: input.entryId,
    groupStageComplete: groupCompletion.groupStageComplete,
    knockoutComplete,
    fullEntryComplete,
    groupsRankedCount: groupCompletion.groupsRankedCount,
    missingGroups,
    thirdPlaceSelectedCount: groupCompletion.thirdPlaceSelectedCount,
    missingKnockoutPicks: Math.max(0, requiredKnockoutPicks - completedKnockoutPicks),
    requiredKnockoutPicks,
    completedKnockoutPicks,
    isLocked: lock.locked,
    postLockKnockoutOverrideEnabled,
    isComplete: entry.isComplete,
    submittedAt,
    staleSubmittedIncomplete,
    needsRefinalize,
  }
}

export async function finalizeWorldCupEntry(input: {
  challengeId: string
  entryId: string
  userId: string
}) {
  const review = await getWorldCupEntryCompletionReview(input)
  if (review.isLocked && !review.postLockKnockoutOverrideEnabled) {
    throw new Error(WORLD_CUP_BRACKET_LOCKED_MESSAGE)
  }
  if (!review.fullEntryComplete) {
    const error = new Error("World Cup entry is incomplete.") as Error & {
      completion?: WorldCupEntryCompletionReview
    }
    error.completion = review
    throw error
  }
  if (review.submittedAt && !review.needsRefinalize) {
    throw new Error(WORLD_CUP_BRACKET_LOCKED_MESSAGE)
  }
  const submittedAt = new Date()
  const entry = await prisma.worldCupBracketEntry.update({
    where: { id: input.entryId },
    data: {
      isComplete: true,
      submittedAt,
    },
  })
  if (review.isLocked && review.postLockKnockoutOverrideEnabled) {
    await emitWorldCupKnockoutOverrideAuditEvent({
      action: "entry_finalized",
      challengeId: input.challengeId,
      entryId: input.entryId,
      userId: input.userId,
    })
  }
  return {
    entry,
    completion: {
      ...review,
      isComplete: true,
      isLocked: review.isLocked,
      submittedAt: submittedAt.toISOString(),
      staleSubmittedIncomplete: false,
      needsRefinalize: false,
    },
  }
}
