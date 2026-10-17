// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "Texts on by default after consent" (owner's call, 2026-10-03). Without a live SMS consent record
 * nothing is ever texted; with one, the TIME-SENSITIVE alerts default to text, the chatty ones stay
 * opt-in, and a choice the user saved always wins.
 */

const h = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  sendSms: vi.fn(async () => ({ ok: true })),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/user-settings', () => ({ getSettingsProfile: async () => h.profile }))
vi.mock('@/lib/platform/notification-service', () => ({ createPlatformNotification: vi.fn(async () => ({})) }))
vi.mock('@/lib/resend-client', () => ({
  sendNotificationEmail: vi.fn(async () => ({ ok: true })),
  sendTemplatedEmail: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/twilio-client', () => ({ sendSms: h.sendSms }))
vi.mock('@/lib/notifications/smsDailyCap', () => ({ reserveSmsToday: vi.fn(async () => true) }))
vi.mock('@/lib/push-notifications', () => ({ sendPushToUser: vi.fn(async () => ({})) }))

import {
  hasLiveSmsConsentRecord,
  resolveNotificationPreferences,
} from '@/lib/notification-settings/NotificationPreferenceResolver'
import { SMS_DEFAULT_ON_AFTER_CONSENT_CATEGORY_IDS, NOTIFICATION_CATEGORY_IDS } from '@/lib/notification-settings/types'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'

const PHONE = '+15555550100'
const consent = { consentedAt: '2026-10-01T00:00:00Z', phone: PHONE }

describe('the resolver', () => {
  it('without consent, SMS is off for every category', () => {
    const prefs = resolveNotificationPreferences(null)
    for (const id of NOTIFICATION_CATEGORY_IDS) expect(prefs.categories?.[id]?.sms, id).toBe(false)
  })

  it('with live consent, SMS defaults ON for the time-sensitive set and OFF for everything else', () => {
    const prefs = resolveNotificationPreferences({ smsConsent: consent } as never)
    for (const id of NOTIFICATION_CATEGORY_IDS) {
      expect(prefs.categories?.[id]?.sms, id).toBe(SMS_DEFAULT_ON_AFTER_CONSENT_CATEGORY_IDS.includes(id))
    }
    // Spot-check the chatty ones explicitly — these are what make people reply STOP.
    for (const id of ['chat_mentions', 'direct_messages', 'league_chat', 'league_drama'] as const) {
      expect(prefs.categories?.[id]?.sms, id).toBe(false)
    }
  })

  it('a withdrawn consent (STOP, or a removed phone) does not flip anything', () => {
    const prefs = resolveNotificationPreferences({ smsConsent: { ...consent, revokedAt: '2026-10-02T00:00:00Z' } } as never)
    expect(prefs.categories?.injury_alerts?.sms).toBe(false)
    expect(hasLiveSmsConsentRecord({ smsConsent: { ...consent, revokedAt: 'x' } })).toBe(false)
    expect(hasLiveSmsConsentRecord({ smsConsent: consent })).toBe(true)
    expect(hasLiveSmsConsentRecord(null)).toBe(false)
  })

  it("a user's saved choice wins over the new default, in both directions", () => {
    const prefs = resolveNotificationPreferences({
      smsConsent: consent,
      categories: { injury_alerts: { enabled: true, inApp: true, email: true, sms: false } },
    } as never)
    expect(prefs.categories?.injury_alerts?.sms).toBe(false)
    // Rows the user never saved still get the post-consent default.
    expect(prefs.categories?.trade_proposals?.sms).toBe(true)
  })
})

describe('the dispatcher, end to end', () => {
  beforeEach(() => h.sendSms.mockClear())

  async function send(category: string, notificationPreferences: unknown) {
    h.profile = {
      userId: 'u-1',
      email: null,
      phone: PHONE,
      phoneVerifiedAt: new Date('2026-10-01'),
      timezone: 'UTC',
      notificationPreferences,
    }
    await dispatchNotification({ userIds: ['u-1'], category: category as never, type: 't', title: 'Your RB is out', severity: 'critical' })
  }

  it('consent + an injury alert = a text, with no settings ever saved', async () => {
    await send('injury_alerts', { smsConsent: consent })
    expect(h.sendSms).toHaveBeenCalledTimes(1)
  })

  it('consent + a chat mention = no text (stays opt-in)', async () => {
    await send('chat_mentions', { smsConsent: consent })
    expect(h.sendSms).not.toHaveBeenCalled()
  })

  it('CONTROL: no consent = no text, even for an injury alert', async () => {
    await send('injury_alerts', null)
    expect(h.sendSms).not.toHaveBeenCalled()
  })

  it('consent recorded for an OLD number never texts the new one', async () => {
    await send('injury_alerts', { smsConsent: { ...consent, phone: '+15555559999' } })
    expect(h.sendSms).not.toHaveBeenCalled()
  })
})

describe('the /core nudge is wired from the server read', () => {
  const page = readFileSync(path.join(process.cwd(), 'app/core/(shell)/[[...screen]]/page.tsx'), 'utf8')
  it('decides eligibility with hasSmsConsent on the current phone, false when the read failed', () => {
    expect(page).toMatch(/const smsOptInEligible = shellUser\s*\?\s*!hasSmsConsent\(shellUser\.profile\?\.notificationPreferences, shellUser\.profile\?\.phone\)\s*:\s*false/)
    expect(page).toMatch(/smsOptInEligible=\{smsOptInEligible\}/)
  })
})
