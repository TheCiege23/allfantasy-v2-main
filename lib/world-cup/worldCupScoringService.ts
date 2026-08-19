import "server-only"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { DEFAULT_WORLD_CUP_SCORING, getWorldCupRoundPoints, isWorldCupChallengeLocked } from "./worldCupBracketBuilder"
import type { WorldCupLeaderboardRow, WorldCupRound, WorldCupScoringValues } from "./types"
import {
  findWorldCupPickForMatch,
  hasWorldCupPickSelection,
  isOfficialWorldCupFixtureState,
  isWorldCupMatchPickable,
  resetWorldCupProjectedMatchStatus,
} from "./worldCupProjectedBracket"

export type DbMatch = {
  id: string
  round: WorldCupRound | string
  homeSlotKey: string
  awaySlotKey: string
  homeTeamId: string | null
  awayTeamId: string | null
  homeTeamName: string
  awayTeamName: string
  status: string
  apiFixtureId?: number | null
  startsAt?: Date | string | null
  homeScore?: number | null
  awayScore?: number | null
  homePenaltyScore?: number | null
  awayPenaltyScore?: number | null
  winnerTeamId: string | null
  winnerTeamName: string | null
  elapsedMinute?: number | null
  injuryTime?: number | null
  period?: string | null
  apiStatusShort?: string | null
  lastScoreSyncedAt?: Date | string | null
  nextMatchId?: string | null
  nextMatchSlot?: string | null
}

export type DbPick = {
  id: string
  matchId: string
  matchNumber?: number | null
  round: WorldCupRound | string
  selectedTeamId: string | null
  selectedTeamName: string
  selectedSlotKey: string | null
  confidencePoints?: number | null
  match?: DbMatch | null
  pointsAwarded?: number
  isCorrect?: boolean | null
}

export type DbEntryForLb = {
  id: string
  participantId: string
  userId: string
  name: string
  createdAt: Date
  championTeamId?: string | null
  championTeamName?: string | null
  updatedAt: Date
  submittedAt?: Date | null
  groupWinnersCorrect?: number | null
  groupRankingPicks?: Array<{ predictedRank: number; actualRank?: number | null }> | null
  picks: DbPick[]
  participant?: {
    displayName: string
    user?: { username: string; avatarUrl: string | null; displayName: string | null } | null
  }
}

const WORLD_CUP_KNOCKOUT_TIEBREAKER_ROUNDS = new Set<string>([
  "round_of_32",
  "round_of_16",
  "quarterfinal",
  "semifinal",
  "third_place",
  "final",
])

