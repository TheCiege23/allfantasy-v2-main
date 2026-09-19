/**
 * What the settings screen should say after a test notification.
 *
 * 🛑 A PARTIAL SEND WAS REPORTED AS A CLEAN SUCCESS. The route answers `ok: true` when ANY
 * channel went, and the screen rendered only the channels that did — so asking for email and SMS
 * with an unverified phone said "Test sent via email." and never mentioned SMS at all. The route
 * had already said so: `blockedReasons` carried the reason, and nothing on the success path read
 * it.
 *
 * That is the exact failure this screen exists to reveal, hidden by the screen itself — and it is
 * worse than silence, because the reader now has positive confirmation that their test "worked".
 *
 * ⚠ PURE, AND IN ITS OWN MODULE, BECAUSE THE COMPONENT HAS NO RENDER HARNESS. The only existing
 * test that reaches `NotificationsSettingsSection` reads its SOURCE (`push-optin-reachable`), and
 * a source assertion cannot tell you what the sentence says. This can.
 */

export type TestNotificationTone = 'success' | 'info' | 'error'

export type TestNotificationOutcome = {
  tone: TestNotificationTone
  message: string
}

/**
 * `sent` is the route's per-channel map; `blockedReasons` is its list of machine reasons.
 *
 * ⚠ THE TONE DROPS TO `info` ON A PARTIAL SEND, DELIBERATELY. Green beside "Not sent on: …"
 * reads as "all good" at a glance, which is the impression that made the old message wrong in
 * the first place.
 */
export function describeTestNotificationResult(args: {
  sent: Record<string, boolean> | undefined
  blockedReasons: readonly string[] | undefined
}): TestNotificationOutcome {
  const channels = Object.entries(args.sent ?? {})
    .filter(([, sent]) => sent)
    .map(([name]) => name)
  const blocked = [...(args.blockedReasons ?? [])]

  if (channels.length === 0) {
    return {
      tone: 'info',
      message:
        blocked.length > 0
          ? `No test sent. Blocked by: ${blocked.join(', ')}.`
          : 'No test sent. Check your current category and delivery settings.',
    }
  }

  if (blocked.length === 0) {
    return { tone: 'success', message: `Test sent via ${channels.join(', ')}.` }
  }

  return {
    tone: 'info',
    message: `Test sent via ${channels.join(', ')}. Not sent on: ${blocked.join(', ')}.`,
  }
}
