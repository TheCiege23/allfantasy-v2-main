import { NextResponse } from 'next/server'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { isGameLogSport } from '@/lib/player-game-log/gameLogColumns'
import { resolveStatPlayerId } from '@/lib/player-game-log/resolveStatPlayer'
import { resolveStatScoring } from '@/lib/player-game-log/statScoring'
import { latestStatSeason, loadWindowRanks } from '@/lib/player-rank/loadWindowRanks'
import { playerWindowRanks } from '@/lib/player-rank/windowRanks'

export const dynamic = 'force-dynamic'

/**
 * GET /api/players/window-ranks?sport=NHL&(identityId=… | externalId=…&source=rolling_insights | sleeperId=…)[&leagueId=…&position=…]
 *
 * A player's fantasy-point rank over the last 7 / 14 / 30 days and the season, overall and at his
 * position, DB-only (`lib/player-rank/loadWindowRanks.ts`). With `leagueId` (members only, same
 * sport) on that league's scoring, otherwise the sport's defaults — `scoring` says which. The
 * player is named exactly as /api/players/game-log names him (`resolveStatPlayerId`).
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const sport = normalizeToSupportedSport(url.searchParams.get('sport'))
  if (!isGameLogSport(sport)) return NextResponse.json({ supported: false, sport })

  try {
    const playerId = await resolveStatPlayerId(sport, url.searchParams)
    if (!playerId) return NextResponse.json({ supported: true, sport, resolved: false })
    const season = await latestStatSeason(sport)
    if (season == null) return NextResponse.json({ supported: true, sport, resolved: true, ranks: null })

    const scoring = await resolveStatScoring(sport, url.searchParams.get('leagueId')?.trim() || null)
    if (!scoring.scorer) return NextResponse.json({ supported: true, sport, resolved: true, ranks: null })
    const table = await loadWindowRanks({ sport, season, scoringKey: scoring.key, scorer: scoring.scorer })
    if (!table) return NextResponse.json({ supported: true, sport, resolved: true, ranks: null })

    return NextResponse.json(
      { supported: true, sport, resolved: true, season, asOf: table.asOf, scoring: scoring.info, ranks: playerWindowRanks(table, playerId) },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    )
  } catch (e) {
    console.error('[players/window-ranks]', e instanceof Error ? e.message : 'unknown error')
    return NextResponse.json({ error: 'Ranks unavailable' }, { status: 500 })
  }
}
