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
  /** English sentence — the fallback, and what the tests read. */
  message: string
  /** i18n key for `message`; render with `tInterpolate(messageKey, messageVars)`. */
  messageKey: string
  messageVars: Record<string, string>
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

  /* Channel names and reasons are machine values; only the sentence around them is translated. */
  const channelList = channels.join(', ')
  const reasonList = blocked.join(', ')

  if (channels.length === 0) {
    return blocked.length > 0
      ? {
          tone: 'info',
          message: `No test sent. Blocked by: ${reasonList}.`,
          messageKey: 'settings.notifications.testBlocked',
          messageVars: { reasons: reasonList },
        }
      : {
          tone: 'info',
          message: 'No test sent. Check your current category and delivery settings.',
          messageKey: 'settings.notifications.testNoneSent',
          messageVars: {},
        }
  }

  if (blocked.length === 0) {
    return {
      tone: 'success',
      message: `Test sent via ${channelList}.`,
      messageKey: 'settings.notifications.testSentVia',
      messageVars: { channels: channelList },
    }
  }

  return {
    tone: 'info',
    message: `Test sent via ${channelList}. Not sent on: ${reasonList}.`,
    messageKey: 'settings.notifications.testSentPartial',
    messageVars: { channels: channelList, reasons: reasonList },
  }
}
