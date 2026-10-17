/**
 * The injury sweep's FINAL CALL text (2026-10-17, owner-approved once the A2P 10DLC sender cleared):
 * within ~3h of lock, a starter still ruled out and still in the lineup gets one SMS. The dispatcher
 * owns consent, the SMS switch, quiet hours and the daily cap; this owns the on/off switch and words.
 *
 * Pure, so the copy and the switch are testable without the sweep.
 */

/** `INJURY_ALERTS_SMS=off` (or `0` / `false`) turns the final-call text off without a deploy. */
export function injurySmsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.INJURY_ALERTS_SMS?.trim().toLowerCase()
  return !(v === 'off' || v === '0' || v === 'false')
}

/**
 * "Final call: Jeremiyah Love is out and still starting. Guillotine League 26: start Tyler Allgeier.
 * Fix: https://…". The dispatcher slices to 320 characters and Twilio appends the brand and STOP
 * line, so the link goes before the body is trimmed — a text that loses its fix link is just noise.
 */
export const FINAL_CALL_SMS_MAX = 300

export function finalCallSms(copy: { title: string; body: string }, fixUrl: string): string {
  const head = `Final call: ${copy.title.replace(/[.\s]+$/, '')}.`
  const tail = ` Fix: ${fixUrl}`
  const room = FINAL_CALL_SMS_MAX - head.length - tail.length
  if (room <= 1) return `${head}${tail}`.slice(0, FINAL_CALL_SMS_MAX)
  const body = copy.body.trim()
  const middle = body ? ` ${body.length > room - 1 ? `${body.slice(0, room - 2).trimEnd()}…` : body}` : ''
  return `${head}${middle}${tail}`
}
