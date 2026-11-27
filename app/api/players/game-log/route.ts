import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { identityMapSleeperWhere } from '@/lib/player-identity/identityMapSleeperColumn'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { isGameLogSport } from '@/lib/player-game-log/gameLogColumns'
import { loadPlayerGameLog } from '@/lib/player-game-log/loadPlayerGameLog'

export const dynamic = 'force-dynamic'

/**
 * GET /api/players/game-log?sport=NHL&(identityId=… | externalId=…&source=rolling_insights | sleeperId=…)[&season=2026]
 *
 * Per-game box lines for one player, DB-only (`lib/player-game-log/loadPlayerGameLog.ts`).
 *
 * The player is named by exactly ONE stable key, never by a name:
 *   - `identityId` — `PlayerIdentityMap.id`, what the player profile page holds;
 *   - `externalId` + `source=rolling_insights` — the player card's `SportsPlayer` key, which for the
 *     daily sports IS `PlayerIdentityMap.rollingInsightsId`. Any other source is refused: an id names
 *     a player only together with its feed (SOCCER `1100` is two different men);
 *   - `sleeperId` — through the sport's own Sleeper column (`identityMapSleeperWhere`).
 *
 * Football is not served here (its per-game history is weekly and lives elsewhere); the response
 * says `supported: false` and the caller keeps its football view.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const sport = normalizeToSupportedSport(url.searchParams.get('sport'))
  if (!isGameLogSport(sport)) {
    return NextResponse.json({ supported: false, sport })
  }

  const identityId = url.searchParams.get('identityId')?.trim() || null
  const externalId = url.searchParams.get('externalId')?.trim() || null
  const source = url.searchParams.get('source')?.trim().toLowerCase() || null
  const sleeperId = url.searchParams.get('sleeperId')?.trim() || null
  const seasonParam = Number(url.searchParams.get('season'))
  const season = Number.isInteger(seasonParam) && seasonParam > 1900 ? seasonParam : null

  try {
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
    if (!resolvedId) {
      return NextResponse.json({ supported: true, sport, resolved: false, season: null, seasons: [], groups: [] })
    }

    const log = await loadPlayerGameLog({ identityId: resolvedId, sport, season })
    return NextResponse.json(
      { supported: true, resolved: true, ...log },
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    )
  } catch (e) {
    console.error('[players/game-log]', e instanceof Error ? e.message : 'unknown error')
    return NextResponse.json({ error: 'Game log unavailable' }, { status: 500 })
  }
}
