/**
 * Where a weekly Chimmy message's link says it came from — so we can tell whether the messages
 * bring anyone in (owner's call 2026-09-24: "track whether these emails bring people in").
 *
 * The tag rides the link as `from=`; the /chimmy/chat page reads it back and records the open as
 * an `alert_clicked` personalization event. Only a value in this list is recorded — the parameter
 * is in a URL anyone can type, so anything else is ignored rather than stored.
 *
 * Pure: imported by the renderers (server), the page (server) and tests.
 */

export const PROACTIVE_FROM = [
  /** In the bell or on the phone. */
  'lineup_check',
  /** In the email. */
  'lineup_check_email',
  'waiver_check',
  'waiver_check_email',
] as const

export type ProactiveFrom = (typeof PROACTIVE_FROM)[number]

export function readProactiveFrom(value: unknown): ProactiveFrom | null {
  return typeof value === 'string' && (PROACTIVE_FROM as readonly string[]).includes(value)
    ? (value as ProactiveFrom)
    : null
}

/** Which check a tag belongs to, and through which channel it was opened. */
export function describeProactiveFrom(from: ProactiveFrom): { alert: 'lineup_check' | 'waiver_check'; channel: 'email' | 'app' } {
  return {
    alert: from.startsWith('waiver') ? 'waiver_check' : 'lineup_check',
    channel: from.endsWith('_email') ? 'email' : 'app',
  }
}

/** Opens Chimmy in that league with the question already typed — one tap to send — and the tag. */
export function chimmyChatHref(args: { prompt: string; leagueId: string; from: ProactiveFrom }): string {
  const q = new URLSearchParams({ prompt: args.prompt, leagueId: args.leagueId, sport: 'NFL', from: args.from })
  return `/chimmy/chat?${q.toString()}`
}
