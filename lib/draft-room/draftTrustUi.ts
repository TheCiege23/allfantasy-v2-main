/**
 * Phase 5H — small, testable helpers for draft-room trust UX (stale snapshots, authority errors).
 * No React imports; safe for unit tests and reuse in `DraftRoomPageClient`.
 */

/** When you're on the clock, warn if server snapshot `updatedAt` is older than this (ms). */
export const DRAFT_SNAPSHOT_STALE_WARN_ON_CLOCK_MS = 45_000

/** When viewing (not on clock), warn later — avoids noisy banners during slow polls. */
export const DRAFT_SNAPSHOT_STALE_WARN_VIEWER_MS = 120_000

export type SnapshotStaleInput = {
  status: string | null | undefined
  updatedAtIso: string | null | undefined
  nowMs: number
  isOnClock: boolean
}

export function shouldWarnStaleSnapshot(input: SnapshotStaleInput): boolean {
  const st = String(input.status ?? '').trim().toLowerCase()
  if (st !== 'in_progress') return false
  if (!input.updatedAtIso) return false
  const t = Date.parse(input.updatedAtIso)
  if (!Number.isFinite(t)) return false
  const age = Math.max(0, input.nowMs - t)
  const threshold = input.isOnClock ? DRAFT_SNAPSHOT_STALE_WARN_ON_CLOCK_MS : DRAFT_SNAPSHOT_STALE_WARN_VIEWER_MS
  return age >= threshold
}

export function snapshotAgeMs(updatedAtIso: string | null | undefined, nowMs: number): number | null {
  if (!updatedAtIso) return null
  const t = Date.parse(updatedAtIso)
  if (!Number.isFinite(t)) return null
  return Math.max(0, nowMs - t)
}

export function friendlyPickAuthorityMessage(code: string | null | undefined, serverError: string | null | undefined): string {
  const c = String(code ?? '').trim()
  if (c === 'DRAFT_PICK_STALE_OVERALL') {
    return 'The draft board moved before your pick landed. We refreshed your view — check the current pick and try again.'
  }
  if (c === 'DRAFT_PICK_RACE_RETRY') {
    return 'Another update hit the draft at the same moment. Tap your pick again in a second.'
  }
  if (c === 'DRAFT_PICK_NOT_ON_CLOCK') {
    return "You're no longer on the clock for that pick. The board may have advanced — check who's up now."
  }
  if (serverError && serverError.trim()) return serverError.trim()
  return 'Pick could not be saved. Try again or use Resync if the board looks off.'
}
