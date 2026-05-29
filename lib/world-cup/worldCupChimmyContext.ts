import "server-only"
import { prisma } from "@/lib/prisma"
import { DEFAULT_WORLD_CUP_SCORING } from "./worldCupBracketBuilder"
import type { WorldCupScoringValues } from "./types"

// ── Public types ──────────────────────────────────────────────────────────────

export type ChimmyLiveDataStatus = "live" | "fixture_only" | "unavailable"

export type ChimmyMatchSummary = {
  matchId: string
  round: string
  homeTeamName: string
  awayTeamName: string
  homeScore: number | null
  awayScore: number | null
  homePenaltyScore: number | null
  awayPenaltyScore: number | null
  winnerTeamName: string | null
  status: string
  minute: number | null
  injuryTime: number | null
  startsAt: string | null
  venueName: string | null
  venueCity: string | null
  apiStatusShort: string | null
  lastSyncedAt: string | null
}

export type ChimmyGroupPickRow = {
  rank: number
  teamName: string
  groupKey: string
  groupName: string
  isCorrect: boolean | null
  pointsAwarded: number
}

export type ChimmyKnockoutPickRow = {
  round: string
  homeTeamName: string
  awayTeamName: string
  pickedTeam: string
  isCorrect: boolean | null
  pointsAwarded: number
}

export type ChimmyUserEntry = {
  entryId: string
  entryName: string
  championPick: string | null
  totalScore: number
  maxPossibleScore: number
  rank: number | null
  correctPicks: number
  incorrectPicks: number
  isComplete: boolean
  isLocked: boolean
  groupPicks: ChimmyGroupPickRow[]
  knockoutPicks: ChimmyKnockoutPickRow[]
}

export type ChimmyGroupStandingRow = {
  groupName: string
  teamName: string
  rank: number | null
  played: number
  wins: number
  draws: number
  losses: number
  points: number
  goalDifference: number
  isThirdPlaceAdvancer: boolean
}

