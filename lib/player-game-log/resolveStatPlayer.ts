import 'server-only'

import { prisma } from '@/lib/prisma'
import { identityMapSleeperWhere } from '@/lib/player-identity/identityMapSleeperColumn'

/**
 * `PlayerIdentityMap.id` for a player named by ONE stable key — never by a name. Shared by
 * /api/players/game-log and /api/players/window-ranks so both find the same man:
 *   - `identityId` — the id itself (checked against the sport);
 *   - `externalId` + `source=rolling_insights` — the card's `SportsPlayer` key, which for the daily
 *     sports IS `PlayerIdentityMap.rollingInsightsId`. Any other source is refused: an id names a
 *     player only together with its feed (SOCCER `1100` is two different men);
 *   - `sleeperId` — through the sport's own Sleeper column (`identityMapSleeperWhere`).
 */
export async function resolveStatPlayerId(sport: string, params: URLSearchParams): Promise<string | null> {
  const identityId = params.get('identityId')?.trim() || null
  const externalId = params.get('externalId')?.trim() || null
  const source = params.get('source')?.trim().toLowerCase() || null
  const sleeperId = params.get('sleeperId')?.trim() || null

  let resolvedId: string | null = null
  if (identityId) {
    const row = await prisma.playerIdentityMap.findFirst({ where: { id: identityId, sport }, select: { id: true } })
    resolvedId = row?.id ?? null
  } else if (externalId && source === 'rolling_insights') {
    const row = await prisma.playerIdentityMap.findFirst({
      where: { sport, rollingInsightsId: externalId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    })
    resolvedId = row?.id ?? null
  }
  if (!resolvedId && sleeperId) {
    const where = identityMapSleeperWhere([sleeperId], sport)
    const row = where ? await prisma.playerIdentityMap.findFirst({ where, select: { id: true } }) : null
    resolvedId = row?.id ?? null
  }
  return resolvedId
}
