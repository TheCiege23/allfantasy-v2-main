import { prisma } from '@/lib/prisma'
import { runWeeklyResolution } from '@/lib/zombie/weeklyResolutionEngine'
import { processExpiredBashingDecisionsForAll } from '@/lib/zombie/bashingEngine'
import { scheduleWeeklyUpdate } from '@/lib/zombie/weeklyUpdateEngine'
import { deliverPendingAnimations } from '@/lib/zombie/animationEngine'

/**
 * Mark due scheduled announcements as posted (chat wiring can subscribe later).
 */
export async function processZombieAnnouncementQueue(): Promise<number> {
  const now = new Date()
  /** Only rows with a scheduled time in the past — never auto-mark drafts with `scheduledFor: null`. */
  const due = await prisma.zombieAnnouncement.findMany({
    where: {
      isPosted: false,
      AND: [{ scheduledFor: { not: null } }, { scheduledFor: { lte: now } }],
    },
    take: 100,
  })
  let n = 0
  for (const a of due) {
    await prisma.zombieAnnouncement.update({
      where: { id: a.id },
      data: { isPosted: true, postedAt: new Date() },
    })
    n += 1
  }
  return n
}

/**
 * Everything the zombie tick does besides resolving a week, for every active league:
 *   - a bashing decision whose window has passed defaults (spare),
 *   - due scheduled announcements are marked posted,
 *   - a weekly update with a set day and hour posts in that hour,
 *   - animations older than a day are marked delivered.
 *
 * 🛑 NONE OF THIS RAN. Its only caller was `/api/zombie/automation`, which is on no schedule, and the
 * cron list is at its ceiling (60/60 — `scripts/cron-budget-check.mjs`). So it runs from the
 * five-minute score-sync, which already resolves zombie weeks. Every step is idempotent at that
 * cadence: expiry and delivery act on rows past a deadline, the queue on rows due and unposted, and
 * a weekly update posts once per week (a posted announcement for that week stops the next tick).
 *
 * Never throws: each failure is collected, so one bad league costs its own step and nothing else.
 */
export async function runZombieHousekeeping(): Promise<{
  leaguesChecked: number
  announcementsPosted: number
  errors: string[]
}> {
  const errors: string[] = []
  const why = (e: unknown) => (e instanceof Error ? e.message : String(e))
  try {
    await processExpiredBashingDecisionsForAll()
  } catch (e) {
    errors.push(`bashing-expiry: ${why(e)}`)
  }

  let announcementsPosted = 0
  try {
    announcementsPosted = await processZombieAnnouncementQueue()
  } catch (e) {
    errors.push(`announcements: ${why(e)}`)
  }

  let active: Array<{ id: string; leagueId: string }> = []
  try {
    active =
      (await prisma.zombieLeague.findMany({ where: { status: 'active' }, select: { id: true, leagueId: true } })) ?? []
  } catch (e) {
    errors.push(`leagues: ${why(e)}`)
  }
  for (const z of active) {
    await scheduleWeeklyUpdate(z.leagueId).catch((e) => errors.push(`${z.id} weekly-update: ${why(e)}`))
    await deliverPendingAnimations(z.leagueId).catch((e) => errors.push(`${z.id} animations: ${why(e)}`))
  }

  return { leaguesChecked: active.length, announcementsPosted, errors }
}

/**
 * `/api/zombie/automation`: resolve each active league's current week, then the housekeeping above.
 * The scheduled path is score-sync, which resolves weeks itself and calls `runZombieHousekeeping`.
 */
export async function runZombieAutomationTick(opts?: { force?: boolean }): Promise<{
  leaguesProcessed: number
  errors: string[]
  skippedIdempotent: number
  skippedIncomplete: number
  announcementsPosted: number
}> {
  const errors: string[] = []
  let skippedIdempotent = 0
  let skippedIncomplete = 0

  const active = await prisma.zombieLeague.findMany({
    where: { status: { in: ['active', 'registering'] } },
  })

  let leaguesProcessed = 0
  for (const z of active) {
    try {
      const week = Math.max(1, z.currentWeek || 1)
      if (!opts?.force) {
        const done = await prisma.zombieWeeklyResolution.findUnique({
          where: { zombieLeagueId_week: { zombieLeagueId: z.id, week } },
        })
        if (done?.status === 'complete' && done.resolvedAt) {
          skippedIdempotent += 1
          continue
        }
      }
      const result = await runWeeklyResolution(z.id, week, { force: opts?.force === true })
      if (result.skipped) {
        skippedIncomplete += 1
        continue
      }
      leaguesProcessed += 1
    } catch (e) {
      errors.push(`${z.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // After resolution, so a week resolved on this tick is the one a scheduled update can post.
  const housekeeping = await runZombieHousekeeping()
  errors.push(...housekeeping.errors)

  return {
    leaguesProcessed,
    errors,
    skippedIdempotent,
    skippedIncomplete,
    announcementsPosted: housekeeping.announcementsPosted,
  }
}
