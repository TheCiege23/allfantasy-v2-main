import 'server-only'

/**
 * Chop alerts (2026-10-29): push, email and the bell, through the one dispatcher, so each manager's
 * own switches, quiet hours and league mutes apply. The words are in ./chopAlertCopy.ts.
 *
 * Both go out under "Game scores, halftime, close games & finals" (`matchup_results`): a Guilly week
 * has no matchup, and the chop IS the week's result. It is also one of the time-sensitive categories
 * that texts by default once a manager has agreed to texts.
 *
 * ⚠ AT MOST ONCE, TWICE OVER. score-sync runs every five minutes on two worker replicas. Each alert
 * carries a dedupe key, so the bell row is written once per person and the durable transport sends
 * each channel once; the warning is also throttled by a lock and recorded as a league event BEFORE
 * anything is sent, so the costly part (scoring every team) runs once per half hour of its one-day
 * window, not on every tick, and no level is sent to a team twice.
 */
import { prisma } from '@/lib/prisma'
import { acquireAutomationLock } from '@/lib/automation/locks'
import { resolveRecipients } from '@/lib/notifications/resolveAppUserIds'
import { readWeekSlate, DATE_WINDOWED_SPORTS } from '@/lib/redraft/weekFinalizer'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { ensureDailySportSeasonStart } from '@/lib/season-week/deriveDailySportSeasonStart'
import { seasonSportToLeagueSport } from '@/lib/season-week/standardSeasonScope'
import type { DispatchNotificationParams } from '@/lib/notifications/NotificationDispatcher'
import { appendEvent } from './GuillotineEventLog'
import { loadChopPreview } from './chopPreviewLoad'
import type { ChopPreview } from './chopPreview'
import { chopResultAlert, chopZoneWarning } from './chopAlertCopy'
import { readGuillotineBestBall } from './guillotineBestBall'

/** The warning goes out inside the last day before the week's final game starts. */
export const CHOP_ZONE_WARNING_LEAD_MS = 24 * 60 * 60 * 1000

type Dispatch = (params: DispatchNotificationParams) => Promise<unknown>

async function defaultDispatch(params: DispatchNotificationParams): Promise<unknown> {
  const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
  return dispatchNotification(params)
}

/** Roster (engine id space) -> the AllFantasy user who manages it, for the rosters given. */
async function usersByRoster(leagueId: string, rosterIds: readonly string[]): Promise<Map<string, string>> {
  if (rosterIds.length === 0) return new Map()
  const rosters = await prisma.roster.findMany({
    where: { leagueId, id: { in: [...rosterIds] } },
    select: { id: true, platformUserId: true },
  })
  const out = new Map<string, string>()
  // Imported leagues hold Sleeper ids here; resolveRecipients translates them one at a time so each
  // roster keeps its own user. A manager with no AllFantasy account has nowhere to be told.
  for (const r of rosters) {
    if (!r.platformUserId) continue
    const { userIds } = await resolveRecipients([r.platformUserId])
    if (userIds[0]) out.set(r.id, userIds[0])
  }
  return out
}

/** A best ball Guilly league (./guillotineBestBall.ts): its warnings carry no lineup advice. */
async function leagueSetsLineups(leagueId: string): Promise<boolean> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  return readGuillotineBestBall(league?.settings)
}

async function leagueName(leagueId: string): Promise<string> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { name: true } })
  return league?.name?.trim() || 'your Guilly league'
}

// ─── The chop ────────────────────────────────────────────────────────────────────────────────────

export type ChopResultAlertInput = {
  leagueId: string
  season: number | null | undefined
  week: number
  choppedRosterIds: readonly string[]
  /** Every team scored this week, chopped ones included. Teams chopped in earlier weeks are not told. */
  aliveRosterIds: readonly string[]
  displayNames: Record<string, string>
  rosterReleaseTiming: string | null | undefined
}

