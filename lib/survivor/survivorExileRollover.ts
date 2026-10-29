import 'server-only'
import { prisma } from '@/lib/prisma'
import { NATIVE_PLATFORM_VALUES } from '@/lib/dashboard/platform-label'
import { closeExpiredExileRosters, finalizeExileRosterResults } from '@/lib/survivor/exileRosterService'
import { scoreExileWeek } from '@/lib/survivor/exileEngine'
import { finalizeChimmyExileBossScore, lockChimmyExileRoster } from '@/lib/survivor/exileChimmyBoss'

/** Roster rollover is independent of ceremony processing and late score ingestion. */
export async function runExileRosterRollover() {
  const islands = await prisma.exileIsland.findMany({ where: { isActive: true, league: { platform: { in: [...NATIVE_PLATFORM_VALUES], mode: 'insensitive' } } }, select: { leagueId: true } })
  let released = 0
  let scored = 0
  let pending = 0
  const errors: { leagueId: string; error: string }[] = []
  for (const { leagueId } of islands) {
    try {
      await lockChimmyExileRoster(leagueId)
      released += await closeExpiredExileRosters(leagueId)
      const weeks = await prisma.exileWeeklyEntry.findMany({ where: { leagueId }, distinct: ['week'], select: { week: true } })
      for (const { week } of weeks) {
        if (await finalizeExileRosterResults(leagueId, week)) {
          await finalizeChimmyExileBossScore(leagueId, week)
          if (await scoreExileWeek(leagueId, week)) scored++
        } else pending++
      }
    } catch (error) { errors.push({ leagueId, error: error instanceof Error ? error.message : 'Exile rollover failed.' }) }
  }
  return { processed: islands.length, released, scored, pending, errors }
}
