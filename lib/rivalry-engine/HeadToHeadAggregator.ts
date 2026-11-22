/**
 * HeadToHeadAggregator — aggregates head-to-head matchup history for rivalry scoring.
 * Uses warehouse MatchupFact or WeeklyMatchup and league teams to build H2H + close games + upset flags.
 */

import { prisma } from '@/lib/prisma'

interface HeadToHeadMatchup {
  season: number
  weekOrPeriod: number
  teamAId: string
  teamBId: string
  scoreA: number
  scoreB: number
  winnerTeamId: string | null
}

interface HeadToHeadSummary {
  managerAId: string
  managerBId: string
  totalMatchups: number
  winsA: number
  winsB: number
  closeGameCount: number
  upsetWins: number
  matchups: HeadToHeadMatchup[]
}

const CLOSE_GAME_MARGIN = 15

/**
 * Canonical pair key (lower id first) for consistent grouping.
 */
function pairKey(id1: string, id2: string): string {
  return id1 < id2 ? `${id1}|${id2}` : `${id2}|${id1}`
}

/**
 * Aggregate head-to-head from MatchupFact for a league/season.
 * Returns one summary per manager pair (managerAId/managerBId as team externalId or owner id).
 */
export async function aggregateHeadToHeadForLeague(
  leagueId: string,
  season: number,
  options?: { useTeamIds?: boolean }
): Promise<HeadToHeadSummary[]> {
  const facts = await prisma.matchupFact.findMany({
    where: { leagueId, season },
    orderBy: [{ weekOrPeriod: 'asc' }],
  })
  const seasonResults = await prisma.seasonResult.findMany({
    where: { leagueId, season: String(season) },
    select: { rosterId: true, wins: true },
  })

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { teams: true },
  })
  if (!league?.teams?.length) return []

  const teamByExternalId = new Map<string, { id: string; externalId: string; ownerName: string }>()
  for (const t of league.teams) {
    teamByExternalId.set(t.externalId, t)
    teamByExternalId.set(t.id, t)
  }
  const seasonWinsByRosterId = new Map<string, number>()
  for (const row of seasonResults) {
    seasonWinsByRosterId.set(String(row.rosterId), row.wins ?? 0)
  }

  const byPair = new Map<
    string,
    { managerAId: string; managerBId: string; matchups: HeadToHeadMatchup[] }
  >()

  for (const f of facts) {
    const teamARec = teamByExternalId.get(f.teamA)
    const teamBRec = teamByExternalId.get(f.teamB)
    const idA = teamARec?.externalId ?? f.teamA
    const idB = teamBRec?.externalId ?? f.teamB
    const managerAId = options?.useTeamIds ? idA : (teamARec?.ownerName ?? idA)
    const managerBId = options?.useTeamIds ? idB : (teamBRec?.ownerName ?? idB)
    const key = pairKey(managerAId, managerBId)
    if (!byPair.has(key)) {
      byPair.set(key, {
        managerAId: managerAId < managerBId ? managerAId : managerBId,
        managerBId: managerAId < managerBId ? managerBId : managerAId,
        matchups: [],
      })
    }
    const entry = byPair.get(key)!
    const scoreA = f.scoreA ?? 0
    const scoreB = f.scoreB ?? 0
    entry.matchups.push({
      season: f.season ?? season,
      weekOrPeriod: f.weekOrPeriod,
      teamAId: f.teamA,
      teamBId: f.teamB,
      scoreA,
      scoreB,
      winnerTeamId: f.winnerTeamId ?? null,
    })
  }

  const summaries: HeadToHeadSummary[] = []
  for (const [, entry] of byPair) {
    let winsA = 0
    let winsB = 0
    let closeCount = 0
    let upsetCount = 0
    for (const m of entry.matchups) {
      const margin = Math.abs(m.scoreA - m.scoreB)
      if (margin < CLOSE_GAME_MARGIN) closeCount++
      if (m.winnerTeamId) {
        const winnerIsA = m.winnerTeamId === m.teamAId
        if (winnerIsA) winsA++
        else winsB++
        const winnerRoster = winnerIsA ? m.teamAId : m.teamBId
        const loserRoster = winnerIsA ? m.teamBId : m.teamAId
        const winnerSeasonWins = seasonWinsByRosterId.get(winnerRoster) ?? 0
        const loserSeasonWins = seasonWinsByRosterId.get(loserRoster) ?? 0
        // Upset: lower season-win roster beats higher season-win roster.
        if (winnerSeasonWins < loserSeasonWins) upsetCount++
      }
    }
    summaries.push({
      managerAId: entry.managerAId,
      managerBId: entry.managerBId,
      totalMatchups: entry.matchups.length,
      winsA,
      winsB,
      closeGameCount: closeCount,
      upsetWins: upsetCount,
      matchups: entry.matchups,
    })
  }
  return summaries
}
