import 'server-only'

import { prisma } from '@/lib/prisma'
import { dailyTeamCode } from '@/lib/core-app/dailyNextGames'
import { readWeekGames } from '@/lib/redraft/weekGames'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { projectGoalieStarts, type GoalieLine, type GoalieStartProjection, type UpcomingGame } from './goalieStarts'

/**
 * Projected starting goalies for the next few days of NHL games, from Postgres only (DB-first: no
 * provider call on a request path). Model and its limits: goalieStarts.ts.
 *
 *   goalie lines   player_game_stats, NHL, the `:goalies` box group (rollingInsightsGameLogs.ts),
 *                  the last ~6 weeks — enough for a 10-game window with gaps
 *   schedule       readWeekGames over an Eastern-day window: the ranked, freshest-feed slate the
 *                  lineup lock reads, so a game the lock knows about is the game projected here
 *   names          PlayerIdentityMap.canonicalName
 */

const DAY_MS = 86_400_000
const LOOKBACK_DAYS = 45

/** NHL seasons are keyed by the year they start (rollingInsightsGameLogs `fallbackSeason`). */
function nhlSeason(now: Date): number {
  return now.getUTCMonth() + 1 >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
}

/** Ice time in minutes; the vendor prints "0" for some goalies who played, so shots faced stand in. */
function iceTime(map: unknown): number {
  const m = map && typeof map === 'object' ? (map as Record<string, unknown>) : {}
  const s = m.stats && typeof m.stats === 'object' ? (m.stats as Record<string, unknown>) : {}
  const minutes = typeof s.time_on_ice_minutes === 'number' ? s.time_on_ice_minutes : 0
  if (minutes > 0) return minutes
  const shots = typeof s.shots_against === 'number' ? s.shots_against : 0
  return shots > 0 ? Math.min(60, shots * 2) : 0
}

export async function loadGoalieStarts(opts: { now?: Date; days?: number } = {}): Promise<{
  generatedAt: string
  projections: GoalieStartProjection[]
}> {
  const now = opts.now ?? new Date()
  const season = nhlSeason(now)
  const today = easternCalendarDay(now)
  if (!today) return { generatedAt: now.toISOString(), projections: [] }
  const days = Math.max(1, Math.min(7, opts.days ?? 3))
  const window = { start: today, end: new Date(today.getTime() + days * DAY_MS) }

  const [rows, schedule] = await Promise.all([
    prisma.playerGameStat.findMany({
      where: {
        sportType: 'NHL',
        season,
        gameId: { endsWith: ':goalies' },
        gameDate: { gte: new Date(today.getTime() - LOOKBACK_DAYS * DAY_MS) },
      },
      select: { playerId: true, team: true, gameDate: true, normalizedStatMap: true },
    }),
    readWeekGames(prisma, { sport: 'NHL', season, week: 1, seasonType: 'regular', dateWindow: window, now }),
  ])

  const ids = [...new Set(rows.map((r) => r.playerId))]
  const names = new Map(
    (ids.length
      ? await prisma.playerIdentityMap.findMany({ where: { id: { in: ids } }, select: { id: true, canonicalName: true } })
      : []
    ).map((p) => [p.id, p.canonicalName]),
  )

  const lines: GoalieLine[] = []
  for (const r of rows) {
    const team = dailyTeamCode('NHL', r.team)
    const name = names.get(r.playerId)
    if (!team || !name || !r.gameDate) continue
    lines.push({ playerId: r.playerId, name, team, day: r.gameDate.toISOString().slice(0, 10), toi: iceTime(r.normalizedStatMap) })
  }

  const upcoming: UpcomingGame[] = []
  const seen = new Set<string>()
  for (const g of schedule) {
    if (/postpon|cancel|suspend|replaced|abandon/i.test(String(g.status ?? ''))) continue
    const day = easternCalendarDay(g.startTime)?.toISOString().slice(0, 10)
    const home = dailyTeamCode('NHL', g.homeTeam)
    const away = dailyTeamCode('NHL', g.awayTeam)
    if (!day || !home || !away || seen.has(`${day}|${home}|${away}`)) continue
    seen.add(`${day}|${home}|${away}`)
    upcoming.push({ day, team: home, opponent: away, home: true }, { day, team: away, opponent: home, home: false })
  }

  return { generatedAt: now.toISOString(), projections: projectGoalieStarts({ lines, upcoming }) }
}