const WORLD_CUP_SCORING_PICK_WITH_MATCH_SELECT = {
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

function winnerSlotKey(m: DbMatch) {
  if (m.winnerTeamId && m.winnerTeamId === m.homeTeamId) return m.homeSlotKey
  if (m.winnerTeamId && m.winnerTeamId === m.awayTeamId) return m.awaySlotKey
  if (m.winnerTeamName && m.winnerTeamName === m.homeTeamName) return m.homeSlotKey
  if (m.winnerTeamName && m.winnerTeamName === m.awayTeamName) return m.awaySlotKey
  return null
}

function normalizeTeamName(value?: string | null) {
  return value?.trim().toLowerCase() ?? ""
}

function selectionPlayedInMatch(
  pick: Partial<Pick<DbPick, "selectedTeamId" | "selectedTeamName" | "selectedSlotKey">>,
  match: DbMatch
) {
  const selectedName = normalizeTeamName(pick.selectedTeamName)
  return Boolean(
    (pick.selectedTeamId &&
      (pick.selectedTeamId === match.homeTeamId || pick.selectedTeamId === match.awayTeamId)) ||
      (pick.selectedSlotKey &&
        (pick.selectedSlotKey === match.homeSlotKey || pick.selectedSlotKey === match.awaySlotKey)) ||
      (selectedName &&
        (selectedName === normalizeTeamName(match.homeTeamName) ||
          selectedName === normalizeTeamName(match.awayTeamName)))
  )
}

function selectionWonMatch(
  pick: Partial<Pick<DbPick, "selectedTeamId" | "selectedTeamName" | "selectedSlotKey">>,
  match: DbMatch
) {
  const selectedName = normalizeTeamName(pick.selectedTeamName)
  const winnerName = normalizeTeamName(match.winnerTeamName)
  const slot = winnerSlotKey(match)
  return Boolean(
    (pick.selectedTeamId && match.winnerTeamId && pick.selectedTeamId === match.winnerTeamId) ||
      (pick.selectedSlotKey && slot && pick.selectedSlotKey === slot) ||
      (selectedName && winnerName && selectedName === winnerName)
  )
}

function selectionMatchesTeam(
  pick: Partial<Pick<DbPick, "selectedTeamId" | "selectedTeamName" | "selectedSlotKey">>,
  team: { id?: string | null; name?: string | null; slotKey?: string | null }
) {
  const selectedName = normalizeTeamName(pick.selectedTeamName)
  const teamName = normalizeTeamName(team.name)
  return Boolean(
    (pick.selectedTeamId && team.id && pick.selectedTeamId === team.id) ||
      (pick.selectedSlotKey && team.slotKey && pick.selectedSlotKey === team.slotKey) ||
      (selectedName && teamName && selectedName === teamName)
  )
}

function compareIsoNullableAsc(a?: string | null, b?: string | null) {
  if (a && b) return new Date(a).getTime() - new Date(b).getTime()
  if (a) return -1
  if (b) return 1
  return 0
}

function countCorrectGroupWinners(entry: DbEntryForLb) {
  if (entry.groupWinnersCorrect != null) return Math.max(0, Number(entry.groupWinnersCorrect))
  return (entry.groupRankingPicks ?? []).filter(
    (pick) => pick.predictedRank === 1 && pick.actualRank === 1
  ).length
}

function isWorldCupPickSelectionStillAlive(
  pick: Partial<Pick<DbPick, "selectedTeamId" | "selectedTeamName" | "selectedSlotKey">>,
  matches: DbMatch[]
) {
  if (!pick.selectedTeamId && !pick.selectedSlotKey && !normalizeTeamName(pick.selectedTeamName)) {
    return false
  }
  return !matches.some(
    (match) =>
      match.status === "final" &&
      isOfficialWorldCupFixtureState(match) &&
      Boolean(match.winnerTeamId || match.winnerTeamName) &&
      selectionPlayedInMatch(pick, match) &&
      !selectionWonMatch(pick, match)
  )
}

export function evaluateWorldCupPick(
  pickOrMatch: (Pick<DbPick, "round" | "selectedTeamId" | "selectedTeamName" | "selectedSlotKey"> & { confidencePoints?: number | null }) | DbMatch,
  matchOrPick: DbMatch | Partial<Pick<DbPick, "round" | "selectedTeamId" | "selectedTeamName" | "selectedSlotKey" | "confidencePoints">>,
  scoring?: Partial<WorldCupScoringValues> | null
) {
  const firstLooksLikeMatch = "status" in pickOrMatch && ("winnerTeamId" in pickOrMatch || "winnerTeamName" in pickOrMatch)
  const match = (firstLooksLikeMatch ? pickOrMatch : matchOrPick) as DbMatch
  const pick = (firstLooksLikeMatch ? matchOrPick : pickOrMatch) as Partial<Pick<DbPick, "round" | "selectedTeamId" | "selectedTeamName" | "selectedSlotKey">>
  if (!hasWorldCupPickSelection(pick)) return { isCorrect: null, pointsAwarded: 0 }
  if (
    match.status !== "final" ||
    !isOfficialWorldCupFixtureState(match) ||
    (!match.winnerTeamId && !match.winnerTeamName)
  ) {
    return { isCorrect: null, pointsAwarded: 0 }
  }
  const slot = winnerSlotKey(match)
  const isCorrect = Boolean(
    (pick.selectedTeamId && match.winnerTeamId && pick.selectedTeamId === match.winnerTeamId) ||
      (pick.selectedTeamName && match.winnerTeamName && pick.selectedTeamName === match.winnerTeamName) ||
      (pick.selectedSlotKey && slot && pick.selectedSlotKey === slot)
  )
  const confidenceBonus =
    isCorrect && scoring?.confidenceScoringEnabled === true
      ? normalizeWorldCupScoringConfidencePoints((pick as Partial<DbPick>).confidencePoints)
      : 0
  return {
    isCorrect,
    pointsAwarded: isCorrect
      ? getWorldCupRoundPoints((pick.round ?? match.round) as WorldCupRound, scoring) + confidenceBonus
      : 0,
  }
}

export function normalizeWorldCupScoringConfidencePoints(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 32 ? n : 0
}

function readWorldCupConfidenceScoringEnabled(sourcePayload: unknown): boolean {
  if (!sourcePayload || typeof sourcePayload !== "object" || Array.isArray(sourcePayload)) return false
  const leagueSettings = (sourcePayload as Record<string, unknown>).leagueSettings
  if (!leagueSettings || typeof leagueSettings !== "object" || Array.isArray(leagueSettings)) return false
  return (leagueSettings as Record<string, unknown>).confidenceScoringEnabled === true
}

export function isChampionStillAlive(
  p:
    | (Pick<DbEntryForLb, "championTeamId" | "championTeamName"> & {
        championPickTeamId?: string | null
        championPickName?: string | null
        matches?: DbMatch[]
      })
    | null
    | undefined,
  matches?: DbMatch[]
) {
  if (!p) return false
  matches = matches ?? p.matches ?? []
  const id = p.championTeamId ?? p.championPickTeamId
  const name = p.championTeamName ?? p.championPickName
  if (!id && !name) return false
  return isWorldCupPickSelectionStillAlive(
    {
      selectedTeamId: id ?? null,
      selectedTeamName: name ?? "",
      selectedSlotKey: null,
    },
    matches
  )
}

/** Leaderboard rows are one per bracket entry (not per participant). */
export function buildWorldCupLeaderboardRows(input: {
  entries: DbEntryForLb[]
  matches: DbMatch[]
  scoring?: Partial<WorldCupScoringValues> | null
}): WorldCupLeaderboardRow[] {
  const finalizedEntries = input.entries.filter((entry) => Boolean(entry.submittedAt))
  const rows = finalizedEntries.map((e) => {
    const picks = e.picks.filter(hasWorldCupPickSelection)
    const roundBreakdown: Record<string, number> = {}
    let totalScore = 0
    let maxPossibleScore = 0
    let correctPicks = 0
    let incorrectPicks = 0
    let knockoutPicksCorrect = 0
    for (const pick of picks) {
      const r = pick.match ? evaluateWorldCupPick(pick, pick.match, input.scoring) : { isCorrect: pick.isCorrect ?? null, pointsAwarded: pick.pointsAwarded ?? 0 }
      if (r.isCorrect === true) {
        correctPicks++
        if (WORLD_CUP_KNOCKOUT_TIEBREAKER_ROUNDS.has(String(pick.round))) {
          knockoutPicksCorrect++
        }
      }
      if (r.isCorrect === false) incorrectPicks++
      totalScore += r.pointsAwarded
      if (pick.round) roundBreakdown[pick.round] = (roundBreakdown[pick.round] ?? 0) + r.pointsAwarded
      if (r.isCorrect === true) {
        maxPossibleScore += r.pointsAwarded
      } else if (
        r.isCorrect === null &&
        pick.round &&
        isWorldCupPickSelectionStillAlive(pick, input.matches)
      ) {
        maxPossibleScore += getWorldCupRoundPoints(pick.round as WorldCupRound, input.scoring)
      }
    }
    // Champion bonus — awarded on top of final-round pick points when the
    // entry's champion pick matches the tournament winner.
    const championBonus =
      input.scoring?.championBonusPoints ?? DEFAULT_WORLD_CUP_SCORING.championBonusPoints
    const championPickForBonus = picks.find((x) => x.round === "final")
    const championTeamIdForBonus =
      e.championTeamId ?? championPickForBonus?.selectedTeamId ?? null
    const championTeamNameForBonus =
      e.championTeamName ?? championPickForBonus?.selectedTeamName ?? null
    const finalMatch = input.matches.find(
      (m) =>
        m.round === "final" &&
        m.status === "final" &&
        (m.winnerTeamId || m.winnerTeamName)
    )
    let championCorrect = false
    if (finalMatch) {
      // Tournament is over — award bonus if champion pick is correct
      const wonBonus = Boolean(
        (championTeamIdForBonus &&
          finalMatch.winnerTeamId &&
          championTeamIdForBonus === finalMatch.winnerTeamId) ||
          (championTeamNameForBonus &&
            finalMatch.winnerTeamName &&
            normalizeTeamName(championTeamNameForBonus) ===
              normalizeTeamName(finalMatch.winnerTeamName))
      )
      championCorrect = wonBonus
      if (wonBonus) {
        totalScore += championBonus
        maxPossibleScore += championBonus
      }
    } else if (championTeamIdForBonus || championTeamNameForBonus) {
      // Tournament not over — include bonus in max possible if pick is still alive
      const stillAlive = isWorldCupPickSelectionStillAlive(
        {
          selectedTeamId: championTeamIdForBonus ?? null,
          selectedTeamName: championTeamNameForBonus ?? "",
          selectedSlotKey: null,
        },
        input.matches
      )
      if (stillAlive) {
        maxPossibleScore += championBonus
      }
    }

    const finalFixture = input.matches.find(
      (m) =>
        m.round === "final" &&
        (m.homeTeamId ||
          m.awayTeamId ||
          normalizeTeamName(m.homeTeamName) ||
          normalizeTeamName(m.awayTeamName))
    )
    const semifinalPicks = picks.filter((pick) => pick.round === "semifinal")
    const finalistsCorrect = finalFixture
      ? [
          {
            id: finalFixture.homeTeamId,
            name: finalFixture.homeTeamName,
            slotKey: finalFixture.homeSlotKey,
          },
          {
            id: finalFixture.awayTeamId,
            name: finalFixture.awayTeamName,
            slotKey: finalFixture.awaySlotKey,
          },
        ].filter((team) => semifinalPicks.some((pick) => selectionMatchesTeam(pick, team))).length
      : 0
    const groupWinnersCorrect = countCorrectGroupWinners(e)

    const joinedAt = e.createdAt instanceof Date ? e.createdAt.toISOString() : new Date(e.createdAt).toISOString()
    const updatedAt = e.updatedAt instanceof Date ? e.updatedAt.toISOString() : new Date(e.updatedAt).toISOString()
    const submittedAt = e.submittedAt
      ? e.submittedAt instanceof Date
        ? e.submittedAt.toISOString()
        : new Date(e.submittedAt).toISOString()
      : null
    const u = e.participant?.user
    const championPick = picks.find((x) => x.round === "final")
    const championTeamId = e.championTeamId ?? championPick?.selectedTeamId ?? null
    const championPickName = e.championTeamName ?? championPick?.selectedTeamName ?? null
    return {
      rank: 0,
      entryId: e.id,
      entryName: e.name,
      participantId: e.participantId,
      userId: e.userId,
      username: u?.username ?? null,
      avatarUrl: u?.avatarUrl ?? null,
      displayName: e.participant?.displayName ?? "Player",
      totalScore,
      maxPossibleScore,
      correctPicks,
      incorrectPicks,
      championPickName,
      championTeamId,
      championStillAlive: isChampionStillAlive(
        { championTeamId, championTeamName: championPickName },
        input.matches
      ),
      championCorrect,
      finalistsCorrect,
      knockoutPicksCorrect,
      groupWinnersCorrect,
      roundBreakdown,
      joinedAt,
      updatedAt,
      submittedAt,
    }
  })
  const compareVisionTieBreakers = (a: WorldCupLeaderboardRow, b: WorldCupLeaderboardRow) =>
    b.totalScore - a.totalScore ||
    Number(b.championCorrect) - Number(a.championCorrect) ||
    b.finalistsCorrect - a.finalistsCorrect ||
    b.knockoutPicksCorrect - a.knockoutPicksCorrect ||
    b.groupWinnersCorrect - a.groupWinnersCorrect ||
    compareIsoNullableAsc(a.submittedAt, b.submittedAt)

  rows.sort(
    (a, b) =>
      compareVisionTieBreakers(a, b) ||
      new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime()
  )

  let lastRank = 0
  let lastRow: WorldCupLeaderboardRow | null = null
  return rows.map((row, i) => {
    const rank = lastRow && compareVisionTieBreakers(lastRow, row) === 0 ? lastRank : i + 1
    lastRank = rank
    lastRow = row
    return { ...row, rank }
  })
}

export function isWorldCupEntryCompleteFromSelections(input: {
  matches: Array<DbMatch>
  picks: Array<Pick<DbPick, "matchId" | "round" | "selectedTeamId" | "selectedSlotKey"> & { matchNumber?: number | null }>
  includeThirdPlace?: boolean | null
}): boolean {
  const projectedMatches = projectWorldCupMatchesForEntryCompletion(input.matches, input.picks)
  const requiredMatches = projectedMatches.filter(
    (match) =>
      (match.round !== "third_place" || Boolean(input.includeThirdPlace)) &&
      isWorldCupMatchPickable(match)
  )
  if (requiredMatches.length === 0) return false

  return requiredMatches.every((match) => Boolean(findWorldCupPickForMatch(input.picks, match)))
}

export function projectWorldCupMatchesForEntryCompletion(
  matches: Array<DbMatch>,
  picks: Array<Pick<DbPick, "matchId" | "round" | "selectedTeamId" | "selectedSlotKey"> & { matchNumber?: number | null }>
): DbMatch[] {
  const out = matches.map((match) => ({ ...match }))
  const byId = new Map(out.map((match) => [match.id, match]))
  const realPicks = picks.filter(hasWorldCupPickSelection)

  for (const match of out) {
    const pick = findWorldCupPickForMatch(realPicks, match)
    const next = match.nextMatchId ? byId.get(match.nextMatchId) : null
    if (!pick || !next || !match.nextMatchSlot) continue

    const pickedHome =
      (pick.selectedTeamId && pick.selectedTeamId === match.homeTeamId) ||
      (pick.selectedSlotKey && pick.selectedSlotKey === match.homeSlotKey)
    const team = pickedHome
      ? {
          id: match.homeTeamId,
          name: match.homeTeamName,
        }
      : {
          id: match.awayTeamId,
          name: match.awayTeamName,
        }

    resetWorldCupProjectedMatchStatus(next)

    if (match.nextMatchSlot === "home") {
      next.homeTeamId = team.id
      next.homeTeamName = team.name
    } else {
      next.awayTeamId = team.id
      next.awayTeamName = team.name
    }
  }

  return out
}

export async function recalculateWorldCupChallenge(challengeId: string) {
  const c = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: challengeId },
    include: {
      scoringProfile: true,
      matches: true,
      entries: {
        include: {
          picks: { select: WORLD_CUP_SCORING_PICK_WITH_MATCH_SELECT },
        },
      },
    },
  })
  if (!c) throw new Error("World Cup bracket challenge not found")

  // Group picks by identical outcome so one write covers every pick that scored the
  // same way. The previous shape — an `await` per pick inside an interactive
  // transaction — issued one round-trip per pick and blew past Prisma's 5s
  // interactive-transaction budget on real challenges, aborting the whole
  // recalculate with "Transaction not found ... refers to an old closed transaction".
  const pickScoring = {
    ...(c.scoringProfile ?? {}),
    confidenceScoringEnabled: readWorldCupConfidenceScoringEnabled(c.sourcePayload),
  }
  const recalculatedAt = new Date()
  const pickBuckets = new Map<
    string,
    { pointsAwarded: number; isCorrect: boolean | null; lock: boolean; ids: string[] }
  >()
  for (const entry of c.entries) {
    for (const pick of entry.picks) {
      if (!pick.match) continue
      const r = evaluateWorldCupPick(pick, pick.match, pickScoring)
      const lock = pick.match.status === "final"
      const key = `${r.pointsAwarded}|${r.isCorrect}|${lock}`
      const bucket = pickBuckets.get(key)
      if (bucket) {
        bucket.ids.push(pick.id)
      } else {
        pickBuckets.set(key, {
          pointsAwarded: r.pointsAwarded,
          isCorrect: r.isCorrect,
          lock,
          ids: [pick.id],
        })
      }
    }
  }

  if (pickBuckets.size > 0) {
    await prisma.$transaction(
      [...pickBuckets.values()].map((bucket) =>
        prisma.worldCupBracketPick.updateMany({
          where: { id: { in: bucket.ids } },
          data: {
            pointsAwarded: bucket.pointsAwarded,
            isCorrect: bucket.isCorrect,
            lockedAt: bucket.lock ? recalculatedAt : undefined,
          },
        })
      )
    )
  }

  const fresh = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: challengeId },
    include: {
      scoringProfile: true,
      matches: true,
      participants: true,
      entries: {
        include: {
          picks: { select: WORLD_CUP_SCORING_PICK_WITH_MATCH_SELECT },
          participant: {
            include: {
              user: { select: { username: true, avatarUrl: true, displayName: true } },
            },
          },
          groupRankingPicks: {
            select: {
              predictedRank: true,
              actualRank: true,
            },
          },
        },
      },
    },
  })
  if (!fresh) throw new Error("World Cup bracket challenge not found")

  const submittedEntryIds = new Set(fresh.entries.filter((entry) => entry.submittedAt).map((entry) => entry.id))
  const refreshedRows = buildWorldCupLeaderboardRows({
    entries: fresh.entries.filter((entry) => submittedEntryIds.has(entry.id)) as DbEntryForLb[],
    matches: fresh.matches as DbMatch[],
    scoring: {
      ...(fresh.scoringProfile ?? {}),
      confidenceScoringEnabled: readWorldCupConfidenceScoringEnabled(fresh.sourcePayload),
    },
  })

  const bracketLocked = isWorldCupChallengeLocked({
    challenge: fresh,
    matches: fresh.matches,
  }).locked

  const byParticipant = new Map<string, WorldCupLeaderboardRow[]>()
  for (const row of refreshedRows) {
    const list = byParticipant.get(row.participantId) ?? []
    list.push(row)
    byParticipant.set(row.participantId, list)
  }

  // Batch form (`$transaction([...])`) rather than the interactive form: every write
  // below is known up front, so this ships them as one round-trip instead of holding
  // a transaction open across N awaits — same atomicity and ordering, no 5s budget.
  const leaderboardWrites: Prisma.PrismaPromise<unknown>[] = [
    prisma.worldCupBracketEntry.updateMany({
      where: { challengeId },
      data: { isLocked: bracketLocked },
    }),
  ]

  for (const row of refreshedRows) {
    const freshEntry = fresh.entries.find((entry: { id: string }) => entry.id === row.entryId)
    const entryComplete = freshEntry
      ? isWorldCupEntryCompleteFromSelections({
          matches: fresh.matches as DbMatch[],
          picks: freshEntry.picks,
          includeThirdPlace: fresh.includeThirdPlace,
        })
      : false
    leaderboardWrites.push(
      prisma.worldCupBracketEntry.update({
        where: { id: row.entryId },
        data: {
          totalScore: row.totalScore,
          maxPossibleScore: row.maxPossibleScore,
          correctPicks: row.correctPicks,
          incorrectPicks: row.incorrectPicks,
          rank: row.rank,
          roundBreakdown: row.roundBreakdown,
          isComplete: entryComplete,
          submittedAt: entryComplete ? freshEntry?.submittedAt ?? null : null,
        },
      })
    )
  }

  leaderboardWrites.push(
    prisma.worldCupBracketEntry.updateMany({
      where: {
        challengeId,
        id: { notIn: [...submittedEntryIds] },
      },
      data: {
        totalScore: 0,
        maxPossibleScore: 0,
        correctPicks: 0,
        incorrectPicks: 0,
        rank: null,
        roundBreakdown: {},
      },
    })
  )

  for (const p of fresh.participants) {
    const best = byParticipant.get(p.id)?.[0] ?? null
    leaderboardWrites.push(
      prisma.worldCupBracketParticipant.update({
        where: { id: p.id },
        data: {
          totalScore: best?.totalScore ?? 0,
          maxPossibleScore: best?.maxPossibleScore ?? 0,
          correctPicks: best?.correctPicks ?? 0,
          rank: null,
          roundBreakdown: best?.roundBreakdown ?? undefined,
          championPickTeamId: best?.championTeamId ?? null,
          championPickName: best?.championPickName ?? null,
        },
      })
    )
  }

  await prisma.$transaction(leaderboardWrites)

  void import("./worldCupBracketRecalculateHooks")
    .then((m) => m.afterWorldCupRecalculate(challengeId))
    .catch(() => {})

  return refreshedRows
}

/** Display helpers for bracket shell / leaderboard UI */
export {
  buildWorldCupRoundBreakdownRows,
  getWorldCupPossiblePointsRemaining,
  getWorldCupRankMovement,
} from "./worldCupLeaderboardService"
