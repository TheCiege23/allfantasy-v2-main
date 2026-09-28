// @vitest-environment node
/**
 * "I'm still waiting for approval from twilio on phone alerts but I want it to be working code
 * wise before it's ready so when approval happens, its instantaneous." (owner, 2026-09-25)
 *
 * So this runs the REAL chain — message notifier → NotificationDispatcher → twilio-client.sendSms
 * — and stubs only the `twilio` SDK itself (no network) plus the other channels' senders. The one
 * thing that changes between the two cases is the Twilio environment. If this goes green with
 * Twilio configured, flipping the env vars on is the whole launch.
 *
 * The recipient here has a VERIFIED phone and has switched the direct-messages SMS channel ON —
 * SMS is opt-in for every category, and the last case proves the default sends nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  messagesCreate: vi.fn(),
  twilioFactory: vi.fn(),
  bell: vi.fn(),
  push: vi.fn(),
  email: vi.fn(),
  profilePrefs: null as unknown,
}))

vi.mock('server-only', () => ({}))
vi.mock('twilio', () => {
  h.twilioFactory.mockImplementation(() => ({ messages: { create: h.messagesCreate } }))
  return { default: h.twilioFactory }
})
vi.mock('@/lib/user-settings', () => ({
  getSettingsProfile: async (userId: string) => ({
    userId,
    email: `${userId}@example.org`,
    phone: '+13615550199',
    phoneVerifiedAt: new Date('2026-09-01T00:00:00Z'),
    timezone: 'America/Chicago',
    notificationPreferences: h.profilePrefs,
  }),
}))
vi.mock('@/lib/platform/notification-service', () => ({ createPlatformNotification: h.bell }))
vi.mock('@/lib/push-notifications', () => ({ sendPushToUser: h.push }))
vi.mock('@/lib/resend-client', () => ({ sendNotificationEmail: h.email, sendTemplatedEmail: h.email }))
vi.mock('@/lib/notifications/smsDailyCap', () => ({ reserveSmsToday: async () => true }))
vi.mock('@/lib/dev-admin/access', () => ({ isTokenNotificationBypassUserId: () => false }))
vi.mock('@/lib/get-base-url', () => ({ getBaseUrl: () => 'https://af.test' }))
// The fixtures use RFC-reserved addresses, which the real dispatcher (correctly) never mails.
vi.mock('@/lib/email/undeliverableDomains', () => ({ isUndeliverableEmailDomain: () => false }))
vi.mock('@/lib/email/marketing-email', () => ({ createEmailUnsubscribeToken: () => 'tok' }))
vi.mock('@/lib/league-chat/leagueMemberIds', () => ({ getLeagueMemberUserIds: async () => [] }))
vi.mock('@/lib/prisma', () => {
  const cache = new Map<string, { data: unknown; expiresAt: Date }>()
  return {
    prisma: {
      platformChatThread: {
        findUnique: async () => ({
          id: 'thread-1',
          threadType: 'dm',
          title: null,
          members: [
            { userId: 'sender', isMuted: false, isBlocked: false, lastReadAt: null, user: { email: 'sender@example.org' } },
            { userId: 'bob', isMuted: false, isBlocked: false, lastReadAt: null, user: { email: 'bob@example.org' } },
          ],
        }),
      },
      appUser: { findUnique: async () => ({ displayName: 'Dana', username: 'dana' }) },
      platformBlockedUser: { findMany: async () => [] },
      emailPreference: { findFirst: async () => null },
      sportsDataCache: {
        // A fresh throttle per test: every test uses its own message and thread state.
        findUnique: async () => null,
        create: async ({ data }: { data: { cacheKey: string; data: unknown; expiresAt: Date } }) => {
          cache.set(`${data.cacheKey}:${Math.random()}`, { data: data.data, expiresAt: data.expiresAt })
          return {}
        },
        updateMany: async () => ({ count: 1 }),
      },
    },
  }
})

import { notifyDirectMessageRecipients } from '@/lib/chat-notifications/chatMessageNotifier'

const TWILIO_ENV = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_API_KEY', 'TWILIO_API_SECRET', 'TWILIO_PHONE_NUMBER'] as const
let saved: Record<string, string | undefined> = {}

const SMS_ON = {
  categories: { direct_messages: { enabled: true, inApp: true, email: true, sms: true, push: true } },
}

function configureTwilio() {
  process.env.TWILIO_ACCOUNT_SID = 'AC00000000000000000000000000000000'
  process.env.TWILIO_AUTH_TOKEN = 'test-auth-token'
  process.env.TWILIO_PHONE_NUMBER = '+13615550100'
}

const sendDm = () =>
  notifyDirectMessageRecipients({
    threadId: 'thread-1',
    messageId: `msg-${Math.random()}`,
    senderUserId: 'sender',
    body: 'Trade deadline is tonight — you in?',
    now: new Date('2026-09-25T18:00:00Z'), // 1pm Chicago: outside any default quiet hours
  })

beforeEach(() => {
  saved = {}
  for (const k of TWILIO_ENV) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  h.messagesCreate.mockReset()
  h.messagesCreate.mockResolvedValue({ sid: 'SM1' })
  h.twilioFactory.mockClear()
  h.bell.mockReset()
  h.bell.mockResolvedValue(true)
  h.push.mockReset()
  h.push.mockResolvedValue([])
  h.email.mockReset()
  h.email.mockResolvedValue({ ok: true })
  h.profilePrefs = SMS_ON
})

afterEach(() => {
  for (const k of TWILIO_ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('🛑 DM texts: working code now, live the moment Twilio is configured', () => {
  it('Twilio CONFIGURED: the DM goes out as a text to the verified phone, with the opt-out line', async () => {
    configureTwilio()
    const r = await sendDm()
    expect(r.recipients).toEqual([{ userId: 'bob', outcome: 'alerted', email: true }])

    expect(h.messagesCreate).toHaveBeenCalledTimes(1)
    const sms = h.messagesCreate.mock.calls[0][0] as { from: string; to: string; body: string }
    expect(sms.to).toBe('+13615550199')
    expect(sms.from).toBe('+13615550100')
    expect(sms.body).toContain('Dana')
    expect(sms.body).toContain('Trade deadline is tonight')
    expect(sms.body).toMatch(/reply stop/i)

    // The other channels go out alongside it.
    expect(h.bell).toHaveBeenCalledWith(expect.objectContaining({ userId: 'bob', type: 'direct_message' }))
    expect(h.push).toHaveBeenCalledWith('bob', expect.objectContaining({ title: 'Dana', tag: 'dm-thread-1' }))
    expect(h.email).toHaveBeenCalledTimes(1)
  })

  it('Twilio NOT configured (today): no text is attempted, nothing throws, and bell/push/email still go', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const r = await sendDm()
    expect(r.recipients[0].outcome).toBe('alerted')
    expect(h.twilioFactory).not.toHaveBeenCalled()
    expect(h.messagesCreate).not.toHaveBeenCalled()
    expect(h.bell).toHaveBeenCalledTimes(1)
    expect(h.push).toHaveBeenCalledTimes(1)
    expect(h.email).toHaveBeenCalledTimes(1)
    // What gets logged when it skips carries no phone number.
    expect(JSON.stringify(errors.mock.calls)).not.toContain('5550199')
    errors.mockRestore()
  })

  it('SMS stays OFF by default even with Twilio configured — a user has to opt in', async () => {
    configureTwilio()
    h.profilePrefs = null // never opened settings
    await sendDm()
    expect(h.messagesCreate).not.toHaveBeenCalled()
    expect(h.bell).toHaveBeenCalledTimes(1)
    expect(h.push).toHaveBeenCalledTimes(1)
  })
})
