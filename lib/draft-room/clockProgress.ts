/**
 * How much of the pick clock is left, as a 0–100 width for the bar under a timer. Null when there
 * is nothing honest to draw: an untimed draft, or no remaining time to compare against.
 *
 * Shared by the live room's top bar (DraftTopBar) and the mock room's header and phone clock bar,
 * so the two rooms cannot disagree about what a bar means.
 */
export function clockProgressPercent(remainingSeconds: number | null | undefined, totalSeconds: number | null | undefined): number | null {
  if (remainingSeconds == null || !totalSeconds || totalSeconds <= 0) return null
  return Math.max(0, Math.min(100, Math.round((remainingSeconds / totalSeconds) * 100)))
}
