import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport, isSupportedSport } from '@/lib/sport-scope'

export const dynamic = 'force-dynamic'

/**
 * GET /api/players/season-stats?name=&sport=
 *
 * Real per-player season box-score totals from `player_season_stats`
 * (source: rolling_insights) -- the same table + name-matching pattern
 * `lib/player-comparison-lab/PlayerStatsResolver.ts`'s `resolveHistorical`
 * already relies on for the Trade/Draft tools. Matched by player name (not
 * id) because that table's `playerId` is in the rolling_insights source's
 * own namespace, unrelated to `SportsPlayer.id` -- name-match is the
 * established real lookup path, not a new invented one.
 *
 * Extends that existing mapping with touchdowns/targets (confirmed real
 * keys in the stored `stats` JSON: targets, receptions, rushing_yards,
 * receiving_yards, rushing_touchdowns, receiving_touchdowns,
 * passing_yards, passing_touchdowns, interceptions) so a real Rec/Yds/
 * TD/Tgt/PPG grid can be shown without fabricating numbers.
 */

type StatsJson = Record<string, number | null | undefined>

function num(stats: StatsJson, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = stats[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const name = url.searchParams.get('name')?.trim()
  const sportRaw = url.searchParams.get('sport')?.trim() || 'NFL'

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!isSupportedSport(sportRaw)) {
    return NextResponse.json({ error: 'Invalid sport' }, { status: 400 })
  }
  const sport = normalizeToSupportedSport(sportRaw)

  try {
    const rows = await prisma.playerSeasonStats.findMany({
      where: { sport, playerName: { equals: name, mode: 'insensitive' }, source: 'rolling_insights' },
      orderBy: { season: 'desc' },
      take: 5,
      select: { season: true, position: true, team: true, gamesPlayed: true, fantasyPoints: true, fantasyPointsPerGame: true, stats: true },
    })

    const seasons = rows.map((row) => {
      const stats = (row.stats as StatsJson) ?? {}
      return {
        season: row.season,
        position: row.position,
        team: row.team,
        gamesPlayed: row.gamesPlayed,
        fantasyPoints: row.fantasyPoints,
        fantasyPointsPerGame: row.fantasyPointsPerGame,
        receptions: num(stats, 'receptions'),
        targets: num(stats, 'targets'),
        receivingYards: num(stats, 'receiving_yards', 'receivingYards'),
        receivingTouchdowns: num(stats, 'receiving_touchdowns', 'receivingTouchdowns'),
        rushingYards: num(stats, 'rushing_yards', 'rushingYards'),
        rushingAttempts: num(stats, 'rushing_attempts', 'rushingAttempts'),
        rushingTouchdowns: num(stats, 'rushing_touchdowns', 'rushingTouchdowns'),
        passingYards: num(stats, 'passing_yards', 'passingYards'),
        passingTouchdowns: num(stats, 'passing_touchdowns', 'passingTouchdowns'),
        interceptions: num(stats, 'interceptions'),
      }
    })

    return NextResponse.json({ name, sport, seasons })
  } catch (error) {
    console.error('[players/season-stats]', error)
    return NextResponse.json({ error: 'Failed to load season stats' }, { status: 500 })
  }
}