/** Tell this week's teams how the chop went. Best effort: the caller's chop stands whatever happens here. */
export async function sendChopResultAlerts(
  input: ChopResultAlertInput,
  deps: { dispatch?: Dispatch } = {},
): Promise<{ chopped: number; survived: number }> {
  const dispatch = deps.dispatch ?? defaultDispatch
  const choppedSet = new Set(input.choppedRosterIds)
  const owners = await usersByRoster(input.leagueId, input.aliveRosterIds)
  const name = await leagueName(input.leagueId)
  const choppedUsers = new Set(input.choppedRosterIds.flatMap((id) => (owners.has(id) ? [owners.get(id)!] : [])))
  const survivors = [...new Set(
    input.aliveRosterIds.filter((id) => !choppedSet.has(id)).flatMap((id) => (owners.has(id) ? [owners.get(id)!] : [])),
  )].filter((userId) => !choppedUsers.has(userId))
  const choppedNames = input.choppedRosterIds.map((id) => input.displayNames[id] ?? 'A team')
  const key = `guillotine-chop:${input.leagueId}:${input.season ?? 'na'}:w${input.week}`
  const common = {
    category: 'matchup_results' as const,
    actionHref: `/league/${input.leagueId}`,
    actionLabel: 'Open league',
    leagueId: input.leagueId,
    meta: { guillotineWeek: input.week, choppedRosterIds: [...input.choppedRosterIds] },
  }

  for (const [youWereChopped, userIds, type] of [
    [true, [...choppedUsers], 'guillotine_chopped'],
    [false, survivors, 'guillotine_survived'],
  ] as const) {
    if (userIds.length === 0) continue
    const alert = chopResultAlert({ leagueName: name, week: input.week, choppedNames, youWereChopped, rosterReleaseTiming: input.rosterReleaseTiming })
    // A survivor goes straight to the released players (the home's chop moment), where the bids are.
    const link = youWereChopped ? {} : { actionHref: `/league/${input.leagueId}#guillotine-chop`, actionLabel: 'See the players' }
    await dispatch({ ...common, ...link, userIds: [...userIds], type, title: alert.title, body: alert.body, severity: alert.severity, dedupePrefix: `${key}:${type}` })
  }
  return { chopped: choppedUsers.size, survived: survivors.length }
}

// ─── The warning ─────────────────────────────────────────────────────────────────────────────────

export type ChopZoneWarningOutcome =
  | 'sent'
  | 'no_change'
  | 'throttled'
  | 'schedule_unknown'
  | 'too_early'
  | 'too_late'
  | 'no_chop_this_week'
  | 'week_mismatch'
  | 'blocked'
  | 'no_scores'

export type ChopZoneWarningDeps = {
  now?: () => Date
  dispatch?: Dispatch
  loadPreview?: (leagueId: string) => Promise<ChopPreview | { error: string }>
  /** When the week's last game starts; null when the schedule cannot tell. */
  lastGameStart?: (args: { sport: string; season: number; week: number; now: Date }) => Promise<Date | null>
}

async function defaultLastGameStart(args: { sport: string; season: number; week: number; now: Date }): Promise<Date | null> {
  const sport = seasonSportToLeagueSport(args.sport) || args.sport
  let dateWindow: { start: Date; end: Date } | null = null
  // A daily sport's week is a date window — the one the finalizer and the stat sync read.
  if (DATE_WINDOWED_SPORTS.includes(sport)) {
    await ensureDailySportSeasonStart(sport, args.season, { db: prisma })
    const window = resolveDailySportWeekWindow(sport, args.season, args.week)
    if (!window) return null
    dateWindow = { start: new Date(window.start), end: new Date(window.end) }
  }
  const slate = await readWeekSlate(prisma as never, { sport, season: args.season, week: args.week, seasonType: 'regular', now: args.now, dateWindow })
  return slate.lastStartTime ? new Date(slate.lastStartTime) : null
}

const WARNING_EVENT = 'chop_zone_warning' as const

/** Inside the window the standings are looked at again this often — the late-drop warning (2026-10-29). */
export const CHOP_ZONE_RECHECK_MS = 30 * 60 * 1000

