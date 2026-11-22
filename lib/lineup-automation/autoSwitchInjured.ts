/**
 * "Auto-switch injured starters" — the commissioner's per-team switch on Member Settings (owner's page
 * review #18, built 2026-11-18). With it on, the hourly run swaps a starter who may not play for the best
 * bench player who can fill his slot, inside the timing window the commissioner chose.
 *
 * Owner decisions this encodes (2026-11-18):
 *  - THE DEFAULT IS "OUT ONLY". The 2026-10-02 rule (lib/autocoach/autoCoachPreferences.ts) — swap only a
 *    player who is definitely not playing — stays the default. "Doubtful or worse" and "Questionable or
 *    worse" are there for a commissioner who chooses them knowingly. Probable is never a reason.
 *  - THE COMMISSIONER SWITCHES IT ON; THE MANAGER IS TOLD AND CAN SWITCH IT OFF for their own team.
 *  - IT RUNS ONLY WHILE THE TEAM'S OWNER HAS PRO (`pro_autocoach`), checked at run time.
 *
 * ONLY THE INJURED STARTERS MOVE, the same "hold everyone else" technique as the bye bench
 * (./autoBenchByePolicy.ts): it is not "optimize my lineup". A bench player who is himself at or past the
 * chosen level is never brought in, and a player whose game has started is never moved.
 *
 * The setting lives on the team (`Roster.settings.auto_switch_injured`) with the owner it was switched on
 * for, and counts only while that owner still has the team: a new owner does not inherit it.
 *
 * Pure.
 */
import type { ExpandedStarterSlot } from '@/lib/league/lineup-expand-template'
import type { LineupPlayerInfo } from '@/lib/league/native/nativeScreenModels'
import { buildLineupListsFromPlayerData } from '@/lib/league/lineup-swap'
import { planBestLineup, type LineupPlan } from '@/lib/inactive-manager/inactiveManagerMode'
import { isRuledOut } from '@/lib/core-app/injuryStatus'

export const AUTO_SWITCH_INJURED_KEY = 'auto_switch_injured'

export const AUTO_SWITCH_LEVELS = ['out', 'doubtful', 'questionable'] as const
export type AutoSwitchLevel = (typeof AUTO_SWITCH_LEVELS)[number]
export const DEFAULT_AUTO_SWITCH_LEVEL: AutoSwitchLevel = 'out'

/** `pregame_90`: in the last 90 minutes before his game (NFL inactives land then). `night_before`: from 8pm Eastern the night before. */
export const AUTO_SWITCH_TIMINGS = ['pregame_90', 'night_before'] as const
export type AutoSwitchTiming = (typeof AUTO_SWITCH_TIMINGS)[number]
export const DEFAULT_AUTO_SWITCH_TIMING: AutoSwitchTiming = 'pregame_90'

export const PREGAME_WINDOW_MS = 90 * 60_000

export type AutoSwitchInjuredSetting = {
  on: true
  level: AutoSwitchLevel
  timing: AutoSwitchTiming
  /** The commissioner who switched it on. */
  byUserId: string
  /** The team's owner when it was switched on. */
  ownerUserId: string
  since: string
}

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export const isAutoSwitchLevel = (v: unknown): v is AutoSwitchLevel => typeof v === 'string' && (AUTO_SWITCH_LEVELS as readonly string[]).includes(v)
export const isAutoSwitchTiming = (v: unknown): v is AutoSwitchTiming => typeof v === 'string' && (AUTO_SWITCH_TIMINGS as readonly string[]).includes(v)

/** The stored setting, or null when it is off or malformed. */
export function readAutoSwitchInjured(rosterSettings: unknown): AutoSwitchInjuredSetting | null {
  const s = asRecord(asRecord(rosterSettings)[AUTO_SWITCH_INJURED_KEY])
  if (s.on !== true || typeof s.byUserId !== 'string' || typeof s.ownerUserId !== 'string' || typeof s.since !== 'string') return null
  return {
    on: true,
    level: isAutoSwitchLevel(s.level) ? s.level : DEFAULT_AUTO_SWITCH_LEVEL,
    timing: isAutoSwitchTiming(s.timing) ? s.timing : DEFAULT_AUTO_SWITCH_TIMING,
    byUserId: s.byUserId,
    ownerUserId: s.ownerUserId,
    since: s.since,
  }
}

/** The setting, only while the team's current owner is the one it was switched on for. */
export function autoSwitchInjuredFor(rosterSettings: unknown, currentOwnerId: string | null | undefined): AutoSwitchInjuredSetting | null {
  const s = readAutoSwitchInjured(rosterSettings)
  return s && currentOwnerId && s.ownerUserId === currentOwnerId ? s : null
}

