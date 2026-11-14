import { prisma } from "@/lib/prisma"
import { getCachedLiveScoresForSport, type LiveScoreRow } from "@/lib/sports-live-scores-service"
import { bracketSportToLeagueSport } from "@/lib/brackets/espn-playoff-sync"
import { fetchTeamNewsForBracket, type BracketTeamNewsLine } from "@/lib/brackets/bracket-team-news"
import { normalizeTeamAbbrev } from "@/lib/team-abbrev"

type BracketNodeWithGame = {
  id: string
  slot: string
  round: number
  region: string | null
  seedHome: number | null
  seedAway: number | null
  homeTeamName: string | null
  awayTeamName: string | null
  sportsGameId: string | null
  nextNodeId: string | null
  nextNodeSide: string | null
  game: {
    id: string
    homeTeam: string
    awayTeam: string
    homeScore: number | null
    awayScore: number | null
    status: string | null
    startTime: string | null
    homeRecord?: string | null
    awayRecord?: string | null
    statusDetail?: string | null
  } | null
}

function normAbbr(s: string | null | undefined): string {
  return (normalizeTeamAbbrev(String(s ?? "").trim()) || String(s ?? "").trim()).toUpperCase()
}

function enrichGameFromLive(
  base: NonNullable<BracketNodeWithGame["game"]>,
  liveRows: LiveScoreRow[],
  homeTeamName: string | null,
  awayTeamName: string | null,
): BracketNodeWithGame["game"] {
  const row = liveRows.find((r) => {
    const h = normAbbr(r.homeTeam)
    const a = normAbbr(r.awayTeam)
    const hn = normAbbr(homeTeamName || base.homeTeam)
    const an = normAbbr(awayTeamName || base.awayTeam)
    return (h === hn && a === an) || (h === an && a === hn)
  })
  if (!row) {
    return { ...base, homeRecord: null, awayRecord: null }
  }
  const homeFirst = normAbbr(row.homeTeam) === normAbbr(homeTeamName || base.homeTeam)
  return {
    ...base,
    homeRecord: homeFirst ? row.homeRecord : row.awayRecord,
    awayRecord: homeFirst ? row.awayRecord : row.homeRecord,
    statusDetail: row.statusDetail,
    startTime: base.startTime || row.startTime,
  }
}

export async function getEntryBracketData(tournamentId: string, entryId: string) {
  const tournament = await prisma.bracketTournament.findUnique({
    where: { id: tournamentId },
    select: { sport: true },
  })

  let liveRows: LiveScoreRow[] = []
  try {
    const leagueSport = bracketSportToLeagueSport(tournament?.sport ?? "NFL")
    const live = await getCachedLiveScoresForSport({ sport: leagueSport })
    liveRows = live.scores
  } catch {
    liveRows = []
  }

  const nodes = await prisma.bracketNode.findMany({
    where: { tournamentId },
    orderBy: [{ round: "asc" }, { region: "asc" }, { slot: "asc" }],
  })

  const gameIds = nodes.map((n) => n.sportsGameId).filter(Boolean) as string[]
  const games =
    gameIds.length > 0
      ? await prisma.sportsGame.findMany({
          where: { id: { in: gameIds } },
          select: {
            id: true,
            homeTeam: true,
            awayTeam: true,
            homeScore: true,
            awayScore: true,
            status: true,
            startTime: true,
          },
        })
      : []
  const gameById = Object.fromEntries(games.map((g) => [g.id, g]))

  const picks = await prisma.bracketPick.findMany({
    where: { entryId },
    select: { nodeId: true, pickedTeamName: true },
  })

  const pickMap: Record<string, string | null> = {}
  for (const p of picks) pickMap[p.nodeId] = p.pickedTeamName ?? null

  const nodesWithGame: BracketNodeWithGame[] = nodes.map((n) => {
    const raw =
      n.sportsGameId && gameById[n.sportsGameId]
        ? {
            ...gameById[n.sportsGameId],
            startTime: gameById[n.sportsGameId].startTime?.toISOString() ?? null,
          }
        : null
    const game = raw
      ? enrichGameFromLive(raw as NonNullable<BracketNodeWithGame["game"]>, liveRows, n.homeTeamName, n.awayTeamName)
      : null
    return {
      id: n.id,
      slot: n.slot,
      round: n.round,
      region: n.region,
      seedHome: n.seedHome,
      seedAway: n.seedAway,
      homeTeamName: n.homeTeamName,
      awayTeamName: n.awayTeamName,
      sportsGameId: n.sportsGameId,
      nextNodeId: n.nextNodeId,
      nextNodeSide: n.nextNodeSide,
      game,
    }
  })

  const teamAbbrevs = Array.from(
    new Set(
      nodes.flatMap((n) => [n.homeTeamName, n.awayTeamName].filter(Boolean) as string[]),
    ),
  )
  let teamNews: Record<string, BracketTeamNewsLine> = {}
  try {
    teamNews = await fetchTeamNewsForBracket({
      sportRaw: tournament?.sport ?? "NFL",
      teamAbbrevs,
    })
  } catch {
    teamNews = {}
  }

  return { nodesWithGame, pickMap, teamNews }
}
