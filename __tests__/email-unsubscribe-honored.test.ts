// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Every notification email carries an Unsubscribe link. It wrote `EmailPreference.unsubscribedAt`,
 * and the notification dispatcher never read it — alert emails kept arriving after the click
 * (found 2026-10-03). These pin: an unsubscribed address gets no ALERT email, account notices still
 * send, a failed read withholds, and "Turn alert emails back on" undoes it without re-opting the
 * user into marketing.
 */

const h = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  sentNotification: vi.fn(async () => ({ ok: true })),
  sentTemplated: vi.fn(async () => ({ ok: true })),
  findFirst: vi.fn(async () => null as null | { unsubscribedAt: Date | null }),
  updateMany: vi.fn(async () => ({ count: 1 })),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: { emailPreference: { findFirst: h.findFirst, updateMany: h.updateMany } },
}))
vi.mock('@/lib/user-settings', () => ({ getSettingsProfile: async () => h.profile }))
vi.mock('@/lib/platform/notification-service', () => ({ createPlatformNotification: vi.fn(async () => ({})) }))
vi.mock('@/lib/resend-client', () => ({
  sendNotificationEmail: h.sentNotification,
  sendTemplatedEmail: h.sentTemplated,
}))
vi.mock('@/lib/twilio-client', () => ({ sendSms: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/notifications/smsDailyCap', () => ({ reserveSmsToday: vi.fn(async () => true) }))
vi.mock('@/lib/push-notifications', () => ({ sendPushToUser: vi.fn(async () => ({})) }))

import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import {
  emailWithheldByUnsubscribe,
  readEmailSubscription,
  resumeAlertEmails,
} from '@/lib/email/emailSubscription'

const base = {
  userId: 'u-1',
  email: 'manager@allfantasy-test.net',
  notificationPreferences: null,
  phone: null,
  phoneVerifiedAt: null,
  timezone: 'America/New_York',
}

async function send(category: string, emailSubscription: unknown) {
  h.profile = { ...base, ...(emailSubscription === 'absent' ? {} : { emailSubscription }) }
  await dispatchNotification({
    userIds: ['u-1'],
    category: category as never,
    type: 't',
    title: 'Injury: your RB is out',
    body: 'Out for the week.',
  })
}

beforeEach(() => {
  h.sentNotification.mockClear()
  h.sentTemplated.mockClear()
  h.findFirst.mockClear()
  h.updateMany.mockClear()
})

describe('the dispatcher honours Unsubscribe', () => {
  it('CONTROL: a subscribed address gets the alert email', async () => {
    await send('injury_alerts', { unsubscribedAt: null })
    expect(h.sentNotification).toHaveBeenCalledTimes(1)
  })

  it('an unsubscribed address gets NO alert email', async () => {
    await send('injury_alerts', { unsubscribedAt: new Date('2026-10-01') })
    expect(h.sentNotification).not.toHaveBeenCalled()
  })

  it('account notices still send after Unsubscribe, as the unsubscribe page promises', async () => {
    await send('system_account', { unsubscribedAt: new Date('2026-10-01') })
    expect(h.sentNotification).toHaveBeenCalledTimes(1)
  })

  it('a FAILED read withholds the email (never risk mailing someone who opted out)', async () => {
    await send('injury_alerts', 'unknown')
    expect(h.sentNotification).not.toHaveBeenCalled()
  })

  it('a profile built without the field still sends (no path silenced by adding the check)', async () => {
    await send('injury_alerts', 'absent')
    expect(h.sentNotification).toHaveBeenCalledTimes(1)
  })
})

describe('emailSubscription helpers', () => {
  it('reads case-insensitively and reports a failed read as "unknown"', async () => {
    h.findFirst.mockResolvedValueOnce({ unsubscribedAt: new Date('2026-10-01') })
    expect(await readEmailSubscription('Manager@AllFantasy-Test.net')).toEqual({ unsubscribedAt: new Date('2026-10-01') })
    expect((h.findFirst.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toEqual({
      email: { equals: 'Manager@AllFantasy-Test.net', mode: 'insensitive' },
    })
    h.findFirst.mockRejectedValueOnce(new Error('db down'))
    expect(await readEmailSubscription('x@y.net')).toBe('unknown')
    expect(await readEmailSubscription(null)).toEqual({ unsubscribedAt: null })
  })

  it('withholds only alerts, only when opted out or unknown', () => {
    const out = { unsubscribedAt: new Date() }
    expect(emailWithheldByUnsubscribe(out, 'injury_alerts')).toBe(true)
    expect(emailWithheldByUnsubscribe(out, 'system_account')).toBe(false)
    expect(emailWithheldByUnsubscribe({ unsubscribedAt: null }, 'injury_alerts')).toBe(false)
    expect(emailWithheldByUnsubscribe('unknown', 'injury_alerts')).toBe(true)
    expect(emailWithheldByUnsubscribe(undefined, 'injury_alerts')).toBe(false)
  })

  it('resuming clears the opt-out and trade alerts, but NOT the marketing flags', async () => {
    await resumeAlertEmails('manager@allfantasy-test.net')
    const args = (h.updateMany.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0]
    expect(args.data).toEqual({ unsubscribedAt: null, tradeAlerts: true })
    expect(args.data).not.toHaveProperty('productUpdates')
    expect(args.data).not.toHaveProperty('weeklyDigest')
  })
})
