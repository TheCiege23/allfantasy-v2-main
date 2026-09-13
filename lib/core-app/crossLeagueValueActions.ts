import 'server-only'

import { prisma } from '@/lib/prisma'
import { myRosterCandidates, rosterPlayerIds } from '@/lib/core-app/myRoster'
import { translateRostersByLeague } from '@/lib/core-app/rosterIdSpace'
import { resolveSleeperRosterPlayers } from '@/lib/player-identity/resolveSleeperRosterPlayers'
import { resolvePlayerStock, type StockDirection } from '@/lib/trade-intel/playerStock'

export type CrossLeagueValueAction = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
  stock: Exclude<StockDirection, 'flat'>
  stockDelta: number
  value: number
  advice: string
  affectedLeagues: Array<{ id: string; name: string }>
}

export function adviceForValueMove(direction: 'up' | 'down', leagueCount: number): string {
  const scope = leagueCount === 1 ? 'this roster' : `${leagueCount} of your rosters`
  return direction === 'up'
    ? `Hold, or investigate a sell-high offer; the move affects ${scope}.`
    : `Check the cause before selling, and consider a buy-low window; the move affects ${scope}.`
}

/**
 * Portfolio-wide player value moves for the rosters the signed-in manager owns.
 *
 * The trade page used to derive this from the selected league's client response,
 * which made the same player look actionable in one league and invisible in the
 * other leagues where the manager also rostered him. This resolves ownership once,
 * translates ESPN ids to the Sleeper ids used by the value history, and groups the
 * result before it reaches the browser.
 */
export async function getCrossLeagueValueActions(
  userId: string,
  leagues: Array<{ id: string; name: string; platform?: string | null; sport?: string | null }>,
  limit = 10,
): Promise<CrossLeagueValueAction[]> {
  const nflLeagues = leagues.filter((league) => String(league.sport ?? 'NFL').toUpperCase() === 'NFL')
  if (nflLeagues.length === 0) return []

  const leagueIds = nflLeagues.map((league) => league.id)
  const leagueById = new Map(nflLeagues.map((league) => [league.id, league]))
  const platformByLeague = new Map(nflLeagues.map((league) => [league.id, league.platform ?? null]))

  const teams = await prisma.leagueTeam.findMany({
    where: { claimedByUserId: userId, leagueId: { in: leagueIds } },
    select: { leagueId: true, platformUserId: true, externalId: true },
  }).catch(() => [])
  if (teams.length === 0) return []

  const candidatesByLeague = new Map<string, Set<string>>()
  for (const team of teams) {
    candidatesByLeague.set(team.leagueId, new Set(myRosterCandidates(team, userId)))
  }
  const candidates = [...new Set([...candidatesByLeague.values()].flatMap((values) => [...values]))]
  if (candidates.length === 0) return []

  const rawRosters = await prisma.roster.findMany({
    where: { leagueId: { in: leagueIds }, platformUserId: { in: candidates } },
    select: { leagueId: true, platformUserId: true, playerData: true },
  }).catch(() => [])
  const owned = rawRosters.filter((roster) => candidatesByLeague.get(roster.leagueId)?.has(roster.platformUserId))
  const rosters = await translateRostersByLeague(owned, platformByLeague)

  const leaguesByPlayer = new Map<string, Map<string, string>>()
  for (const roster of rosters) {
    const league = leagueById.get(roster.leagueId)
    if (!league) continue
    for (const playerId of rosterPlayerIds(roster.playerData)) {
      const held = leaguesByPlayer.get(playerId) ?? new Map<string, string>()
      held.set(league.id, league.name)
      leaguesByPlayer.set(playerId, held)
    }
  }
  const playerIds = [...leaguesByPlayer.keys()]
  if (playerIds.length === 0) return []

  const [players, stocks] = await Promise.all([
    resolveSleeperRosterPlayers(playerIds, 'NFL').catch(() => new Map()),
    resolvePlayerStock(playerIds, { format: 'DYNASTY', qbFormat: 'ONE_QB' }).catch(() => new Map()),
  ])

  return playerIds
    .flatMap((playerId): CrossLeagueValueAction[] => {
      const player = players.get(playerId)
      const stock = stocks.get(playerId)
      if (!player || !stock || stock.direction === 'flat') return []
      const affectedLeagues = [...(leaguesByPlayer.get(playerId) ?? new Map()).entries()].map(([id, name]) => ({ id, name }))
      return [{
        playerId,
        name: player.name,
        position: player.position,
        team: player.team,
        imageUrl: player.imageUrl,
        stock: stock.direction,
        stockDelta: stock.trend30d,
        value: stock.value,
        advice: adviceForValueMove(stock.direction, affectedLeagues.length),
        affectedLeagues,
      }]
    })
    .sort((a, b) => Math.abs(b.stockDelta) - Math.abs(a.stockDelta))
    .slice(0, Math.max(1, limit))
}
