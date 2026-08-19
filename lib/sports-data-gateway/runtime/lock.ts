/**
 * Fantasy OS Phase 5C — canonical lineup lock safety (pure, Part 6).
 *
 * Derives lock status from CANONICAL game time + status only — never from injury. This does NOT replace the
 * existing lineup-lock authority (`lib/roster-lineup-engine/lineupLockService.ts`); it supplies a
 * provider-neutral lock FACT for the decision path. Fails closed: missing/stale/ambiguous game data ⇒ unknown,
 * and auto-switching is blocked whenever lock status is not a confident `unlocked`.
 */
export type LockStatus = 'unlocked' | 'locked' | 'unknown'

const FINAL = new Set(['final', 'complete', 'closed', 'completed'])
const AMBIGUOUS = new Set(['postponed', 'suspended', 'canceled', 'cancelled', 'delayed'])

export function normalizeGameStatus(raw: string | null): 'scheduled' | 'live' | 'final' | 'ambiguous' | 'unknown' {
  if (!raw) return 'unknown'
  const s = raw.toLowerCase()
  if (FINAL.has(s)) return 'final'
  if (AMBIGUOUS.has(s)) return 'ambiguous'
  if (s === 'in_progress' || s === 'live' || s === 'inprogress') return 'live'
  if (s === 'scheduled' || s === 'pre_game' || s === 'pregame' || s === 'upcoming') return 'scheduled'
  return 'unknown'
}

/**
 * Lock status from canonical game time + status.
 *  - null scheduledStart ⇒ unknown (missing schedule).
 *  - final ⇒ locked (permanently).
 *  - postponed/suspended/canceled ⇒ unknown (explicit; never auto-switch on ambiguous games).
 *  - live ⇒ locked.
 *  - scheduled: locked when now >= start + lockOffset (exactly-at-start is locked); else unlocked.
 * Injury status is intentionally NOT a parameter — it can never unlock a player.
 */
export function computeLockStatus(input: {
  scheduledStart: string | null
  gameStatus: string | null
  now: Date
  lockOffsetMinutes?: number
}): LockStatus {
  const status = normalizeGameStatus(input.gameStatus)
  if (status === 'final') return 'locked'
  if (status === 'ambiguous') return 'unknown'
  if (status === 'live') return 'locked'
  if (!input.scheduledStart) return 'unknown'
  const start = new Date(input.scheduledStart).getTime()
  if (Number.isNaN(start)) return 'unknown'
  const lockAt = start + (input.lockOffsetMinutes ?? 0) * 60000
  return input.now.getTime() >= lockAt ? 'locked' : 'unlocked'
}

/**
 * Auto-switch is permitted ONLY when the player is confidently unlocked AND the schedule data is fresh.
 * Any uncertainty (unknown lock, stale schedule) fails closed → no automatic lineup movement.
 */
export function canAutoSwitch(lockStatus: LockStatus, scheduleFresh: boolean): boolean {
  return lockStatus === 'unlocked' && scheduleFresh
}
