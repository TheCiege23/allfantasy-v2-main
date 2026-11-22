/**
 * Chimmy AI manager pick timing. No imports, so the draft room (a client component) can share the
 * same delay the server enforces; `chimmyManagerPick.ts` reaches the database-backed service.
 */

/**
 * How long a Chimmy-managed team "thinks" before picking. Long enough that the room sees who is on
 * the clock before the pick lands (and back-to-back turns at a snake's wall do not blur into one),
 * short enough not to stall the draft.
 */
export const CHIMMY_PICK_DELAY_MS = 4000

/**
 * Whether the pick has been on the clock long enough for Chimmy to take it. A pick with no running
 * timer (an untimed draft, or a server that never wrote `timerEndAt`) has no clock to measure, so
 * the room's own delay is the only pacing and the server does not add a second one.
 */
export function chimmyThinkingTimeElapsed(input: {
  timerSeconds: number | null | undefined
  timerEndAt: string | Date | null | undefined
  now: Date
  minDelayMs?: number
}): boolean {
  const minDelayMs = input.minDelayMs ?? CHIMMY_PICK_DELAY_MS
  if (!input.timerSeconds || input.timerSeconds <= 0 || !input.timerEndAt) return true
  const endMs = new Date(input.timerEndAt).getTime()
  if (!Number.isFinite(endMs)) return true
  const startedMs = endMs - input.timerSeconds * 1000
  // A small allowance for clock skew between the browser that waited and this server.
  return input.now.getTime() - startedMs >= minDelayMs - 500
}