type WarnLevel = 'danger' | 'chopped'
const LEVEL_RANK: Record<WarnLevel, number> = { danger: 1, chopped: 2 }

/**
 * What this week's warnings already told each team, from the league events they left: rosterId → the
 * most serious level sent, and when the week's last game starts (stored by the first pass, so later
 * ticks need no schedule read). A legacy event (rosterIds, no levels) counts as the most serious.
 */
async function warnedSoFar(leagueId: string, key: string): Promise<{ any: boolean; levels: Map<string, WarnLevel>; lastStartAt: Date | null }> {
  const rows = await prisma.guillotineEventLog.findMany({
    where: { leagueId, eventType: WARNING_EVENT, metadata: { path: ['key'], equals: key } },
    select: { metadata: true },
  })
  const levels = new Map<string, WarnLevel>()
  let lastStartAt: Date | null = null
  const raise = (rosterId: string, level: WarnLevel) => {
    const prior = levels.get(rosterId)
    if (!prior || LEVEL_RANK[level] > LEVEL_RANK[prior]) levels.set(rosterId, level)
  }
  for (const row of rows) {
    const m = (row.metadata ?? {}) as { warned?: Record<string, unknown>; rosterIds?: unknown; lastStartAt?: unknown }
    if (m.warned && typeof m.warned === 'object') {
      for (const [rosterId, level] of Object.entries(m.warned)) if (level === 'danger' || level === 'chopped') raise(rosterId, level)
    } else if (Array.isArray(m.rosterIds)) {
      for (const rosterId of m.rosterIds) if (typeof rosterId === 'string') raise(rosterId, 'chopped')
    }
    if (typeof m.lastStartAt === 'string' && !Number.isNaN(Date.parse(m.lastStartAt))) lastStartAt = new Date(m.lastStartAt)
  }
  return { any: rows.length > 0, levels, lastStartAt }
}

/**
 * Warn the teams the chop would take — and the ones just above it — inside the last day before the
 * week's final game. "If the week ended now": the standings can still move, which is the point.
 *
 * 🛑 A WARNING SENT ONCE WENT STALE. The first version looked once and stopped, so a team that was
 * safe at that moment and slipped into the chop zone afterwards heard nothing until it was chopped.
 * The standings are now looked at again every CHOP_ZONE_RECHECK_MS inside the window, and a team is
 * warned again only when its level gets WORSE (none → danger → chop zone). So a team hears at most two
 * warnings a week; one already warned it is in the chop zone hears nothing more, and a team that
 * climbs out is not pinged.
 *
 * ⚠ THE THROTTLE IS A LOCK NOBODY RELEASES. Each look takes a lock held for CHOP_ZONE_RECHECK_MS and
 * never released, so two worker replicas and five-minute ticks look once per half hour between them.
 * Each send is recorded (a league event naming the levels) BEFORE it goes out, so a crash mid-loop
 * cannot send the same level twice.
 *
 * Called by score-sync for a guillotine league whose next chop week is the week being played.
 */
