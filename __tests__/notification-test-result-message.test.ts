import { describe, expect, it } from 'vitest'

import { describeTestNotificationResult } from '@/lib/notification-settings/testResultMessage'

/*
 * 🛑 A PARTIAL SEND WAS REPORTED AS A CLEAN SUCCESS, ON THE SCREEN BUILT TO DIAGNOSE SENDING.
 *
 * `/api/user/notifications/test` answers `ok: true` when ANY channel went, and the settings
 * screen rendered only the channels that did. So asking for email and SMS with an unverified
 * phone produced a green "Test sent via email." and never mentioned SMS — even though the route
 * had put the reason in `blockedReasons` and the screen simply did not read them on that path.
 *
 * That is worse than saying nothing: the reader walks away with positive confirmation that their
 * SMS test "worked", which is the belief this screen exists to correct.
 *
 * ⚠ THE WORDING LIVES IN A PURE FUNCTION BECAUSE THE COMPONENT HAS NO RENDER HARNESS — the only
 * existing test that reaches `NotificationsSettingsSection` reads its SOURCE
 * (`push-optin-reachable.test.ts`), and a source assertion cannot tell you what the sentence says.
 */

describe('describeTestNotificationResult', () => {
  it('reports a clean success when every requested channel sent', () => {
    const out = describeTestNotificationResult({
      sent: { inApp: true, email: true, sms: false },
      blockedReasons: [],
    })
    expect(out.tone).toBe('success')
    expect(out.message).toBe('Test sent via inApp, email.')
  })

  /* 🛑 THE ONE THIS EXISTS FOR. */
  it('names what did NOT send, even though something did', () => {
    const out = describeTestNotificationResult({
      sent: { inApp: false, email: true, sms: false },
      blockedReasons: ['sms_unavailable'],
    })
    expect(out.message).toContain('Test sent via email')
    expect(out.message).toContain('sms_unavailable')
  })

  /*
   * ⚠ AND IT MUST NOT LOOK LIKE AN UNQUALIFIED WIN. Green beside "Not sent on: …" reads as "all
   * good" at a glance, which is the impression that made the old message wrong in the first
   * place — so the tone drops even though a channel succeeded.
   */
  it('does not paint a partial send as success', () => {
    const out = describeTestNotificationResult({
      sent: { email: true },
      blockedReasons: ['sms_send_failed'],
    })
    expect(out.tone).not.toBe('success')
    expect(out.tone).toBe('info')
  })

  it('names the reason when nothing sent at all', () => {
    const out = describeTestNotificationResult({
      sent: { inApp: false, email: false, sms: false },
      blockedReasons: ['category_disabled'],
    })
    expect(out.tone).toBe('info')
    expect(out.message).toBe('No test sent. Blocked by: category_disabled.')
  })

  /*
   * ⚠ THE CASE WITH NO INFORMATION AT ALL still has to say something a reader can act on. This
   * is the shape the in-app failure used to produce before the route learned to name it.
   */
  it('falls back to a usable sentence when nothing sent and nothing was reported', () => {
    const out = describeTestNotificationResult({ sent: {}, blockedReasons: [] })
    expect(out.tone).toBe('info')
    expect(out.message).toBe('No test sent. Check your current category and delivery settings.')
  })

  it('survives a payload with the fields missing entirely', () => {
    const out = describeTestNotificationResult({ sent: undefined, blockedReasons: undefined })
    expect(out.tone).toBe('info')
    expect(out.message.length).toBeGreaterThan(0)
  })
})
