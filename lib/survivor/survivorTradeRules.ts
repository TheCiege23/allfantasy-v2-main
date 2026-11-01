/**
 * Survivor trade rules — pure, no I/O. The original league's rules:
 *
 *   - cross-tribe trades only in a weekly window (after Tribal Council until a set day/time), or banned;
 *   - within a tribe, trades any time for players who have not played yet that week;
 *   - a player who has played cannot be traded until after that week's Tribal Council;
 *   - an optional weekly freeze ("trades lock at midnight") that lifts after Tribal Council.
 *
 * THE SURVIVOR WEEK STARTS AT THE TORCH CEREMONY. Every window is measured from the league's Tribal
 * Council day and time (US Eastern), so "until after Tribal" is the same instant everywhere. After the
 * merge everyone is one tribe, so only the played-player lock and the freeze still apply.
 *
 * A "free trade" token (or any other effect) can bypass the tribe and played-player rules through
 * `bypass`; the commissioner's freeze is never bypassed. See survivorTradeRuleBypass.ts.
 */
import type { SurvivorCrossTribeWindow, SurvivorGovernanceDay, SurvivorGovernanceSettings } from './survivorGovernanceSettings'

const WEEK_MINUTES = 7 * 24 * 60
const DAY_INDEX: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 }
const SHORT_DAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

const easternParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** Minutes since Sunday 00:00, US Eastern. */
export function easternWeekMinute(instant: Date): number {
  const parts = easternParts.formatToParts(instant)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const day = SHORT_DAY[get('weekday')] ?? 0
  const hour = Number(get('hour')) % 24
  const minute = Number(get('minute'))
  return day * 1440 + hour * 60 + minute
}

export function weekMinuteOf(day: string, hhmm: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm)
  const minutes = match ? Number(match[1]) * 60 + Number(match[2]) : 0
  return (DAY_INDEX[day] ?? 0) * 1440 + minutes
}

/** Minutes since the most recent Torch Ceremony (the Survivor week's start), 0 ≤ n < one week. */
export function minutesSinceTribal(now: Date, tribalDay: string, tribalTime: string): number {
  return (easternWeekMinute(now) - weekMinuteOf(tribalDay, tribalTime) + WEEK_MINUTES) % WEEK_MINUTES
}

/** Where a weekly day/time falls in the Survivor week, in minutes after the Torch Ceremony. */
export function pointInSurvivorWeek(day: string, hhmm: string, tribalDay: string, tribalTime: string): number {
  return (weekMinuteOf(day, hhmm) - weekMinuteOf(tribalDay, tribalTime) + WEEK_MINUTES) % WEEK_MINUTES
}

export interface SurvivorTradeClock {
  tribalDay: string
  tribalTime: string
  now: Date
}

export interface SurvivorTradeWindowStatus {
  /** Cross-tribe trades: allowed now (always true in `allowed` mode or after the merge). */
  crossTribeOpen: boolean
  /** `window` mode while open: when the window closes. */
  crossTribeClosesAt: Date | null
  /** `window` mode while open: WHICH window is open (1-based of `count`) and its weekly close, so copy can name it. */
  crossTribeWindow?: { index: number; count: number; closeDay: string; closeTime: string } | null
  /** `window` mode while closed: when the next window opens (null when it opens after Tribal Council). */
  crossTribeOpensAt?: Date | null
  /** The weekly freeze is in force now. */
  frozen: boolean
  /** Freeze on and not yet in force: when it starts. */
  freezeStartsAt: Date | null
  /** The next Torch Ceremony: when the freeze, the window and the played-player lock reset. */
  nextTribalAt: Date
}

function at(now: Date, minutesFromNow: number): Date {
  const base = new Date(now.getTime())
  base.setUTCSeconds(0, 0)
  return new Date(base.getTime() + minutesFromNow * 60_000)
}

/** A window's [open, close) in minutes after the Torch Ceremony. `open > close` wraps past the next Tribal. */
export function crossTribeWindowSpan(w: SurvivorCrossTribeWindow, tribalDay: string, tribalTime: string): { open: number; close: number } {
  const close = pointInSurvivorWeek(w.closeDay, w.closeTime, tribalDay, tribalTime)
  const open = w.opensOn === 'time' && w.openDay && w.openTime ? pointInSurvivorWeek(w.openDay, w.openTime, tribalDay, tribalTime) : 0
  return { open, close }
}

function insideSpan(since: number, span: { open: number; close: number }): boolean {
  if (span.open === span.close) return false
  return span.open < span.close ? since >= span.open && since < span.close : since >= span.open || since < span.close
}

