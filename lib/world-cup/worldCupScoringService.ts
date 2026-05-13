import "server-only"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getWorldCupRoundPoints, isWorldCupChallengeLocked } from "./worldCupBracketBuilder"
import type { WorldCupLeaderboardRow, WorldCupRound, WorldCupScoringValues } from "./types"
import {
  findWorldCupPickForMatch,
  hasWorldCupPickSelection,
  isOfficialWorldCupFixtureState,
  isWorldCupMatchPickable,
  resetWorldCupProjectedMatchStatus,
} from "./worldCupProjectedBracket"

type DbMatch = {
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

type DbPick = {
  id: string
  matchId: string
  matchNumber?: number | null
  round: WorldCupRound | string
  selectedTeamId: string | null
  selectedTeamName: string
  selectedSlotKey: string | null
  match?: DbMatch | null
  pointsAwarded?: number
  isCorrect?: boolean | null
}

type DbEntryForLb = {
  id: string
  participantId: string
  userId: string
  name: string
  createdAt: Date
  championTeamId?: string | null
  championTeamName?: string | null
  updatedAt: Date
  submittedAt?: Date | null
  picks: DbPick[]
  participant?: {
    displayName: string
    user?: { username: string; avatarUrl: string | null; displayName: string | null } | null
  }
}

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
  pickOrMatch: Pick<DbPick, "round" | "selectedTeamId" | "selectedTeamName" | "selectedSlotKey"> | DbMatch,
  matchOrPick: DbMatch | Partial<Pick<DbPick, "round" | "selectedTeamId" | "selectedTeamName" | "selectedSlotKey">>,
  scoring?: Partial<WorldCupScoringValues> | null,
  options?: { allowSimulated?: boolean }
) {
  const firstLooksLikeMatch = "status" in pickOrMatch && ("winnerTeamId" in pickOrMatch || "winnerTeamName" in pickOrMatch)
  const match = (firstLooksLikeMatch ? pickOrMatch : matchOrPick) as DbMatch
  const pick = (firstLooksLikeMatch ? matchOrPick : pickOrMatch) as Partial<Pick<DbPick, "round" | "selectedTeamId" | "selectedTeamName" | "selectedSlotKey">>
  if (!hasWorldCupPickSelection(pick)) return { isCorrect: null, pointsAwarded: 0 }
  const officialOrSimAllowed = isOfficialWorldCupFixtureState(match) || Boolean(options?.allowSimulated)
  if (
    match.status !== "final" ||
    !officialOrSimAllowed ||
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
  return { isCorrect, pointsAwarded: isCorrect ? getWorldCupRoundPoints((pick.round ?? match.round) as WorldCupRound, scoring) : 0 }
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
  allowSimulated?: boolean
}): WorldCupLeaderboardRow[] {
  const rows = input.entries.map((e) => {
    const picks = e.picks.filter(hasWorldCupPickSelection)
    const roundBreakdown: Record<string, number> = {}
    let totalScore = 0
    let maxPossibleScore = 0
    let correctPicks = 0
    let incorrectPicks = 0
    for (const pick of picks) {
      const r = pick.match ? evaluateWorldCupPick(pick, pick.match, input.scoring, { allowSimulated: input.allowSimulated }) : { isCorrect: pick.isCorrect ?? null, pointsAwarded: pick.pointsAwarded ?? 0 }
      if (r.isCorrect === true) correctPicks++
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
      roundBreakdown,
      joinedAt,
      updatedAt,
      submittedAt,
    }
  })
  rows.sort(
    (a, b) =>
      b.totalScore - a.totalScore ||
      b.maxPossibleScore - a.maxPossibleScore ||
      Number(b.championStillAlive) - Number(a.championStillAlive) ||
      (a.submittedAt && b.submittedAt
        ? new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
        : a.submittedAt
          ? -1
          : b.submittedAt
            ? 1
            : 0) ||
      new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime()
  )
  return rows.map(({ submittedAt, ...r }, i) => ({ ...r, rank: i + 1 }))
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
      entries: { include: { picks: { include: { match: true } } } },
    },
  })
  if (!c) throw new Error("World Cup bracket challenge not found")

  const allowSimulated = Boolean((c as { isTestMode?: boolean }).isTestMode)

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    for (const entry of c.entries) {
      for (const pick of entry.picks) {
        if (!pick.match) continue
        const r = evaluateWorldCupPick(pick, pick.match, c.scoringProfile, { allowSimulated })
        await tx.worldCupBracketPick.update({
          where: { id: pick.id },
          data: {
            pointsAwarded: r.pointsAwarded,
            isCorrect: r.isCorrect,
            lockedAt: pick.match.status === "final" ? new Date() : undefined,
          },
        })
      }
    }
  })

  const fresh = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: challengeId },
    include: {
      scoringProfile: true,
      matches: true,
      participants: true,
      entries: {
        include: {
          picks: { include: { match: true } },
          participant: {
            include: {
              user: { select: { username: true, avatarUrl: true, displayName: true } },
            },
          },
        },
      },
    },
  })
  if (!fresh) throw new Error("World Cup bracket challenge not found")

  const refreshedRows = buildWorldCupLeaderboardRows({
    entries: fresh.entries as DbEntryForLb[],
    matches: fresh.matches as DbMatch[],
    scoring: fresh.scoringProfile,
    allowSimulated,
  })

  const bracketLocked = isWorldCupChallengeLocked({
    challenge: fresh,
    matches: fresh.matches,
  }).locked

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.worldCupBracketEntry.updateMany({
      where: { challengeId },
      data: { isLocked: bracketLocked },
    })

    for (const row of refreshedRows) {
      const freshEntry = fresh.entries.find(
        (entry: { id: string }) => entry.id === row.entryId
      )
      const entryComplete = freshEntry
        ? isWorldCupEntryCompleteFromSelections({
            matches: fresh.matches as DbMatch[],
            picks: freshEntry.picks,
            includeThirdPlace: fresh.includeThirdPlace,
          })
        : false
      await tx.worldCupBracketEntry.update({
        where: { id: row.entryId },
        data: {
          totalScore: row.totalScore,
          maxPossibleScore: row.maxPossibleScore,
          correctPicks: row.correctPicks,
          incorrectPicks: row.incorrectPicks,
          rank: row.rank,
          roundBreakdown: row.roundBreakdown,
          isComplete: entryComplete,
          submittedAt: entryComplete ? freshEntry?.submittedAt ?? new Date() : null,
        },
      })
    }

    const byParticipant = new Map<string, WorldCupLeaderboardRow[]>()
    for (const row of refreshedRows) {
      const list = byParticipant.get(row.participantId) ?? []
      list.push(row)
      byParticipant.set(row.participantId, list)
    }

    for (const p of fresh.participants) {
      const list = byParticipant.get(p.id) ?? []
      const best = list[0] ?? null
      await tx.worldCupBracketParticipant.update({
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
    }
  })

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
