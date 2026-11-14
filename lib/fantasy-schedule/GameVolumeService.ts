/**
 * [NEW] lib/fantasy-schedule/GameVolumeService.ts
 * Sport-agnostic game volume service. Queries GameSchedule for any sport,
 * aggregates per-day volume, classifies days.
 */

import { prisma } from '@/lib/prisma'
import type { DayClassification, DayVolume, WeekVolumeProfile, ScheduleSport } from './types'
import { getDefaultScheduleConfig } from './types'

/** Classify a day by its game count. */
function classifyDay(
  gameCount: number,
  thresholdHeavy: number,
  thresholdModerate: number
): DayClassification {
  if (gameCount === 0) return 'off'
  if (gameCount < thresholdModerate) return 'light'
  if (gameCount < thresholdHeavy) return 'moderate'
  return 'heavy'
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function dayOfWeekFromIso(isoDate: string): number {
  return new Date(isoDate + 'T12:00:00Z').getUTCDay()
}

/**
 * Get the volume profile for a specific fantasy week for ANY sport.
 */
export async function getWeekVolumeProfile(
  sport: ScheduleSport,
  season: number,
  week: number,
  options?: { thresholdHeavy?: number; thresholdModerate?: number }
): Promise<WeekVolumeProfile> {
  const defaults = getDefaultScheduleConfig(sport)
  const thresholdHeavy = options?.thresholdHeavy ?? defaults.volumeThresholdHeavy
  const thresholdModerate = options?.thresholdModerate ?? defaults.volumeThresholdModerate

  const games = await prisma.gameSchedule.findMany({
    where: { sportType: sport, season, weekOrRound: week },
    select: { startTime: true, homeTeam: true, awayTeam: true },
    orderBy: { startTime: 'asc' },
  })

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

  const days: DayVolume[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { count, teams }]) => ({
      date,
      dayOfWeek: dayOfWeekFromIso(date),
      gameCount: count,
      classification: classifyDay(count, thresholdHeavy, thresholdModerate),
      teams: [...teams],
    }))

  const totalGames = days.reduce((sum, d) => sum + d.gameCount, 0)
  const gamesPerDay: Record<string, number> = {}
  for (const d of days) gamesPerDay[d.date] = d.gameCount

  const gameDays = days.filter((d) => d.gameCount > 0)
  const sortedByVolume = [...gameDays].sort((a, b) => a.gameCount - b.gameCount)

  return {
    sport,
    season,
    week,
    days,
    totalGames,
    gamesPerDay,
    leastBusyDay: sortedByVolume[0] ?? null,
    secondLeastBusyDay: sortedByVolume[1] ?? null,
    mostBusyDay: sortedByVolume.length > 0 ? sortedByVolume[sortedByVolume.length - 1]! : null,
    averageGamesPerDay: days.length > 0 ? totalGames / days.length : 0,
  }
}

export async function getLeastBusyDay(sport: ScheduleSport, season: number, week: number): Promise<DayVolume | null> {
  return (await getWeekVolumeProfile(sport, season, week)).leastBusyDay
}

export async function getMostBusyDay(sport: ScheduleSport, season: number, week: number): Promise<DayVolume | null> {
  return (await getWeekVolumeProfile(sport, season, week)).mostBusyDay
}

export async function getBalancedScoringDays(sport: ScheduleSport, season: number, week: number, count: number): Promise<DayVolume[]> {
  const profile = await getWeekVolumeProfile(sport, season, week)
  const gameDays = profile.days.filter((d) => d.gameCount > 0)
  if (count <= 0 || count >= gameDays.length) return gameDays
  const avg = profile.averageGamesPerDay
  return [...gameDays]
    .sort((a, b) => Math.abs(a.gameCount - avg) - Math.abs(b.gameCount - avg))
    .slice(0, count)
    .sort((a, b) => a.date.localeCompare(b.date))
}

export async function getWeekGameCounts(sport: ScheduleSport, season: number, week: number): Promise<Record<string, number>> {
  return (await getWeekVolumeProfile(sport, season, week)).gamesPerDay
}

export async function getSeasonVolumeProfiles(sport: ScheduleSport, season: number, startWeek: number, endWeek: number): Promise<WeekVolumeProfile[]> {
  const profiles: WeekVolumeProfile[] = []
  for (let w = startWeek; w <= endWeek; w++) {
    profiles.push(await getWeekVolumeProfile(sport, season, w))
  }
  return profiles
}
