/**
 * The trade deadline as a countdown — "Trade deadline in 3d 4h", then "Trades closed". Pure, and
 * safe to import from a client component: it reads a verdict, it never computes one.
 *
 * THE VERDICT IS THE SERVER'S (`resolveTradeDeadlineStatus`). This only words it, so the chip on the
 * Trade Center can never say "open" about a trade the engine would refuse: `passed` decides
 * "closed", and nothing here re-derives it from the clock.
 *
 * WHAT CAN BE COUNTED DOWN. Only a close TIME is an instant. A week-only deadline closes when the
 * week roller moves past the deadline week, which happens when every matchup is final — hours to a
 * day after the last game, and not knowable in advance (see ./tradeDeadlineTime.ts). So a week-only
 * deadline is shown in weeks ("2 weeks left", "last week to trade"), never as a fake d/h figure.
 * With both set, the close time is shown: it is the one that can be stated exactly, and the engine
 * closes trades at whichever comes first.
 *
 * Out of season a deadline is stated, not counted ("Week 11"), because it does not bind then.
 */

export type TradeDeadlineCountdown =
  /** No deadline configured: trades stay open all season. Callers render nothing. */
  | { state: 'none' }
  | { state: 'closed'; by: 'week' | 'time' | null; deadlineWeek: number | null; closesAtIso: string | null }
  /** A close time ahead: count down to it. */
  | { state: 'counting'; closesAtIso: string; remainingMs: number; deadlineWeek: number | null }
  /** A week-only deadline in season. `weeksLeft` 0 = the deadline week is this week. */
  | { state: 'weeks'; deadlineWeek: number; currentWeek: number; weeksLeft: number }
  /** A deadline exists but no season is in progress, so it does not bind yet. */
  | { state: 'scheduled'; deadlineWeek: number | null; closesAtIso: string | null }

export type CountdownVerdictInput = {
  passed: boolean
  by: 'week' | 'time' | null
  deadlineWeek: number | null
  deadlineAt: Date | string | null
  window: { inSeason: boolean; week: number | null } | null
}

function toDate(value: Date | string | null): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function tradeDeadlineCountdown(verdict: CountdownVerdictInput, now: Date = new Date()): TradeDeadlineCountdown {
  const at = toDate(verdict.deadlineAt)
  const week = verdict.deadlineWeek
  if (week == null && !at) return { state: 'none' }
  if (verdict.passed) return { state: 'closed', by: verdict.by, deadlineWeek: week, closesAtIso: at?.toISOString() ?? null }
  const inSeason = verdict.window?.inSeason === true && verdict.window.week != null
  if (!inSeason) return { state: 'scheduled', deadlineWeek: week, closesAtIso: at?.toISOString() ?? null }
  if (at && at.getTime() > now.getTime()) {
    return { state: 'counting', closesAtIso: at.toISOString(), remainingMs: at.getTime() - now.getTime(), deadlineWeek: week }
  }
  if (week != null) {
    const currentWeek = verdict.window!.week!
    return { state: 'weeks', deadlineWeek: week, currentWeek, weeksLeft: Math.max(0, week - currentWeek) }
  }
  // A close time that is already behind us but the server has not called passed: trust the server.
  return { state: 'scheduled', deadlineWeek: week, closesAtIso: at?.toISOString() ?? null }
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** The parts of a remaining span, rounded down: never round a deadline later than it is. */
export function countdownParts(remainingMs: number): { days: number; hours: number; minutes: number } {
  const ms = Math.max(0, remainingMs)
  return { days: Math.floor(ms / DAY), hours: Math.floor((ms % DAY) / HOUR), minutes: Math.floor((ms % HOUR) / MINUTE) }
}

/** "3d 4h", "5h 12m", "45m", and "under 1m" for the last minute. */
export function formatCountdownSpan(remainingMs: number): string {
  const { days, hours, minutes } = countdownParts(remainingMs)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return 'under 1m'
}

/** The countdown in English — for notifications and server-rendered text. */
export function tradeDeadlineCountdownLabel(c: TradeDeadlineCountdown): string | null {
  switch (c.state) {
    case 'none':
      return null
    case 'closed':
      return 'Trades closed'
    case 'counting':
      return `Trade deadline in ${formatCountdownSpan(c.remainingMs)}`
    case 'weeks':
      if (c.weeksLeft === 0) return `Trade deadline: this is the last week (Week ${c.deadlineWeek})`
      return `Trade deadline after Week ${c.deadlineWeek} · ${c.weeksLeft} ${c.weeksLeft === 1 ? 'week' : 'weeks'} left`
    case 'scheduled':
      return c.deadlineWeek != null ? `Trade deadline: Week ${c.deadlineWeek}` : 'Trade deadline set'
  }
}
