import 'server-only'
import { prisma } from '@/lib/prisma'
import { canonicalName } from '@/lib/draft-room/player-canonical-identity'

/** A follow-up draft can award only players who are not already on a current roster. */
export async function loadRookieAuctionAvailability(leagueId: string) {
  const season = await prisma.redraftSeason.findFirst({ where: { leagueId }, orderBy: { createdAt: 'desc' }, select: { id: true } })
  if (!season) throw new Error('Current league rosters are unavailable. Try again before nominating a player.')
  const rostered = await prisma.redraftRosterPlayer.findMany({
    where: { droppedAt: null, roster: { leagueId, seasonId: season.id } },
    select: { playerId: true, playerName: true },
  })
  const ids = new Set(rostered.map(row => String(row.playerId ?? '').trim()).filter(Boolean))
  const names = new Set(rostered.map(row => canonicalName(row.playerName ?? '')).filter(Boolean))
  return ({ playerId, playerName }: { playerId?: string | null; playerName: string }) =>
    !(playerId && ids.has(playerId.trim())) && !names.has(canonicalName(playerName))
}
