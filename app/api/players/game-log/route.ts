import { NextResponse } from 'next/server'
import { resolveStatPlayerId } from '@/lib/player-game-log/resolveStatPlayer'
import { resolveStatScoring } from '@/lib/player-game-log/statScoring'
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
 * Each game carries `fantasyPoints`. With `leagueId` (a league the signed-in user is a member of, in
 * this sport) it is scored on THAT league's settings — the scorer the weekly matchup engine uses on
 * the same line; otherwise on the sport's default scoring. `scoring` says which, so the screen never
 * shows default points labelled as the league's. `position` is the player's, for position-weighted
 * scoring (soccer).
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

  const seasonParam = Number(url.searchParams.get('season'))
  const season = Number.isInteger(seasonParam) && seasonParam > 1900 ? seasonParam : null

  try {
    const resolvedId = await resolveStatPlayerId(sport, url.searchParams)
    if (!resolvedId) {
      return NextResponse.json({ supported: true, sport, resolved: false, season: null, seasons: [], groups: [] })
    }

    const leagueId = url.searchParams.get('leagueId')?.trim() || null
    const position = url.searchParams.get('position')?.trim().slice(0, 12) || null
    const scoring = await resolveStatScoring(sport, leagueId)
    const log = await loadPlayerGameLog({ identityId: resolvedId, sport, season, scorer: scoring.scorer, position })
    return NextResponse.json(
      { supported: true, resolved: true, ...log, scoring: scoring.info },
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    )
  } catch (e) {
    console.error('[players/game-log]', e instanceof Error ? e.message : 'unknown error')
    return NextResponse.json({ error: 'Game log unavailable' }, { status: 500 })
  }
}

