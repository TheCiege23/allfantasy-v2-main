import type { PrismaClient } from '@prisma/client'

import { coachTeamKey, coachingLevelOn, isCoachRegistrySport } from './coachRegistry'
import { weatherLevel, type GameContextLevels } from './gameContext'
import { easternDate } from './injurySnapshots'

/**
 * THE GAME'S OWN CONTEXT FOR THE DAILY SPORTS (owner, 2026-11-23: "use the weather api for the weather … and the
 * coaching factor stuff"), as levels the learner measures exactly like the NFL's (`gameContext.ts`):
 *
 *   weather   MLB only — NBA and NHL play indoors. The last pre-game forecast the weather cron stored for the game
 *             (`/api/weather/refresh-cron` already covers MLB, writing `WeatherCache` keyed by the game's id), the
 *             NFL's thresholds: bad (wind 15+ mph or rain likely, outdoors), dome (roof closed or a domed park),
 *             normal. A doubleheader whose two forecasts disagree gets no level.
 *   coaching  NBA, NHL, MLB — first season under that head coach / manager (`coachRegistry.ts`).
 *
 * Every read is contained: a failed read is no level, never a default.
 */

const DAY = 86_400_000

export const dailyContextKey = (day: string, team: string) => `${day}:${team}`

type WeatherDb = Pick<PrismaClient, 'sportsGame' | 'weatherCache'>

/** MLB weather levels per US-Eastern game day and team, keyed `YYYY-MM-DD:TEAM`. */
export async function loadMlbWeatherLevels(db: WeatherDb, days: ReadonlyArray<string>): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const wanted = [...new Set(days)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
  if (!wanted.length) return out
  const from = new Date(Date.parse(`${wanted[0]}T00:00:00Z`) - DAY)
  const to = new Date(Date.parse(`${wanted[wanted.length - 1]}T00:00:00Z`) + 2 * DAY)
  const want = new Set(wanted)
  const games = await db.sportsGame
    .findMany({ where: { sport: 'MLB', startTime: { gte: from, lt: to } }, select: { externalId: true, homeTeam: true, awayTeam: true, startTime: true } })
    .catch(() => [])
  const dayOfGame = (g: { startTime: Date | null }) => (g.startTime ? easternDate(g.startTime) : null)
  const onDay = games.filter((g) => want.has(dayOfGame(g) ?? ''))
  if (!onDay.length) return out
  const rows = await db.weatherCache
    .findMany({
      where: { eventId: { in: onDay.map((g) => String(g.externalId)) } },
      select: { eventId: true, windSpeedMph: true, precipChancePct: true, isDome: true, isIndoor: true, roofClosed: true },
    })
    .catch(() => [])
  const byEvent = new Map(rows.map((r) => [String(r.eventId), r]))
  const conflicted = new Set<string>()
  for (const g of onDay) {
    const level = weatherLevel(byEvent.get(String(g.externalId)))
    if (!level) continue
    const day = dayOfGame(g)
    if (!day) continue
    for (const team of [g.homeTeam, g.awayTeam]) {
      const code = coachTeamKey('MLB', team)
      if (!code) continue
      const key = dailyContextKey(day, code)
      if (conflicted.has(key)) continue
      const had = out.get(key)
      if (had && had !== level) {
        out.delete(key)
        conflicted.add(key)
      } else out.set(key, level)
    }
  }
  return out
}

/** The context levels for one player's game: coaching from the list, weather from the MLB map. PURE. */
export function dailyGameContext(
  sport: string,
  team: string | null | undefined,
  atMs: number,
  day: string | null,
  weather: ReadonlyMap<string, string> | null,
): GameContextLevels | undefined {
  const s = sport.toUpperCase()
  if (!isCoachRegistrySport(s)) return undefined
  const out: GameContextLevels = {}
  const coaching = coachingLevelOn(s, team, atMs)
  if (coaching) out.coaching = coaching
  if (s === 'MLB' && weather && day) {
    const code = coachTeamKey('MLB', team)
    const w = code ? weather.get(dailyContextKey(day, code)) : undefined
    if (w) out.weather = w
  }
  return Object.keys(out).length ? out : undefined
}
