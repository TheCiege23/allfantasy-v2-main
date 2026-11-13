import "server-only"
import { prisma } from "@/lib/prisma"

// ── Types ─────────────────────────────────────────────────────────────────────

type TeamFormResult = {
  opponent: string
  result: "W" | "D" | "L"
  score: string
  round: string | null
  startsAt: string | null
}

type TeamGroupStanding = {
  groupName: string
  rank: number | null
  played: number
  wins: number
  draws: number
  losses: number
  points: number
  goalDifference: number
  goalsFor: number
  goalsAgainst: number
  isThirdPlaceAdvancer: boolean
}

export type WorldCupTeamIntelligenceReport = {
  teamId: string
  teamName: string
  fifaCode: string | null
  flagUrl: string | null
  logoUrl: string | null
  groupName: string | null
  qualificationStatus: string

  // Opportunistic — extracted from sourcePayload if the provider stored them
  confederation: string | null
  fifaRank: number | null

  // Group stage performance (from WorldCupOfficialGroupStanding)
  groupStanding: TeamGroupStanding | null

  // Derived from completed fixtures (last 5)
  recentForm: TeamFormResult[]
  formSummary: string

  // coach/style/strengths/weaknesses are not stored — always null
  coach: null
  // captain/keyPlayers/injuryNotes loaded from WorldCupPlayer + InjuryReportRecord when synced
  captain: string | null
  keyPlayers: string[] | null
  styleSummary: null
  strengths: null
  weaknesses: null
  injuryNotes: string | null
  suspensionNotes: string | null

  missingData: string[]
  dataSourceLabel: string
  lastUpdatedAt: string | null
}

const FINAL_STATUSES = new Set(["FT", "AET", "PEN", "final"])

// ── Main function ─────────────────────────────────────────────────────────────

