import type { PrismaClient } from '@prisma/client'
import { rotateForFairness } from '@/lib/cron/runBudget'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { isBasketballC2CLeague } from './campusLineup'
import { refreshNbaCampusWeek } from './refreshNbaCampusWeek'

type Db = Pick<PrismaClient, 'redraftSeason' | 'sportsDataCache' | 'teamProviderIdentity'>

/** Refresh active weekly slates once per worker pass, with a shared time and event budget. */
export async function refreshActiveNbaCampusWeeks(db: Db, input: { now: Date; deadlineAt: number; maxEvents: number; refresh?: typeof refreshNbaCampusWeek }) {
  const seasons = await db.redraftSeason.findMany({
    where: { sport: 'NBA', status: { in: ['active', 'regular_season_complete', 'playoffs'] }, currentWeek: { gt: 0 } },
    select: { season: true, currentWeek: true, league: { select: { platform: true, sport: true, leagueVariant: true } } },
  })
  const weeks = new Map<string, { season: number; week: number }>()
  for (const row of seasons) {
    if (!isNativePlatform(row.league.platform) || !isBasketballC2CLeague(row.league)) continue
    for (const week of [row.currentWeek, row.currentWeek - 1]) if (week > 0) weeks.set(`${row.season}:${week}`, { season: row.season, week })
  }
  const results = []
  let remaining = Math.max(0, Math.min(20, input.maxEvents))
  for (const key of rotateForFairness([...weeks.keys()].sort())) {
    if (Date.now() >= input.deadlineAt || remaining === 0) break
    const period = weeks.get(key)!
    const result = await (input.refresh ?? refreshNbaCampusWeek)(db, { ...period, now: input.now, deadlineAt: input.deadlineAt, maxEvents: remaining })
    results.push({ ...period, ...result })
    remaining -= Math.min(remaining, 'boxesAttempted' in result ? result.boxesAttempted ?? 0 : 0)
    if ('blocked' in result && result.blocked) break
  }
  return { periods: weeks.size, processed: results.length, results }
}
