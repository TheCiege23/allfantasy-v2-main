/**
 * "Bench my starters on bye automatically" — a free setting each manager turns on for their own team
 * (owner decision 2026-10-27, phase 6 of the self-running dynasty plan).
 *
 * The lineup screen already WARNS before lock when a starter is on bye (`startersOnBye`), but a manager
 * who never opens it scores zero from that slot. With this on, the hourly run swaps each starter whose
 * bye week is this week for the best bench player who can fill his slot.
 *
 * ONLY THE BYE STARTERS MOVE. Every other starter is held exactly where the manager put him — this is
 * not "optimize my lineup", it is "don't start a player who has no game". The replacement is chosen by
 * the autopilot planner (`planBestLineup`) with everyone else held, the same "hold" technique the
 * eliminated-team lineup minimums use: bench players are ranked by projection, a bench player also on
 * bye counts as zero, and a player whose game has started is never moved.
 *
 * The setting is stored on the team (`Roster.settings.auto_bench_bye`) WITH the user who turned it on,
 * and only counts while that user still owns the team — a new owner who takes the team over does not
 * inherit a choice they never made.
 *
 * Pure.
 */
import type { ExpandedStarterSlot } from '@/lib/league/lineup-expand-template'
import type { LineupPlayerInfo } from '@/lib/league/native/nativeScreenModels'
import { buildLineupListsFromPlayerData } from '@/lib/league/lineup-swap'
import { planBestLineup, type LineupPlan } from '@/lib/inactive-manager/inactiveManagerMode'

export const AUTO_BENCH_BYE_KEY = 'auto_bench_bye'

export type AutoBenchByeSetting = { on: boolean; byUserId: string; since: string }

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** True only when the team's current owner is the one who turned it on. */
export function autoBenchByeOn(rosterSettings: unknown, ownerUserId: string | null | undefined): boolean {
  const s = asRecord(asRecord(rosterSettings)[AUTO_BENCH_BYE_KEY])
  return s.on === true && typeof s.byUserId === 'string' && !!ownerUserId && s.byUserId === ownerUserId
}

/** The team's settings with the switch set, every other key kept. */
export function withAutoBenchBye(rosterSettings: unknown, on: boolean, byUserId: string, now: Date = new Date()): Record<string, unknown> {
  const next = { ...asRecord(rosterSettings) }
  if (on) next[AUTO_BENCH_BYE_KEY] = { on: true, byUserId, since: now.toISOString() } satisfies AutoBenchByeSetting
  else delete next[AUTO_BENCH_BYE_KEY]
  return next
}

/**
 * The lineup with each bye starter swapped for the best bench player who can fill his slot, or why
 * not. `onBye` names players whose bye week is this week; `isLocked` names players whose game has
 * started.
 */
export function planAutoBenchBye(args: {
  slots: ExpandedStarterSlot[]
  playerData: unknown
  players: Record<string, LineupPlayerInfo | undefined>
  isLocked: (playerId: string) => boolean
  onBye: (playerId: string) => boolean
}): LineupPlan | { kind: 'skip'; reason: 'no_bye_starters' } {
  const starters = buildLineupListsFromPlayerData(args.playerData, args.slots.length).starters.filter(Boolean)
  const byeStarters = new Set(starters.filter((id) => args.onBye(id) && !args.isLocked(id)))
  if (byeStarters.size === 0) return { kind: 'skip', reason: 'no_bye_starters' }
  // Everyone the manager started who is not on bye stays put, and a bench player also on bye is never
  // brought in: swapping one zero for another is not a fix, it is a surprise.
  const hold = (id: string) =>
    args.isLocked(id) || (starters.includes(id) ? !byeStarters.has(id) : args.onBye(id))
  return planBestLineup({ slots: args.slots, playerData: args.playerData, players: args.players, isLocked: hold, onBye: args.onBye })
}