export async function sendChopZoneWarnings(
  input: { leagueId: string; seasonId: string; sport: string; season: number; week: number },
  deps: ChopZoneWarningDeps = {},
): Promise<{ outcome: ChopZoneWarningOutcome; warned?: number }> {
  const now = deps.now?.() ?? new Date()
  const key = `${input.season}:w${input.week}`
  const before = await warnedSoFar(input.leagueId, key)

  // After the first pass the week's last game start is on the event: no schedule read per tick.
  const lastStart = before.lastStartAt ?? (await (deps.lastGameStart ?? defaultLastGameStart)({ sport: input.sport, season: input.season, week: input.week, now }))
  if (!lastStart) return { outcome: 'schedule_unknown' }
  if (now.getTime() < lastStart.getTime() - CHOP_ZONE_WARNING_LEAD_MS) return { outcome: 'too_early' }
  // Once the last game has started there is nothing left to change; the chop alert follows.
  if (now.getTime() >= lastStart.getTime()) return { outcome: 'too_late' }

  const lock = await acquireAutomationLock(`guillotine-chop-zone-check:${input.leagueId}:${key}`, {
    ttlMs: CHOP_ZONE_RECHECK_MS,
    owner: `chop-zone-warning:${input.seasonId}:${now.getTime()}`,
  })
  if (!lock.ok) return { outcome: 'throttled' }

  const preview = await (deps.loadPreview ?? loadChopPreview)(input.leagueId)
  if ('error' in preview || preview.outcome !== 'chop') return { outcome: 'no_chop_this_week' }
  // The preview chooses its own week; warn only about the week being played.
  if (preview.week !== input.week) return { outcome: 'week_mismatch' }
  // The real chop would refuse to run; a warning about it would be about a chop that is not coming.
  if (preview.blockers.length > 0) return { outcome: 'blocked' }
  // Nobody has scored: the feed is behind, and "you're last" would be a coin flip.
  if (!preview.rows.some((row) => row.points > 0)) return { outcome: 'no_scores' }

  // Re-read under the lock: a replica that looked a moment ago may have just sent.
  const sent = (await warnedSoFar(input.leagueId, key)).levels
  const targets = preview.rows.flatMap((row) => {
    if (row.status !== 'chopped' && row.status !== 'danger') return []
    const level: WarnLevel = row.status
    const prior = sent.get(row.rosterId)
    return prior && LEVEL_RANK[prior] >= LEVEL_RANK[level] ? [] : [{ row, level, late: before.any }]
  })
  if (targets.length === 0) return { outcome: 'no_change' }

  const owners = await usersByRoster(input.leagueId, targets.map((t) => t.row.rosterId))
  const name = await leagueName(input.leagueId)
  const bestBall = await leagueSetsLineups(input.leagueId).catch(() => false)
  // Recorded before sending: a second replica (or a crash mid-loop) must not send these levels again.
  await appendEvent(input.leagueId, WARNING_EVENT, {
    key,
    week: input.week,
    season: input.season,
    lastStartAt: lastStart.toISOString(),
    warned: Object.fromEntries(targets.map((t) => [t.row.rosterId, t.level])),
  })

  const dispatch = deps.dispatch ?? defaultDispatch
  let warned = 0
  for (const { row, level, late } of targets) {
    const userId = owners.get(row.rosterId)
    if (!userId) continue
    const alert = chopZoneWarning({ leagueName: name, week: input.week, status: level, margin: row.margin, late, bestBall })
    try {
      await dispatch({
        userIds: [userId],
        category: 'matchup_results',
        type: level === 'chopped' ? 'guillotine_chop_zone' : 'guillotine_danger_zone',
        title: alert.title,
        body: alert.body,
        severity: alert.severity,
        actionHref: `/league/${input.leagueId}`,
        actionLabel: bestBall ? 'Open league' : 'Set lineup',
        leagueId: input.leagueId,
        meta: { guillotineWeek: input.week, points: row.points, margin: row.margin, late },
        // Per level: a danger warning and a later chop-zone one are two alerts, not one deduped away.
        dedupePrefix: `guillotine-chop-zone:${input.leagueId}:${input.season}:w${input.week}:${level}`,
      })
      warned += 1
    } catch (error) {
      console.warn('[guillotine] chop-zone warning not sent', { leagueId: input.leagueId, week: input.week, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { outcome: 'sent', warned }
}

/** score-sync's entry: the season row names the league, sport and year. */
export async function sendChopZoneWarningsForSeason(
  input: { seasonId: string; week: number },
  deps: ChopZoneWarningDeps = {},
): Promise<{ outcome: ChopZoneWarningOutcome | 'season_not_found'; warned?: number }> {
  const season = await prisma.redraftSeason.findUnique({
    where: { id: input.seasonId },
    select: { leagueId: true, sport: true, season: true },
  })
  if (!season) return { outcome: 'season_not_found' }
  return sendChopZoneWarnings({ leagueId: season.leagueId, seasonId: input.seasonId, sport: season.sport, season: season.season, week: input.week }, deps)
}
