/**
 * How fresh the league data behind a Chimmy answer is, in words a manager reads at a glance.
 * PURE and CLIENT-SAFE (no imports): the chat panel renders it under every grounded answer.
 *
 * The footer used to print `synced 9/28/2026, 6:30:26 PM` — a timestamp the reader has to subtract
 * from the clock in their head, with nothing to say whether it is old enough to matter. On game day
 * it matters: a lineup fixed on the platform an hour ago is not in data synced three hours ago.
 *
 * ⚠ STALE IS A FIXED THRESHOLD, STATED HERE, NOT A GUESS ABOUT THE SCHEDULE. Three hours: longer than
 * the gaps the background lanes leave on a normal day, short enough that a Sunday morning answer
 * built on Saturday-night rosters is flagged. It only changes the wording and offers a refresh; it
 * never hides an answer.
 */

export const GROUNDING_STALE_MS = 3 * 60 * 60_000

export type GroundingFreshness = {
  /** "synced just now", "synced 12 min ago", "synced 3 hr ago", "synced 2 days ago", or "never synced". */
  label: string
  stale: boolean
}

export function groundingFreshness(lastSyncedAt: string | null | undefined, nowMs: number): GroundingFreshness {
  if (!lastSyncedAt) return { label: 'never synced', stale: true }
  const at = Date.parse(lastSyncedAt)
  if (!Number.isFinite(at)) return { label: 'sync time unknown', stale: true }
  // A clock a little ahead of the server's is "just now", not "in 2 minutes".
  const age = Math.max(0, nowMs - at)
  const min = Math.floor(age / 60_000)
  const label =
    min < 1
      ? 'synced just now'
      : min < 60
        ? `synced ${min} min ago`
        : min < 48 * 60
          ? `synced ${Math.floor(min / 60)} hr ago`
          : `synced ${Math.floor(min / (24 * 60))} days ago`
  return { label, stale: age >= GROUNDING_STALE_MS }
}
