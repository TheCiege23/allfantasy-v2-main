import { prisma } from '@/lib/prisma'
import { recordChoppedReleases } from './choppedReleases'

/**
 * A native chop's player release: list the chopped teams' players (the home's chop moment, the war room, and
 * what an undone chop restores — ./chopUndo.ts), then drop them so they reach the next waiver run.
 *
 * Shared by the weekly driver (./nativeGuillotineWeek.ts) and "chop this team instead" (./chopUndoService.ts), so
 * both release the same way. The list is best-effort — a failed list must not stop the players reaching waivers —
 * and an undo refuses a chop whose list is missing, rather than guess which players to put back.
 */
export async function releaseNativeChoppedPlayers(input: {
  leagueId: string
  guillotineSeasonId: string | null
  week: number
  redraftRosterIds: string[]
  now: Date
}): Promise<void> {
  if (input.redraftRosterIds.length === 0) return
  if (input.guillotineSeasonId) {
    try {
      await recordChoppedReleases({
        leagueId: input.leagueId,
        guillotineSeasonId: input.guillotineSeasonId,
        week: input.week,
        redraftRosterIds: input.redraftRosterIds,
        availableAt: input.now,
      })
    } catch (error) {
      console.warn('[native-guillotine] released players not listed; the chop stands', {
        leagueId: input.leagueId,
        week: input.week,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  await prisma.redraftRosterPlayer.updateMany({
    where: { rosterId: { in: input.redraftRosterIds }, droppedAt: null },
    data: { droppedAt: input.now },
  })
}
