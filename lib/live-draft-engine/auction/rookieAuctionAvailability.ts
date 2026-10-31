import 'server-only'
import { prisma } from '@/lib/prisma'
import { canonicalName } from '@/lib/draft-room/player-canonical-identity'

/** A follow-up draft can award only players who are not already on a current roster. */
export async function loadRookieAuctionAvailability(leagueId: string) {
  const season = await prisma.redraftSeason.findFirst({ where: { leagueId }, orderBy: { createdAt: 'desc' }, select: { id: true } })
  if (!season) throw new Error('Current league rosters are unavailable. Try again before nominating a player.')
  const [rostered, rights, c2cPlayers] = await Promise.all([
    prisma.redraftRosterPlayer.findMany({
      where: { droppedAt: null, roster: { leagueId, seasonId: season.id } },
      select: { playerId: true, playerName: true },
    }),
    prisma.devyRights.findMany({ where: { leagueId, state: { not: 'RIGHTS_EXPIRED' } }, select: { devyPlayerId: true, promotedProPlayerId: true } }),
    prisma.c2CPlayerState.findMany({ where: { leagueId }, select: { playerId: true, playerName: true } }),
  ])
  const rightIds = [...new Set(rights.map(row => row.devyPlayerId))]
  const devyPlayers = rightIds.length ? await prisma.devyPlayer.findMany({ where: { id: { in: rightIds } }, select: { id: true, name: true } }) : []
  const knownDevyIds = new Set(devyPlayers.map(row => row.id))
  if (rights.some(row => !row.promotedProPlayerId && !knownDevyIds.has(row.devyPlayerId))) {
    throw new Error('Some retained college rights have no player identity. Resolve them before this rookie auction.')
  }
  const ids = new Set([...rostered.map(row => row.playerId), ...c2cPlayers.map(row => row.playerId), ...rights.flatMap(row => [row.devyPlayerId, row.promotedProPlayerId])].map(id => String(id ?? '').trim()).filter(Boolean))
  const names = new Set([...rostered.map(row => row.playerName), ...c2cPlayers.map(row => row.playerName), ...devyPlayers.map(row => row.name)].map(name => canonicalName(name ?? '')).filter(Boolean))
  return ({ playerId, playerName }: { playerId?: string | null; playerName: string }) =>
    !(playerId && ids.has(String(playerId).trim())) && !names.has(canonicalName(playerName))
}