/**
 * Where the week's cross-tribe windows stand now. A trade is open when ANY window is; when two windows
 * overlap, the one closing latest is the one reported. Pure, minutes after the Torch Ceremony.
 */
export function crossTribeWindowsNow(windows: readonly SurvivorCrossTribeWindow[], since: number, tribalDay: string, tribalTime: string) {
  let open: { index: number; closesIn: number; window: SurvivorCrossTribeWindow } | null = null
  let nextOpenIn: number | null = null
  let nextOpensAtTribal = false
  windows.forEach((w, i) => {
    const span = crossTribeWindowSpan(w, tribalDay, tribalTime)
    if (insideSpan(since, span)) {
      const closesIn = (span.close - since + WEEK_MINUTES) % WEEK_MINUTES
      if (!open || closesIn > open.closesIn) open = { index: i, closesIn, window: w }
    } else if (span.open !== span.close) {
      // A Tribal-opened window next opens at the next Torch Ceremony.
      const opensIn = w.opensOn === 'tribal' ? WEEK_MINUTES - since : (span.open - since + WEEK_MINUTES) % WEEK_MINUTES
      if (nextOpenIn == null || opensIn < nextOpenIn) {
        nextOpenIn = opensIn
        nextOpensAtTribal = w.opensOn === 'tribal'
      }
    }
  })
  return { open: open as { index: number; closesIn: number; window: SurvivorCrossTribeWindow } | null, nextOpenIn: nextOpenIn as number | null, nextOpensAtTribal }
}

export function survivorTradeWindowStatus(settings: SurvivorGovernanceSettings, clock: SurvivorTradeClock, merged = false): SurvivorTradeWindowStatus {
  const since = minutesSinceTribal(clock.now, clock.tribalDay, clock.tribalTime)
  const freeze = pointInSurvivorWeek(settings.weeklyTradeFreezeDay, settings.weeklyTradeFreezeTime, clock.tribalDay, clock.tribalTime)
  const windowMode = !merged && settings.crossTribeTrades === 'window'
  // Older callers may hand a settings object without windows: the single close is one Tribal-opened window.
  const windows = settings.crossTribeWindows?.length
    ? settings.crossTribeWindows
    : [{ opensOn: 'tribal' as const, closeDay: settings.crossTribeCloseDay, closeTime: settings.crossTribeCloseTime }]
  const now = windowMode ? crossTribeWindowsNow(windows, since, clock.tribalDay, clock.tribalTime) : null
  const crossTribeOpen = merged || settings.crossTribeTrades === 'allowed' || Boolean(now?.open)
  const frozen = settings.weeklyTradeFreezeEnabled && since >= freeze
  return {
    crossTribeOpen,
    crossTribeClosesAt: now?.open ? at(clock.now, now.open.closesIn) : null,
    crossTribeWindow: now?.open ? { index: now.open.index + 1, count: windows.length, closeDay: now.open.window.closeDay, closeTime: now.open.window.closeTime } : null,
    crossTribeOpensAt: now && !now.open && now.nextOpenIn != null && !now.nextOpensAtTribal ? at(clock.now, now.nextOpenIn) : null,
    frozen,
    freezeStartsAt: settings.weeklyTradeFreezeEnabled && !frozen ? at(clock.now, freeze - since) : null,
    nextTribalAt: at(clock.now, WEEK_MINUTES - since),
  }
}

export interface SurvivorTradePlayer {
  playerId: string
  playerName?: string | null
  fromRosterId: string
  /** The player's game this Survivor week has kicked off. Null: not known (treated as not played). */
  hasPlayed: boolean | null
}

export interface SurvivorTradeJudgeInput {
  settings: SurvivorGovernanceSettings
  clock: SurvivorTradeClock
  merged: boolean
  /** Every roster in the trade → its tribe id (null when it has none). */
  tribeByRoster: ReadonlyMap<string, string | null>
  players: readonly SurvivorTradePlayer[]
  /**
   * The played-player lock has lifted: this week's Tribal Council is over, or (a week with no council)
   * the week's last game is final — see `playedLockLifted`.
   */
  tribalDoneThisWeek: boolean
  /** A token or effect lets this trade skip the tribe and played-player rules. */
  bypass?: boolean
}

