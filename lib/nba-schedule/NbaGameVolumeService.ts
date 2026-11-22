/**
 * [NEW] lib/nba-schedule/NbaGameVolumeService.ts
 * Queries GameSchedule for NBA games, aggregates per-day volume, classifies days.
 * Foundation for league-type-specific schedule intelligence.
 */

import { prisma } from '@/lib/prisma'
import type { DayClassification, DayVolume, WeekVolumeProfile } from './types'
import { DEFAULT_NBA_SCHEDULE_CONFIG } from './types'

/** Classify a day by its game count. */
function classifyDay(
  gameCount: number,
  thresholdHeavy = DEFAULT_NBA_SCHEDULE_CONFIG.volumeThresholdHeavy,
  thresholdModerate = DEFAULT_NBA_SCHEDULE_CONFIG.volumeThresholdModerate
): DayClassification {
  if (gameCount === 0) return 'off'
  if (gameCount < thresholdModerate) return 'light'
  if (gameCount < thresholdHeavy) return 'moderate'
  return 'heavy'
}

/** Convert a Date to YYYY-MM-DD ISO date string in UTC. */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Get day of week (0=Sun..6=Sat) from ISO date string. */
function dayOfWeekFromIso(isoDate: string): number {
  return new Date(isoDate + 'T12:00:00Z').getUTCDay()
}

/**
 * Get the volume profile for a specific fantasy week.
 * Queries GameSchedule by sportType=NBA, season, weekOrRound.
 * Groups games by date, counts per day, classifies each.
 */
export async function getWeekVolumeProfile(
  season: number,
  week: number,
  options?: { thresholdHeavy?: number; thresholdModerate?: number }
): Promise<WeekVolumeProfile> {
  const thresholdHeavy = options?.thresholdHeavy ?? DEFAULT_NBA_SCHEDULE_CONFIG.volumeThresholdHeavy
  const thresholdModerate = options?.thresholdModerate ?? DEFAULT_NBA_SCHEDULE_CONFIG.volumeThresholdModerate

  const games = await prisma.gameSchedule.findMany({
    where: { sportType: 'NBA', season, weekOrRound: week },
    select: { startTime: true, homeTeam: true, awayTeam: true },
    orderBy: { startTime: 'asc' },
  })

  // Group games by date
  const byDate = new Map<string, { count: number; teams: Set<string> }>()
  for (const g of games) {
    if (!g.startTime) continue
    const date = toIsoDate(g.startTime)
    const entry = byDate.get(date) ?? { count: 0, teams: new Set<string>() }
    entry.count++
    if (g.homeTeam) entry.teams.add(g.homeTeam)
    if (g.awayTeam) entry.teams.add(g.awayTeam)
    byDate.set(date, entry)
  }

  // Build day volumes sorted by date
  const days: DayVolume[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { count, teams }]) => ({
      date,
      dayOfWeek: dayOfWeekFromIso(date),
      gameCount: count,
      classification: classifyDay(count, thresholdHeavy, thresholdModerate),
      teams: [...teams],
    }))

  // If no game data, also include the 7 days of the week with 0 games
  // by deriving from surrounding weeks or returning empty profile
  const totalGames = days.reduce((sum, d) => sum + d.gameCount, 0)
  const gamesPerDay: Record<string, number> = {}
  for (const d of days) gamesPerDay[d.date] = d.gameCount

  // Find least and most busy days (with games, not off days)
  const gameDays = days.filter((d) => d.gameCount > 0)
  const sortedByVolume = [...gameDays].sort((a, b) => a.gameCount - b.gameCount)

  const leastBusyDay = sortedByVolume[0] ?? null
  const secondLeastBusyDay = sortedByVolume[1] ?? null
  const mostBusyDay = sortedByVolume.length > 0 ? sortedByVolume[sortedByVolume.length - 1]! : null

  const averageGamesPerDay = days.length > 0 ? totalGames / days.length : 0

  return {
    season,
    week,
    days,
    totalGames,
    gamesPerDay,
    leastBusyDay,
    secondLeastBusyDay,
    mostBusyDay,
    averageGamesPerDay,
  }
}

/**
 * Get volume profiles for a range of weeks (e.g., full season).
 * Useful for calendar views.
 */
export async function getSeasonVolumeProfiles(
  season: number,
  startWeek: number,
  endWeek: number
): Promise<WeekVolumeProfile[]> {
  const profiles: WeekVolumeProfile[] = []
  for (let w = startWeek; w <= endWeek; w++) {
    profiles.push(await getWeekVolumeProfile(season, w))
  }
  return profiles
}