export async function getWorldCupTeamIntelligence(
  teamId: string
): Promise<WorldCupTeamIntelligenceReport | null> {
  const [team, standing, fixtures, rosterPlayers] = await Promise.all([
    (prisma as any).worldCupTeam.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        name: true,
        fifaCode: true,
        flagUrl: true,
        logoUrl: true,
        groupName: true,
        qualificationStatus: true,
        sourcePayload: true,
        updatedAt: true,
      },
    }),
    (prisma as any).worldCupOfficialGroupStanding.findFirst({
      where: { teamId },
      orderBy: { updatedAt: "desc" },
      select: {
        groupName: true,
        actualRank: true,
        played: true,
        wins: true,
        draws: true,
        losses: true,
        points: true,
        goalDifference: true,
        goalsFor: true,
        goalsAgainst: true,
        isThirdPlaceAdvancer: true,
        updatedAt: true,
      },
    }),
    (prisma as any).worldCupOfficialFixture.findMany({
      where: {
        OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
        apiStatusShort: { in: ["FT", "AET", "PEN"] },
      },
      orderBy: { startsAt: "desc" },
      take: 5,
      select: {
        homeTeamId: true,
        awayTeamId: true,
        homeTeamName: true,
        awayTeamName: true,
        homeScore: true,
        awayScore: true,
        round: true,
        stage: true,
        startsAt: true,
        winnerTeamId: true,
        apiStatusShort: true,
      },
    }),
    (prisma as any).worldCupPlayer
      .findMany({
        where: { teamId, isActive: true },
        orderBy: [{ isCaptain: "desc" }, { positionCode: "asc" }, { shirtNumber: "asc" }],
        select: { name: true, positionCode: true, shirtNumber: true, isCaptain: true, providerPlayerId: true },
      })
      .catch(() => []) as Promise<any[]>,
  ])

  if (!team) return null

  // Extract confederation / fifaRank from sourcePayload if present
  const payload = (team.sourcePayload ?? {}) as Record<string, unknown>
  const confederation =
    typeof payload.confederation === "string" ? payload.confederation : null
  const fifaRank =
    typeof payload.fifaRank === "number"
      ? payload.fifaRank
      : typeof payload.rank === "number"
        ? payload.rank
        : null

  // Build group standing
  const groupStanding: TeamGroupStanding | null = standing
    ? {
        groupName: String(standing.groupName ?? "?"),
        rank:
          typeof standing.actualRank === "number" ? standing.actualRank : null,
        played: Number(standing.played ?? 0),
        wins: Number(standing.wins ?? 0),
        draws: Number(standing.draws ?? 0),
        losses: Number(standing.losses ?? 0),
        points: Number(standing.points ?? 0),
        goalDifference: Number(standing.goalDifference ?? 0),
        goalsFor: Number(standing.goalsFor ?? 0),
        goalsAgainst: Number(standing.goalsAgainst ?? 0),
        isThirdPlaceAdvancer: Boolean(standing.isThirdPlaceAdvancer),
      }
    : null

  // Build recent form
  const recentForm: TeamFormResult[] = (fixtures as any[]).map((f) => {
    const isHome = f.homeTeamId === teamId
    const opponent = isHome
      ? (f.awayTeamName ?? "Unknown")
      : (f.homeTeamName ?? "Unknown")

    let result: "W" | "D" | "L" = "D"
    if (f.winnerTeamId === teamId) result = "W"
    else if (
      f.winnerTeamId !== null &&
      f.winnerTeamId !== teamId
    )
      result = "L"
    else if (
      f.homeScore != null &&
      f.awayScore != null &&
      f.homeScore === f.awayScore
    )
      result = "D"

    const hs = f.homeScore ?? 0
    const as_ = f.awayScore ?? 0
    const score = isHome ? `${hs}-${as_}` : `${as_}-${hs}`

    return {
      opponent: String(opponent),
      result,
      score,
      round: f.stage ?? f.round ?? null,
      startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : null,
    }
  })

  const formSummary = recentForm.map((r) => r.result).join(" ")

  // ── Roster data ───────────────────────────────────────────────────────────
  const captainPlayer = (rosterPlayers as any[]).find((p) => p.isCaptain)
  const captain: string | null = captainPlayer ? String(captainPlayer.name) : null

  const keyPlayersRaw = (rosterPlayers as any[])
    .filter((p) => !p.isCaptain)
    .slice(0, 8)
    .map((p) => {
      const pos = p.positionCode ? `(${p.positionCode})` : ""
      const num = p.shirtNumber ? `#${p.shirtNumber}` : ""
      return [p.name, pos, num].filter(Boolean).join(" ")
    })
  const keyPlayers: string[] | null = keyPlayersRaw.length > 0 ? keyPlayersRaw : null

  // ── Injury/suspension data from InjuryReportRecord ────────────────────────
  const providerIds = (rosterPlayers as any[]).map((p) => p.providerPlayerId)
  const injuryRows = providerIds.length > 0
    ? await (prisma as any).injuryReportRecord
        .findMany({
          where: { sport: "WC_SOCCER", playerId: { in: providerIds } },
          orderBy: { reportDate: "desc" },
          take: 20,
          select: { playerName: true, status: true },
        })
        .catch(() => []) as any[]
    : []

  const injuredPlayers = (injuryRows as any[]).filter((r) => {
    const s = (r.status ?? "").toLowerCase()
    return !s.includes("suspend") && !s.includes("ban")
  }).map((r) => `${r.playerName} (${r.status})`)

  const suspendedPlayers = (injuryRows as any[]).filter((r) => {
    const s = (r.status ?? "").toLowerCase()
    return s.includes("suspend") || s.includes("ban")
  }).map((r) => `${r.playerName} (${r.status})`)

  const injuryNotes: string | null = injuredPlayers.length > 0 ? injuredPlayers.slice(0, 5).join(", ") : null
  const suspensionNotes: string | null = suspendedPlayers.length > 0 ? suspendedPlayers.slice(0, 3).join(", ") : null

  // ── Build missingData list based on what was actually loaded ──────────────
  const missingData: string[] = ["coach", "style / formation", "strengths & weaknesses"]
  if (!captain) missingData.push("captain")
  if (!keyPlayers) missingData.push("key players")
  if (!injuryNotes && !suspensionNotes) missingData.push("injury / suspension report")

  const lastUpdatedAt =
    standing?.updatedAt
      ? new Date(standing.updatedAt).toISOString()
      : team.updatedAt
        ? new Date(team.updatedAt).toISOString()
        : null

  return {
    teamId: team.id,
    teamName: team.name,
    fifaCode: team.fifaCode ?? null,
    flagUrl: team.flagUrl ?? null,
    logoUrl: team.logoUrl ?? null,
    groupName: team.groupName ?? null,
    qualificationStatus: team.qualificationStatus ?? "tbd",
    confederation,
    fifaRank,
    groupStanding,
    recentForm,
    formSummary,
    coach: null,
    captain,
    keyPlayers,
    styleSummary: null,
    strengths: null,
    weaknesses: null,
    injuryNotes,
    suspensionNotes,
    missingData,
    dataSourceLabel: "Pool DB — group standings and fixture results",
    lastUpdatedAt,
  }
}

