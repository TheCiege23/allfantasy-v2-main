/**
 * The short line under a locked player's "Locked" pill on the Team screen.
 *
 * 🛑 THE ROW PRINTED THE WHOLE SERVER SENTENCE (owner report, 2026-11-24): "This player's first game of the
 * fantasy week has started; he is locked until the week ends." in a 180px column, wrapped to seven lines,
 * on every locked starter — a wall of identical text down the right edge of the lineup. The sentence stays
 * the reason (it is the toast when a locked player is moved, and the pill's tooltip and screen-reader
 * description); the row shows only what changes between rows: until when.
 *
 * The reasons come from lib/roster-lineup-engine/lineupLockService.ts and the screen's own fallbacks
 * (components/league/native/screens/NativeLineupScreen.tsx `lockReason`). An unrecognised reason gets a
 * neutral label rather than its full text.
 */
export function lockRowLabel(reason: string | null | undefined): string {
  const r = String(reason ?? '').toLowerCase()
  if (r.includes('until tomorrow')) return 'Until tomorrow'
  if (r.includes('until the week ends') || r.includes('for this scoring period')) return 'Until next week'
  if (r.includes('game') && r.includes('started')) return 'Game started'
  return 'For now'
}
