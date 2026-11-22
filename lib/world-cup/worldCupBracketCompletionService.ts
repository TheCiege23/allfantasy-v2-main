import "server-only"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { hasWorldCupPickSelection } from "./worldCupProjectedBracket"
import { isWorldCupMatchPickable } from "./worldCupProjectedBracket"
import { projectWorldCupMatchesForEntryCompletion } from "./worldCupScoringService"

type WorldCupEntryCompletionAnalysis = {
  entryId: string
  userId: string
  entryName: string
  displayName: string
  requiredPickableMatchCount: number
  completedRealPickCount: number
  missingPickCount: number
  isComplete: boolean
}

/**
 * Compare real picks (hasWorldCupPickSelection only — placeholders excluded) to the
 * projected set of pickable matches for this entry (same projection as submission completion).
 */
export function analyzeWorldCupEntryPickCompletion(input: {
  matches: Parameters<typeof projectWorldCupMatchesForEntryCompletion>[0]
  picks: Parameters<typeof projectWorldCupMatchesForEntryCompletion>[1]
  includeThirdPlace?: boolean | null
  entryId: string
  userId: string
  entryName: string
  displayName: string
}): WorldCupEntryCompletionAnalysis {
  const projectedMatches = projectWorldCupMatchesForEntryCompletion(
    input.matches,
    input.picks
  )
  const requiredMatchIds = new Set(
    projectedMatches
      .filter(
        (match) =>
          (match.round !== "third_place" || Boolean(input.includeThirdPlace)) &&
          isWorldCupMatchPickable(match)
      )
      .map((match) => match.id)
  )

  const pickedMatchIds = new Set(
    input.picks
      .filter(
        (pick) =>
          requiredMatchIds.has(pick.matchId) && hasWorldCupPickSelection(pick)
      )
      .map((pick) => pick.matchId)
  )

  const required = requiredMatchIds.size
  const completed = pickedMatchIds.size
  const missing =
    required === 0 ? 0 : Math.max(0, required - completed)

  const isComplete =
    required > 0 &&
    [...requiredMatchIds].every((matchId) => pickedMatchIds.has(matchId))

  return {
    entryId: input.entryId,
    userId: input.userId,
    entryName: input.entryName,
    displayName: input.displayName,
    requiredPickableMatchCount: required,
    completedRealPickCount: completed,
    missingPickCount: missing,
    isComplete,
  }
}

type WorldCupChallengeIncompleteSummary = {
  analyses: WorldCupEntryCompletionAnalysis[]
  incompleteEntries: WorldCupEntryCompletionAnalysis[]
  completedEntries: WorldCupEntryCompletionAnalysis[]
  totalMissingPicks: number
  usersWithIncomplete: Array<{
    userId: string
    displayName: string
    incompleteEntryCount: number
    missingPicks: number
  }>
  entriesMissingPicks: Array<{
    entryId: string
    entryName: string
    missingPicks: number
    userId: string
  }>
}

const WORLD_CUP_COMPLETION_PICK_SELECT = {
  matchId: true,
  round: true,
  selectedTeamId: true,
  selectedTeamName: true,
  selectedSlotKey: true,
} satisfies Prisma.WorldCupBracketPickSelect

export async function getWorldCupChallengeIncompleteSummary(
  challengeId: string
): Promise<WorldCupChallengeIncompleteSummary | null> {
  const challenge = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: challengeId },
    include: {
      matches: true,
      entries: {
        include: {
          picks: { select: WORLD_CUP_COMPLETION_PICK_SELECT },
          participant: true,
        },
      },
    },
  })
  if (!challenge) return null

  const analyses = challenge.entries.map((e) =>
    analyzeWorldCupEntryPickCompletion({
      matches: challenge.matches as Parameters<
        typeof projectWorldCupMatchesForEntryCompletion
      >[0],
      picks: e.picks as Parameters<
        typeof projectWorldCupMatchesForEntryCompletion
      >[1],
      includeThirdPlace: challenge.includeThirdPlace,
      entryId: e.id,
      userId: e.userId,
      entryName: e.name,
      displayName: e.participant?.displayName ?? "Player",
    })
  )

  const incompleteEntries = analyses.filter((a) => !a.isComplete)
  const completedEntries = analyses.filter((a) => a.isComplete)
  const totalMissingPicks = incompleteEntries.reduce(
    (s, a) => s + a.missingPickCount,
    0
  )

  const userAgg = new Map<
    string,
    { displayName: string; incompleteEntryCount: number; missingPicks: number }
  >()
  for (const a of incompleteEntries) {
    const cur = userAgg.get(a.userId) ?? {
      displayName: a.displayName,
      incompleteEntryCount: 0,
      missingPicks: 0,
    }
    cur.incompleteEntryCount += 1
    cur.missingPicks += a.missingPickCount
    userAgg.set(a.userId, cur)
  }

  const usersWithIncomplete = [...userAgg.entries()].map(([userId, v]) => ({
    userId,
    displayName: v.displayName,
    incompleteEntryCount: v.incompleteEntryCount,
    missingPicks: v.missingPicks,
  }))

  const entriesMissingPicks = incompleteEntries.map((a) => ({
    entryId: a.entryId,
    entryName: a.entryName,
    missingPicks: a.missingPickCount,
    userId: a.userId,
  }))

  return {
    analyses,
    incompleteEntries,
    completedEntries,
    totalMissingPicks,
    usersWithIncomplete,
    entriesMissingPicks,
  }
}