export type SurvivorTradeRefusalCode =
  | 'SURVIVOR_TRADE_FROZEN'
  | 'SURVIVOR_CROSS_TRIBE_BANNED'
  | 'SURVIVOR_CROSS_TRIBE_CLOSED'
  | 'SURVIVOR_PLAYED_LOCK'
  | 'SURVIVOR_TRIBE_UNKNOWN'

export type SurvivorTradeVerdict =
  | { ok: true; crossTribe: boolean; bypassed: boolean }
  | { ok: false; code: SurvivorTradeRefusalCode; playerName?: string | null }

/** Whether the trade's rosters sit in more than one tribe; null when a roster has no known tribe. */
export function tradeCrossesTribes(tribeByRoster: ReadonlyMap<string, string | null>): boolean | null {
  const tribes = [...tribeByRoster.values()]
  // No tribes at all (before tribes are drawn): nothing to cross.
  if (tribes.every((t) => !t)) return false
  if (tribes.some((t) => !t)) return null
  return new Set(tribes).size > 1
}

export function judgeSurvivorTrade(input: SurvivorTradeJudgeInput): SurvivorTradeVerdict {
  const s = input.settings
  if (!s.tradeRulesEnabled) return { ok: true, crossTribe: false, bypassed: false }
  const status = survivorTradeWindowStatus(s, input.clock, input.merged)
  // The commissioner's freeze binds everyone, token or not.
  if (status.frozen) return { ok: false, code: 'SURVIVOR_TRADE_FROZEN' }
  const crosses = input.merged ? false : tradeCrossesTribes(input.tribeByRoster)
  if (input.bypass) return { ok: true, crossTribe: Boolean(crosses), bypassed: true }
  if (crosses === null) {
    // Fail closed only where a tribe rule could bite; with cross-tribe trades allowed and no
    // played-player rule there is nothing to check.
    const tribeRuleApplies = s.crossTribeTrades !== 'allowed'
    if (tribeRuleApplies) return { ok: false, code: 'SURVIVOR_TRIBE_UNKNOWN' }
  }
  if (crosses) {
    if (s.crossTribeTrades === 'banned') return { ok: false, code: 'SURVIVOR_CROSS_TRIBE_BANNED' }
    if (s.crossTribeTrades === 'window' && !status.crossTribeOpen) return { ok: false, code: 'SURVIVOR_CROSS_TRIBE_CLOSED' }
  }
  const playedLock = crosses ? s.playedLockUntilTribal : (s.withinTribeUnplayedOnly || s.playedLockUntilTribal)
  if (playedLock && !input.tribalDoneThisWeek) {
    const played = input.players.find((p) => p.hasPlayed === true)
    if (played) return { ok: false, code: 'SURVIVOR_PLAYED_LOCK', playerName: played.playerName ?? played.playerId }
  }
  return { ok: true, crossTribe: Boolean(crosses), bypassed: false }
}

/**
 * WHEN THE PLAYED-PLAYER LOCK LIFTS. "A player who has played cannot be traded until after that week's
 * Tribal Council." In a week with NO council (a no-elimination week in the season plan) there is no
 * Tribal to wait for, so the lock lifts when the week's last game is final — read from our own
 * `SportsGame` rows — or, where those rows cannot say (no rows for the week, a daily sport whose rows
 * carry no week), when the Survivor week advances. Pure.
 */
export function playedLockLifted(input: { tribalDoneThisWeek: boolean; noCouncilThisWeek: boolean; weekGamesFinal: boolean | null }): boolean {
  if (input.tribalDoneThisWeek) return true
  return input.noCouncilThisWeek && input.weekGamesFinal === true
}

/**
 * Whether the week's LAST game is final, from stored game rows (any provider). Null when no row has a
 * kickoff. The latest kickoff is the week's last game; providers store one game under several rows
 * with kickoffs that can differ by minutes, so any row within 30 minutes of that kickoff reporting a
 * final counts. A stale or wrong row keeps the lock on (the old behaviour), never lifts it early.
 */
export function weekLastGameFinal(rows: ReadonlyArray<{ startTime: Date | null; status: string | null }>, now: Date, isFinal: (status: string | null) => boolean): boolean | null {
  const timed = rows.filter((r): r is { startTime: Date; status: string | null } => r.startTime instanceof Date)
  if (timed.length === 0) return null
  const last = Math.max(...timed.map((r) => r.startTime.getTime()))
  if (last > now.getTime()) return false
  return timed.some((r) => r.startTime.getTime() >= last - 30 * 60_000 && isFinal(r.status))
}

export function isSurvivorGovernanceDay(value: string): value is SurvivorGovernanceDay {
  return value in DAY_INDEX
}