export type WorldCupChimmyContext = {
  challengeId: string
  poolName: string
  isLocked: boolean
  lockReason: string | null
  participantCount: number
  scoring: WorldCupScoringValues
  entry: ChimmyUserEntry | null
  liveMatches: ChimmyMatchSummary[]
  upcomingMatches: ChimmyMatchSummary[]
  recentMatches: ChimmyMatchSummary[]
  groupStandings: ChimmyGroupStandingRow[]
  liveDataStatus: ChimmyLiveDataStatus
  lastSyncedAt: string | null
  locale: string | null
  fetchedAt: string
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function fetchChallengeSummary(challengeId: string): Promise<{
  name: string
  isLocked: boolean
  lockReason: string | null
  participantCount: number
  scoring: WorldCupScoringValues
} | null> {
  try {
    const row = await (prisma as any).worldCupBracketChallenge.findUnique({
      where: { id: challengeId },
      select: {
        id: true,
        name: true,
        status: true,
        pickLockAt: true,
        _count: { select: { participants: true } },
        scoringProfile: {
          select: {
            roundOf32Points: true,
            roundOf16Points: true,
            quarterFinalPoints: true,
            semiFinalPoints: true,
            finalPoints: true,
            championBonusPoints: true,
            thirdPlacePoints: true,
          },
        },
      },
    })
    if (!row) return null

    const now = new Date()
    const isLocked =
      row.status === "locked" ||
      (row.pickLockAt != null && new Date(row.pickLockAt) <= now)

    const sp = row.scoringProfile
    const scoring: WorldCupScoringValues =
      sp != null
        ? {
            roundOf32Points: Number(sp.roundOf32Points ?? DEFAULT_WORLD_CUP_SCORING.roundOf32Points),
            roundOf16Points: Number(sp.roundOf16Points ?? DEFAULT_WORLD_CUP_SCORING.roundOf16Points),
            quarterFinalPoints: Number(sp.quarterFinalPoints ?? DEFAULT_WORLD_CUP_SCORING.quarterFinalPoints),
            semiFinalPoints: Number(sp.semiFinalPoints ?? DEFAULT_WORLD_CUP_SCORING.semiFinalPoints),
            finalPoints: Number(sp.finalPoints ?? DEFAULT_WORLD_CUP_SCORING.finalPoints),
            championBonusPoints: Number(sp.championBonusPoints ?? DEFAULT_WORLD_CUP_SCORING.championBonusPoints),
            thirdPlacePoints: sp.thirdPlacePoints != null ? Number(sp.thirdPlacePoints) : DEFAULT_WORLD_CUP_SCORING.thirdPlacePoints,
          }
        : { ...DEFAULT_WORLD_CUP_SCORING }

    return {
      name: String(row.name ?? "World Cup Pool"),
      isLocked,
      lockReason: null, // derived from status/pickLockAt, not stored separately
      participantCount: Number(row._count?.participants ?? 0),
      scoring,
    }
  } catch {
    return null
  }
}

async function fetchUserEntry(challengeId: string, userId: string): Promise<ChimmyUserEntry | null> {
  try {
    const row = await (prisma as any).worldCupBracketEntry.findFirst({
      where: { challengeId, userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        championTeamName: true,
        totalScore: true,
        maxPossibleScore: true,
        rank: true,
        correctPicks: true,
        incorrectPicks: true,
        isComplete: true,
        isLocked: true,
        groupRankingPicks: {
          select: {
            predictedRank: true,
            isCorrect: true,
            pointsAwarded: true,
            group: { select: { groupKey: true, displayName: true } },
            team: { select: { name: true } },
          },
          orderBy: [{ group: { groupKey: "asc" } }, { predictedRank: "asc" }],
        },
        picks: {
          select: {
            round: true,
            selectedTeamName: true,
            isCorrect: true,
            pointsAwarded: true,
            match: { select: { homeTeamName: true, awayTeamName: true } },
          },
          orderBy: { round: "asc" },
          take: 24,
        },
      },
    })
    if (!row) return null

    const groupPicks: ChimmyGroupPickRow[] = (row.groupRankingPicks ?? []).map((p: any) => ({
      rank: Number(p.predictedRank ?? 0),
      teamName: String(p.team?.name ?? "Unknown"),
      groupKey: String(p.group?.groupKey ?? "?"),
      groupName: String(p.group?.displayName ?? "?"),
      isCorrect: typeof p.isCorrect === "boolean" ? p.isCorrect : null,
      pointsAwarded: Number(p.pointsAwarded ?? 0),
    }))

    const knockoutPicks: ChimmyKnockoutPickRow[] = (row.picks ?? []).map((p: any) => ({
      round: String(p.round ?? "?"),
      homeTeamName: String(p.match?.homeTeamName ?? "?"),
      awayTeamName: String(p.match?.awayTeamName ?? "?"),
      pickedTeam: String(p.selectedTeamName ?? "?"),
      isCorrect: typeof p.isCorrect === "boolean" ? p.isCorrect : null,
      pointsAwarded: Number(p.pointsAwarded ?? 0),
    }))

    return {
      entryId: String(row.id),
      entryName: String(row.name ?? "My Entry"),
      championPick: typeof row.championTeamName === "string" ? row.championTeamName : null,
      totalScore: Number(row.totalScore ?? 0),
      maxPossibleScore: Number(row.maxPossibleScore ?? 0),
      rank: typeof row.rank === "number" ? row.rank : null,
      correctPicks: Number(row.correctPicks ?? 0),
      incorrectPicks: Number(row.incorrectPicks ?? 0),
      isComplete: Boolean(row.isComplete),
      isLocked: Boolean(row.isLocked),
      groupPicks,
      knockoutPicks,
    }
  } catch {
    return null
  }
}

async function fetchRelevantMatches(challengeId: string): Promise<ChimmyMatchSummary[]> {
  try {
    const now = new Date()
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000)

    const rows = await (prisma as any).worldCupBracketMatch.findMany({
      where: {
        challengeId,
        OR: [
          { status: { in: ["live", "halftime"] } },
          { status: "scheduled", startsAt: { gte: now, lte: in48h } },
          { status: { in: ["final", "cancelled", "postponed"] }, startsAt: { gte: yesterday } },
        ],
      },
      select: {
        id: true,
        round: true,
        homeTeamName: true,
        awayTeamName: true,
        homeScore: true,
        awayScore: true,
        homePenaltyScore: true,
        awayPenaltyScore: true,
        winnerTeamName: true,
        status: true,
        elapsedMinute: true,
        injuryTime: true,
        startsAt: true,
        venueName: true,
        venueCity: true,
        apiStatusShort: true,
        lastScoreSyncedAt: true,
      },
      orderBy: { startsAt: "asc" },
      take: 20,
    })

    return (rows as any[]).map((r): ChimmyMatchSummary => ({
      matchId: String(r.id),
      round: String(r.round ?? "unknown"),
      homeTeamName: String(r.homeTeamName ?? "?"),
      awayTeamName: String(r.awayTeamName ?? "?"),
      homeScore: typeof r.homeScore === "number" ? r.homeScore : null,
      awayScore: typeof r.awayScore === "number" ? r.awayScore : null,
      homePenaltyScore: typeof r.homePenaltyScore === "number" ? r.homePenaltyScore : null,
      awayPenaltyScore: typeof r.awayPenaltyScore === "number" ? r.awayPenaltyScore : null,
      winnerTeamName: typeof r.winnerTeamName === "string" ? r.winnerTeamName : null,
      status: String(r.status ?? "scheduled"),
      minute: typeof r.elapsedMinute === "number" ? r.elapsedMinute : null,
      injuryTime: typeof r.injuryTime === "number" ? r.injuryTime : null,
      startsAt:
        r.startsAt instanceof Date
          ? r.startsAt.toISOString()
          : typeof r.startsAt === "string"
          ? r.startsAt
          : null,
      venueName: typeof r.venueName === "string" ? r.venueName : null,
      venueCity: typeof r.venueCity === "string" ? r.venueCity : null,
      apiStatusShort: typeof r.apiStatusShort === "string" ? r.apiStatusShort : null,
      lastSyncedAt:
        r.lastScoreSyncedAt instanceof Date
          ? r.lastScoreSyncedAt.toISOString()
          : typeof r.lastScoreSyncedAt === "string"
          ? r.lastScoreSyncedAt
          : null,
    }))
  } catch {
    return []
  }
}

