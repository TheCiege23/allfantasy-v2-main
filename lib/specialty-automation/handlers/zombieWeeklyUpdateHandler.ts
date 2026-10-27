/**
 * Zombie weekly update scheduler & orchestration.
 * Triggered by automation system based on sport schedule.
 * Handles multi-league universes with coordinated updates.
 */

import { prisma } from '@/lib/prisma'
import { buildWeeklyUpdate, postWeeklyUpdate } from '@/lib/zombie/weeklyUpdateEngine'
import { getZombieSportConfig } from '@/lib/zombie/sportRulesConfig'
import { getZombieSeasonSchedule } from '@/lib/zombie/zombieSeasonSchedule'

export type ZombieUpdateResult = {
  leagueId: string
  success: boolean
  week: number
  message?: string
  error?: string
}

/**
 * Trigger weekly update for a single zombie league.
 * Posts announcement to league chat + updates standings.
 */
export async function triggerZombieLeagueWeeklyUpdate(
  leagueId: string,
  week: number
): Promise<ZombieUpdateResult> {
  try {
    const z = await prisma.zombieLeague.findUnique({
      where: { leagueId },
      select: { id: true, status: true, sport: true, universeId: true },
    })
    if (!z) {
      return { leagueId, success: false, week, error: 'Zombie league not found' }
    }
    if (z.status !== 'active' && z.status !== 'in_progress') {
      return { leagueId, success: false, week, error: `League status ${z.status}, skipping update` }
    }

    const resolution = await prisma.zombieWeeklyResolution.findUnique({
      where: { zombieLeagueId_week: { zombieLeagueId: z.id, week } },
      select: { status: true },
    })
    if (resolution?.status !== 'complete') {
      return { leagueId, success: false, week, error: 'Week has not resolved yet' }
    }
    const existing = await prisma.zombieAnnouncement.findUnique({
      where: { idempotencyKey: `zombie-weekly:${z.id}:${week}` },
      select: { isPosted: true },
    })
    if (existing?.isPosted) return { leagueId, success: true, week, message: 'Weekly update already posted' }
    const draft = await buildWeeklyUpdate(leagueId, week)
    await postWeeklyUpdate(leagueId, week, draft)

    return { leagueId, success: true, week, message: 'Weekly update posted' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { leagueId, success: false, week, error: msg }
  }
}

/**
 * Trigger weekly updates for all leagues in a zombie universe.
 * Used when a 3-6 league universe needs coordinated updates.
 */
export async function triggerZombieUniverseWeeklyUpdates(
  universeId: string,
  week: number
): Promise<ZombieUpdateResult[]> {
  try {
    const universe = await prisma.zombieUniverse.findUnique({
      where: { id: universeId },
      select: { leagues: { select: { leagueId: true } } },
    })
    if (!universe) {
      return [{ leagueId: universeId, success: false, week, error: 'Universe not found' }]
    }

    const results: ZombieUpdateResult[] = []
    for (const league of universe.leagues) {
      if (league.leagueId) {
        const result = await triggerZombieLeagueWeeklyUpdate(league.leagueId, week)
        results.push(result)
      }
    }

    // Post universe-level summary to universe chat
    const successCount = results.filter((r) => r.success).length
    const failureCount = results.filter((r) => !r.success).length
    const universeMsg = {
      id: `universe-summary-w${week}`,
      userId: 'system',
      userName: 'Universe Horde Report',
      body:
        `📡 **Week ${week} Complete**: ${successCount} league(s) updated` +
        (failureCount > 0 ? `, ${failureCount} failed` : ''),
      createdAt: new Date().toISOString(),
    }

    const settings = (await prisma.zombieUniverse.findUnique({
      where: { id: universeId },
      select: { settings: true },
    }))?.settings as Record<string, unknown> | null

    const existing = settings?.universeChat
      ? Array.isArray(settings.universeChat)
        ? settings.universeChat
        : []
      : []
    const updated = existing.some((entry: { id?: string }) => entry.id === universeMsg.id)
      ? existing : [...existing, universeMsg].slice(-200)

    await prisma.zombieUniverse.update({
      where: { id: universeId },
      data: { settings: { ...settings, universeChat: updated } },
    })

    return results
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return [{ leagueId: universeId, success: false, week, error: msg }]
  }
}

/**
 * Main entry point: trigger all active zombie league updates based on sport schedule.
 * Called by automation system at designated times per sport:
 * - NFL: Tuesday 10:00am ET
 * - NBA/MLB/NHL/NCAAB: Monday 10:00am ET
 * - NCAAF: Sunday 10:00am ET
 * - SOCCER: Tuesday 10:00am ET
 */
export async function triggerAllZombieWeeklyUpdates(): Promise<{
  total: number
  succeeded: number
  failed: number
  results: ZombieUpdateResult[]
}> {
  const results: ZombieUpdateResult[] = []

  try {
    const now = new Date()
    const nowDay = now.getUTCDay()
    const nowHour = now.getUTCHours()

    // Get all active zombie leagues grouped by sport.
    const leagues = await prisma.zombieLeague.findMany({
      where: { status: { in: ['active', 'in_progress'] } },
      select: { id: true, leagueId: true, sport: true, currentWeek: true, universeId: true },
    })

    const dueLeagues = leagues.filter((league) => {
      const schedule = getZombieSeasonSchedule(league.sport)
      return schedule.weeklyUpdateDayOfWeek === nowDay && schedule.automationHourUtc === nowHour
    })

    const universeSummary = new Map<string, { success: number; failed: number; week: number }>()

    for (const league of dueLeagues) {
      const latest = await prisma.zombieWeeklyResolution.findFirst({
        where: { zombieLeagueId: league.id, status: 'complete' },
        orderBy: { week: 'desc' },
        select: { week: true },
      })
      if (!latest) continue
      const result = await triggerZombieLeagueWeeklyUpdate(league.leagueId, latest.week)
      results.push(result)
      if (league.universeId) {
        const prev = universeSummary.get(league.universeId) ?? {
          success: 0,
          failed: 0,
          week: latest.week,
        }
        if (result.success) prev.success += 1
        else prev.failed += 1
        universeSummary.set(league.universeId, prev)
      }
    }

    for (const [universeId, summary] of universeSummary.entries()) {
      const settings = (await prisma.zombieUniverse.findUnique({
        where: { id: universeId },
        select: { settings: true },
      }))?.settings as Record<string, unknown> | null
      const existing = Array.isArray(settings?.universeChat) ? settings.universeChat : []
      const message = {
        id: `universe-summary-w${summary.week}`,
        userId: 'system',
        userName: 'Universe Horde Report',
        body:
          `📡 Week ${summary.week} complete: ${summary.success} league(s) updated` +
          (summary.failed > 0 ? `, ${summary.failed} failed.` : '.'),
        createdAt: new Date().toISOString(),
      }
      if (!existing.some((entry: { id?: string }) => entry.id === message.id)) {
        await prisma.zombieUniverse.update({
          where: { id: universeId },
          data: { settings: { ...(settings ?? {}), universeChat: [...existing, message].slice(-200) } },
        })
      }
    }

    const succeeded = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length

    return {
      total: results.length,
      succeeded,
      failed,
      results,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('Zombie weekly update orchestration failed:', msg)
    return {
      total: 0,
      succeeded: 0,
      failed: 1,
      results: [{ leagueId: 'orchestration', success: false, week: -1, error: msg }],
    }
  }
}

/**
 * Utility: Get current week for a league based on redraft season.
 */
export async function getCurrentZombieLeagueWeek(leagueId: string): Promise<number> {
  const z = await prisma.zombieLeague.findFirst({
    where: { leagueId },
    select: { currentWeek: true },
  })
  return z?.currentWeek ?? 1
}

/**
 * Utility: Get next scheduled update time for a sport.
 */
export function getZombieUpdateScheduleForSport(sport: string): {
  dayOfWeek: string // 'Monday', 'Tuesday', etc.
  timeUtc: string // 'HH:mm' in UTC
  timeEt: string // 'HH:mm ET'
} {
  // Keep this utility aligned with the canonical per-sport schedule contract.
  const config = getZombieSportConfig(sport)
  const schedule = getZombieSeasonSchedule(config.sport)
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const hour = String(schedule.automationHourUtc).padStart(2, '0')
  return {
    dayOfWeek: dayNames[schedule.weeklyUpdateDayOfWeek] ?? 'Monday',
    timeUtc: `${hour}:00`,
    // Product copy standardizes this as ET 10am for now.
    timeEt: '10:00am',
  }
}