/** The team's settings with the switch set (or removed, for `null`), every other key kept. */
export function withAutoSwitchInjured(rosterSettings: unknown, value: AutoSwitchInjuredSetting | null): Record<string, unknown> {
  const next = { ...asRecord(rosterSettings) }
  if (value) next[AUTO_SWITCH_INJURED_KEY] = value
  else delete next[AUTO_SWITCH_INJURED_KEY]
  return next
}

/** A request body's `{ on, level?, timing? }`, checked. Level and timing fall back to the defaults. */
export function parseAutoSwitchInput(input: unknown): { ok: true; on: boolean; level: AutoSwitchLevel; timing: AutoSwitchTiming } | { ok: false; error: string } {
  const o = asRecord(input)
  if (typeof o.on !== 'boolean') return { ok: false, error: 'Send on: true or false.' }
  if (o.level !== undefined && !isAutoSwitchLevel(o.level)) return { ok: false, error: 'Level must be out, doubtful or questionable.' }
  if (o.timing !== undefined && !isAutoSwitchTiming(o.timing)) return { ok: false, error: 'Timing must be pregame_90 or night_before.' }
  return {
    ok: true,
    on: o.on,
    level: isAutoSwitchLevel(o.level) ? o.level : DEFAULT_AUTO_SWITCH_LEVEL,
    timing: isAutoSwitchTiming(o.timing) ? o.timing : DEFAULT_AUTO_SWITCH_TIMING,
  }
}

function words(status: string): string[] {
  return status.toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
}

/**
 * Whether a status is at or past the chosen level. `out` is exactly `isRuledOut` — the one honest zero
 * the rest of the app already uses. Doubtful and questionable add the game-day words on top. Probable,
 * and an empty status, never count.
 */
export function statusMeetsLevel(status: string | null | undefined, level: AutoSwitchLevel): boolean {
  if (!status) return false
  if (isRuledOut(status)) return true
  if (level === 'out') return false
  const w = words(status)
  if (w.includes('doubtful')) return true
  if (level === 'doubtful') return false
  const joined = w.join(' ')
  return w.includes('questionable') || w.includes('gtd') || w.includes('dtd') || joined.includes('game time') || joined.includes('day to day')
}

/** 8pm America/New_York on the Eastern calendar day before `kickoff`. */
export function nightBeforeStart(kickoff: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(kickoff)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  // Noon UTC on the Eastern date, one day earlier: safely inside that Eastern day whatever the offset.
  const dayBefore = new Date(Date.UTC(get('year'), get('month') - 1, get('day') - 1, 12))
  const offsetMinutes = easternOffsetMinutes(dayBefore)
  return new Date(Date.UTC(dayBefore.getUTCFullYear(), dayBefore.getUTCMonth(), dayBefore.getUTCDate(), 20, 0) - offsetMinutes * 60_000)
}

/** Eastern time's offset from UTC at `at`, in minutes (-240 in summer, -300 in winter). */
function easternOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'))
  return Math.round((asUtc - at.getTime()) / 60_000)
}

/**
 * Whether now is inside the window to switch a starter whose game kicks off at `kickoff`. An unknown
 * kickoff is never inside it — acting on a schedule we cannot see is guessing — and a game that has
 * started is past it.
 */
export function inSwitchWindow(kickoff: Date | null | undefined, now: Date, timing: AutoSwitchTiming): boolean {
  if (!kickoff || Number.isNaN(kickoff.getTime())) return false
  const until = kickoff.getTime() - now.getTime()
  if (until <= 0) return false
  if (timing === 'pregame_90') return until <= PREGAME_WINDOW_MS
  return now.getTime() >= nightBeforeStart(kickoff).getTime()
}

/**
 * The lineup with each due injured starter swapped for the best bench player who can fill his slot, or
 * why not. `injured` names players at or past the level; `due` names starters inside their window;
 * `isLocked` names players whose game has started.
 */
export function planAutoSwitchInjured(args: {
  slots: ExpandedStarterSlot[]
  playerData: unknown
  players: Record<string, LineupPlayerInfo | undefined>
  isLocked: (playerId: string) => boolean
  injured: (playerId: string) => boolean
  due: (playerId: string) => boolean
}): LineupPlan | { kind: 'skip'; reason: 'no_injured_starters' } {
  const starters = buildLineupListsFromPlayerData(args.playerData, args.slots.length).starters.filter(Boolean)
  const targets = new Set(starters.filter((id) => args.injured(id) && args.due(id) && !args.isLocked(id)))
  if (targets.size === 0) return { kind: 'skip', reason: 'no_injured_starters' }
  // Every other starter stays put, and an injured bench player is never brought in: swapping one
  // doubtful player for another is not a fix, it is a surprise.
  const hold = (id: string) => args.isLocked(id) || (starters.includes(id) ? !targets.has(id) : args.injured(id))
  return planBestLineup({ slots: args.slots, playerData: args.playerData, players: args.players, isLocked: hold, onBye: args.injured })
}
