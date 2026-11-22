import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { ensureDailySportSeasonStart } from '@/lib/season-week/deriveDailySportSeasonStart'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'

type ScheduleDb = Pick<Prisma.TransactionClient, 'sportsGame'>
const DAY_MS = 86_400_000

function earliest(starts: Date[]): Date | null {
  return starts.length ? new Date(Math.min(...starts.map(start => start.getTime()))) : null
}

/**
 * One lock clock for Chimmy powers, read from a complete stored provider schedule.
 * NFL uses API-Sports regular-season periods. TheSportsDB carries dated NBA/NHL/MLB
 * seasons in Postgres even when GameSchedule has not yet been imported.
 */
export async function trustedZombieWeekStart(
  sport: string,
  season: number,
  week: number,
  db: ScheduleDb = prisma,
): Promise<Date | null> {
  const key = sport.toUpperCase()
  if (!Number.isInteger(week) || week < 1 || !['NFL', 'NBA', 'NHL', 'MLB'].includes(key)) return null

  if (key === 'NFL') {
    const rows = await db.sportsGame?.findMany({
      where: { sport: key, source: 'api_sports', season, seasonType: 'regular', week },
      select: { startTime: true },
    })
    if (rows?.length) {
      if (rows.some(row => !row.startTime)) return null
      return earliest(rows.flatMap(row => row.startTime ? [row.startTime] : []))
    }
  } else {
    await ensureDailySportSeasonStart(key, season, { db: prisma }).catch(() => null)
    const window = resolveDailySportWeekWindow(key, season, week)
    if (!window) return null
    const missingTimes = await db.sportsGame?.count({
      where: { sport: key, source: 'thesportsdb', season, startTime: null },
    })
    if (missingTimes) return null
    const rows = await db.sportsGame?.findMany({
      where: {
        sport: key,
        source: 'thesportsdb',
        startTime: {
          gte: new Date(window.start.getTime() - DAY_MS),
          lt: new Date(window.end.getTime() + DAY_MS),
        },
      },
      select: { startTime: true },
    })
    const starts = (rows ?? []).flatMap(row => {
      if (!row.startTime) return []
      const day = easternCalendarDay(row.startTime)
      return day && day >= window.start && day < window.end ? [row.startTime] : []
    })
    if (starts.length) return earliest(starts)
  }

  // A missing trusted schedule cannot establish a fair first-game deadline.
  return null
}