async function fetchGroupStandings(): Promise<ChimmyGroupStandingRow[]> {
  try {
    const rows = await (prisma as any).worldCupOfficialGroupStanding.findMany({
      where: { seasonYear: 2026 },
      select: {
        groupName: true,
        teamName: true,
        actualRank: true,
        played: true,
        wins: true,
        draws: true,
        losses: true,
        points: true,
        goalDifference: true,
        isThirdPlaceAdvancer: true,
      },
      orderBy: [{ groupName: "asc" }, { actualRank: "asc" }],
    })
    return (rows as any[]).map((r): ChimmyGroupStandingRow => ({
      groupName: String(r.groupName ?? "?"),
      teamName: String(r.teamName ?? "?"),
      rank: typeof r.actualRank === "number" ? r.actualRank : null,
      played: Number(r.played ?? 0),
      wins: Number(r.wins ?? 0),
      draws: Number(r.draws ?? 0),
      losses: Number(r.losses ?? 0),
      points: Number(r.points ?? 0),
      goalDifference: Number(r.goalDifference ?? 0),
      isThirdPlaceAdvancer: Boolean(r.isThirdPlaceAdvancer),
    }))
  } catch {
    return []
  }
}

function emptyContext(
  challengeId: string,
  fetchedAt: string,
  locale?: string | null
): WorldCupChimmyContext {
  return {
    challengeId,
    poolName: "World Cup Pool",
    isLocked: false,
    lockReason: null,
    participantCount: 0,
    scoring: { ...DEFAULT_WORLD_CUP_SCORING },
    entry: null,
    liveMatches: [],
    upcomingMatches: [],
    recentMatches: [],
    groupStandings: [],
    liveDataStatus: "unavailable",
    lastSyncedAt: null,
    locale: locale ?? null,
    fetchedAt,
  }
}

// ── Public builder ────────────────────────────────────────────────────────────

/**
 * Builds a rich context object for Chimmy AI replies.
 * Reads from the app DB (already synced from live providers) — no external calls.
 * All errors are swallowed with safe fallbacks so a DB hiccup never blocks chat.
 */
export async function buildWorldCupChimmyContext({
  challengeId,
  userId,
  locale,
}: {
  challengeId: string
  userId: string
  locale?: string | null
}): Promise<WorldCupChimmyContext> {
  const fetchedAt = new Date().toISOString()

  const [challengeSummary, entry, matches, groupStandings] = await Promise.all([
    fetchChallengeSummary(challengeId),
    fetchUserEntry(challengeId, userId),
    fetchRelevantMatches(challengeId),
    fetchGroupStandings(),
  ])

  if (!challengeSummary) {
    return emptyContext(challengeId, fetchedAt, locale)
  }

  const now = new Date()
  const liveMatches = matches.filter((m) => ["live", "halftime"].includes(m.status))
  const upcomingMatches = matches
    .filter((m) => m.status === "scheduled" && m.startsAt != null && new Date(m.startsAt) > now)
    .slice(0, 10)
  const recentMatches = matches
    .filter((m) => ["final", "cancelled", "postponed"].includes(m.status))
    .slice(0, 5)

  const liveDataStatus: ChimmyLiveDataStatus =
    liveMatches.length > 0 ? "live" : matches.length > 0 ? "fixture_only" : "unavailable"

  const lastSyncedAt =
    matches
      .map((m) => m.lastSyncedAt)
      .filter((v): v is string => v !== null)
      .sort()
      .at(-1) ?? null

  return {
    challengeId,
    poolName: challengeSummary.name,
    isLocked: challengeSummary.isLocked,
    lockReason: challengeSummary.lockReason,
    participantCount: challengeSummary.participantCount,
    scoring: challengeSummary.scoring,
    entry,
    liveMatches,
    upcomingMatches,
    recentMatches,
    groupStandings,
    liveDataStatus,
    lastSyncedAt,
    locale: locale ?? null,
    fetchedAt,
  }
}
