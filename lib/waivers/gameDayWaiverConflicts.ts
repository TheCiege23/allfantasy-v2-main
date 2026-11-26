/**
 * Game days the league's per-day waiver schedule leaves without a free-agent window (owner, 2026-11-26):
 * "there was a game today but the waivers to FA was not included … so users didn't get the chance".
 *
 * A day CONFLICTS when real games are played on it (league-local calendar day) and a manager cannot add a
 * free agent before that day's first kickoff:
 *   - `locked`                                 — no adds at all;
 *   - `waivers` / `rolling` / `reverse_standings` / `faab` — claims only, no free agents that day;
 *   - `waivers_then_fa` whose processing hour is at or after the first kickoff — free agency opens too late.
 * `free_agents` never conflicts. Pure: the service (gameDayWaiverConflictService.ts) does the reads.
 */
import {
  WAIVER_DAY_KEYS,
  type DailyWaiverMode,
  type DailyWaiverSchedule,
  type WaiverDayKey,
} from './dailyWaiverSchedule'
import { safeTimeZone } from './leagueLocalWaiverClock'

export type GameDayConflict = {
  day: WaiverDayKey
  /** League-local calendar date, 'YYYY-MM-DD'. */
  date: string
  mode: DailyWaiverMode
  /** The first kickoff that day, as an instant. */
  firstKickoff: Date
  gameCount: number
  reason: 'locked' | 'claims_only' | 'free_agency_opens_after_kickoff'
}

const DAY_NAME: Record<WaiverDayKey, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
}

export function waiverDayName(day: WaiverDayKey): string {
  return DAY_NAME[day]
}

function localDayAndHour(at: Date, timeZone: string): { date: string; day: WaiverDayKey; hourMinutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const weekday = get('weekday').toLowerCase().slice(0, 3)
  const day = ((WAIVER_DAY_KEYS as readonly string[]).includes(weekday) ? weekday : 'mon') as WaiverDayKey
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    day,
    hourMinutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
  }
}

/**
 * Conflicts among `gameStarts` (any order). Only games after `now` count — a game already played can no
 * longer be fixed, and the check runs ahead of time so the commissioner can fix the next one.
 */
export function findGameDayWaiverConflicts(input: {
  schedule: DailyWaiverSchedule | null | undefined
  timeZone: string | null | undefined
  gameStarts: Array<Date | null | undefined>
  now: Date
}): GameDayConflict[] {
  const schedule = input.schedule
  if (!schedule?.enabled) return []
  const tz = safeTimeZone(input.timeZone)
  const byDate = new Map<string, { day: WaiverDayKey; first: Date; firstMinutes: number; count: number }>()
  for (const start of input.gameStarts) {
    if (!(start instanceof Date) || !Number.isFinite(start.getTime()) || start.getTime() <= input.now.getTime()) continue
    const local = localDayAndHour(start, tz)
    const seen = byDate.get(local.date)
    if (!seen) byDate.set(local.date, { day: local.day, first: start, firstMinutes: local.hourMinutes, count: 1 })
    else {
      seen.count += 1
      if (start.getTime() < seen.first.getTime()) {
        seen.first = start
        seen.firstMinutes = local.hourMinutes
      }
    }
  }
  const out: GameDayConflict[] = []
  for (const [date, g] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const mode = schedule.days[g.day]
    let reason: GameDayConflict['reason'] | null = null
    if (mode === 'locked') reason = 'locked'
    else if (mode === 'waivers' || mode === 'rolling' || mode === 'reverse_standings' || mode === 'faab') reason = 'claims_only'
    else if (mode === 'waivers_then_fa' && schedule.processHour * 60 >= g.firstMinutes) reason = 'free_agency_opens_after_kickoff'
    if (reason) out.push({ day: g.day, date, mode, firstKickoff: g.first, gameCount: g.count, reason })
  }
  return out
}

/** One plain sentence for the commissioner. */
export function describeGameDayConflict(c: GameDayConflict, timeZone: string | null | undefined): string {
  const name = DAY_NAME[c.day]
  const kickoff = new Intl.DateTimeFormat('en-US', { timeZone: safeTimeZone(timeZone), hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(c.firstKickoff)
  const games = c.gameCount === 1 ? '1 game' : `${c.gameCount} games`
  if (c.reason === 'locked') return `${name} (${c.date}) has ${games} from ${kickoff}, but your schedule locks all moves that day, so managers can't pick anyone up before kickoff.`
  if (c.reason === 'claims_only') return `${name} (${c.date}) has ${games} from ${kickoff}, but it is a waivers-only day, so managers can't add a free agent before kickoff.`
  return `${name} (${c.date}) has ${games} from ${kickoff}, but waivers clear after that, so free agency opens too late for those games.`
}
