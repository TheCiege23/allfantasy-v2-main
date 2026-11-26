/**
 * The commissioner task (and notification) for game days the per-day waiver schedule leaves without a
 * free-agent window (lib/waivers/gameDayWaiverConflicts.ts). AF Commissioner only (owner, 2026-11-26):
 * a league whose owner has no plan gets no task.
 *
 * Runs from the daily Commissioner Workspace refresh (lib/commissioner-workspace/taskSources.ts). A task
 * the commissioner archives ("leave it") is never reopened (taskStore.ts); one whose day they change to
 * "Waivers to FA" closes itself on the next run, because the conflict is no longer detected.
 */
import { prisma } from '@/lib/prisma'
import { ownerHasAfCommissionerPlan } from '@/lib/stat-corrections/applyStatCorrections'
import { leagueSettingsHomeHref } from '@/lib/league-settings-home/settingsEntryRouting'
import { readRiScheduleWindow } from '@/lib/sports-data/riScheduleCache'
import { readDailyWaiverScheduleFromSettings } from './dailyWaiverSchedule'
import { describeGameDayConflict, findGameDayWaiverConflicts, waiverDayName } from './gameDayWaiverConflicts'
import type { WorkspaceTaskCandidate } from '@/lib/commissioner-workspace/taskSources'

/** How far ahead the check looks: far enough to fix next week's games, near enough to be accurate. */
export const GAME_DAY_CONFLICT_LOOKAHEAD_DAYS = 7

const SPORT_ALIASES: Record<string, string[]> = { NCAAB: ['NCAAB', 'NCAABB'], NCAAF: ['NCAAF', 'NCAAFB'] }
/** SportsGame does not hold a full slate for these; the Rolling Insights schedule cache does (lib/redraft/weekGames.ts). */
const RI_SLATE_SPORTS = new Set(['NCAAB', 'MLB', 'SOCCER'])

async function readGameStarts(sport: string, season: number | null, from: Date, to: Date): Promise<Date[] | null> {
  const s = sport.toUpperCase()
  if (RI_SLATE_SPORTS.has(s)) {
    const games = await readRiScheduleWindow(prisma as never, {
      sport: s,
      season: season ?? from.getUTCFullYear(),
      window: { start: from, end: to },
    }).catch(() => null)
    // null = the season was never synced: "cannot tell", so no task (never a false "no games").
    if (!games) return null
    return games.map((g) => (g.startTime ? new Date(g.startTime) : null)).filter((d): d is Date => d instanceof Date)
  }
  const rows = await prisma.sportsGame
    .findMany({
      where: { sport: { in: SPORT_ALIASES[s] ?? [s] }, startTime: { gte: from, lte: to } },
      select: { startTime: true },
      take: 2000,
    })
    .catch(() => null)
  if (!rows) return null
  return rows.map((r) => r.startTime).filter((d): d is Date => d instanceof Date)
}

export async function readGameDayWaiverConflictTasks(leagueId: string, now = new Date()): Promise<WorkspaceTaskCandidate[]> {
  const league = await prisma.league
    .findUnique({ where: { id: leagueId }, select: { id: true, userId: true, sport: true, season: true, timezone: true, settings: true } })
    .catch(() => null)
  if (!league) return []
  const schedule = readDailyWaiverScheduleFromSettings(league.settings)
  if (!schedule?.enabled) return []
  if (!(await ownerHasAfCommissionerPlan(league.userId ?? null))) return []

  const to = new Date(now.getTime() + GAME_DAY_CONFLICT_LOOKAHEAD_DAYS * 86_400_000)
  const starts = await readGameStarts(String(league.sport ?? 'NFL'), league.season ?? null, now, to)
  if (!starts || starts.length === 0) return []

  const conflicts = findGameDayWaiverConflicts({ schedule, timeZone: league.timezone, gameStarts: starts, now })
  const href = leagueSettingsHomeHref(leagueId, 'waivers')
  return conflicts.map((c) => {
    const name = waiverDayName(c.day)
    const description = `${describeGameDayConflict(c, league.timezone)} Change ${name} to "Waivers to FA" so managers can pick up players after waivers clear, or archive this task to leave it as it is.`
    return {
      // One task per real date: fixing (or leaving) this Thursday says nothing about next Thursday.
      sourceKey: `daily-waiver-game-day-conflict:v1:${c.date}`,
      title: `${name} has games but no free-agent window before kickoff`,
      description,
      dueAt: c.firstKickoff,
      priority: 'elevated' as const,
      automationCandidate: false,
      relatedLinks: [{ label: 'Open waiver days', moduleId: 'settings' as const, href }],
      notifyOnOpen: {
        title: `${name}'s games start before free agency opens`,
        body: describeGameDayConflict(c, league.timezone),
        actionHref: href,
        actionLabel: `Change ${name}`,
      },
    }
  })
}
