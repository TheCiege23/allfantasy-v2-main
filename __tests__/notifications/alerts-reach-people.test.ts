// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Alerts that reach people (2026-11-15). Email is the channel most users can actually receive, so:
 *   - "your starter is out" (`lineup_alerts`) and a leaguemate's trade offer (`trade_proposals`) email by default;
 *   - under `lineup_reminders`, only Chimmy's weekly lineup check emails by default (never the slate-lock
 *     final call, which skips email on purpose — it lands too close to kickoff for an inbox);
 *   - a saved email choice for the category always wins, including an explicit "off";
 *   - desktop push is on unless the person switched it off.
 */

const h = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  sentNotification: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/lib/notifications/durableTransport', () => ({ deliverDurably: async (_m: unknown, send: () => Promise<void>) => { await send(); return 'sent' } }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/user-settings', () => ({ getSettingsProfile: async () => h.profile }))
vi.mock('@/lib/platform/notification-service', () => ({ createPlatformNotification: vi.fn(async () => ({})) }))
vi.mock('@/lib/resend-client', () => ({
  sendNotificationEmail: h.sentNotification,
  sendTemplatedEmail: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/twilio-client', () => ({ sendSms: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/notifications/smsDailyCap', () => ({ reserveSmsToday: vi.fn(async () => true) }))
vi.mock('@/lib/push-notifications', () => ({ sendPushToUser: vi.fn(async () => []) }))

import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { emailsByDefaultForEvent } from '@/lib/notifications/channelPolicy'
import {
  getDefaultNotificationPreferences,
  resolveNotificationPreferences,
  resolvePushDevices,
} from '@/lib/notification-settings/NotificationPreferenceResolver'

async function send(opts: { category: string; type?: string; severity?: 'low' | 'medium' | 'high'; prefs?: unknown }) {
  h.profile = {
    userId: 'u-1',
    email: 'manager@allfantasy-test.net',
    notificationPreferences: opts.prefs ?? null,
    phone: null,
    phoneVerifiedAt: null,
    timezone: 'America/New_York',
    emailSubscription: { unsubscribedAt: null },
  }
  await dispatchNotification({
    userIds: ['u-1'],
    category: opts.category as never,
    type: opts.type ?? 't',
    severity: opts.severity,
    title: 'Your starter is out',
    body: 'Out for the week.',
  })
}

beforeEach(() => h.sentNotification.mockClear())

describe('email defaults', () => {
  it('starter-out and trade offers email by default; the chatty categories still do not', () => {
    const d = getDefaultNotificationPreferences().categories!
    expect(d.lineup_alerts?.email).toBe(true)
    expect(d.trade_proposals?.email).toBe(true)
    expect(d.lineup_reminders?.email).toBe(false)
    expect(d.live_game_alerts?.email).toBe(false)
    expect(d.waiver_processing?.email).toBe(false)
  })

  it('a saved "email off" survives the new default', () => {
    const r = resolveNotificationPreferences({ categories: { lineup_alerts: { enabled: true, inApp: true, email: false, sms: false } } } as never)
    expect(r.categories?.lineup_alerts?.email).toBe(false)
  })

  it('only the weekly lineup check is a default-email lineup reminder', () => {
    expect(emailsByDefaultForEvent('lineup_reminders', { type: 'chimmy_lineup_check' })).toBe(true)
    expect(emailsByDefaultForEvent('lineup_reminders', { type: 'chimmy_slate_lock_check' })).toBe(false)
    expect(emailsByDefaultForEvent('lineup_reminders', { type: 'chimmy_waiver_check' })).toBe(false)
    expect(emailsByDefaultForEvent('lineup_reminders', { type: 'chimmy_best_ball_depth' })).toBe(false)
    expect(emailsByDefaultForEvent('live_game_alerts', { type: 'chimmy_lineup_check' })).toBe(false)
  })
})

describe('the dispatcher sends those emails', () => {
  it('a starter-out alert emails a person who never touched settings', async () => {
    await send({ category: 'lineup_alerts' })
    expect(h.sentNotification).toHaveBeenCalledTimes(1)
  })

  it('a trade offer emails by default', async () => {
    await send({ category: 'trade_proposals' })
    expect(h.sentNotification).toHaveBeenCalledTimes(1)
  })

  it('the weekly lineup check emails by default; the daily waiver tip does not', async () => {
    await send({ category: 'lineup_reminders', type: 'chimmy_lineup_check', severity: 'medium' })
    expect(h.sentNotification).toHaveBeenCalledTimes(1)
    h.sentNotification.mockClear()
    await send({ category: 'lineup_reminders', type: 'chimmy_waiver_check', severity: 'medium' })
    expect(h.sentNotification).not.toHaveBeenCalled()
  })

  it('🛑 an explicit "email off" for lineup reminders silences the weekly check too', async () => {
    await send({
      category: 'lineup_reminders',
      type: 'chimmy_lineup_check',
      severity: 'medium',
      prefs: { categories: { lineup_reminders: { enabled: true, inApp: true, email: false, sms: false } } },
    })
    expect(h.sentNotification).not.toHaveBeenCalled()
  })

  it('CONTROL: a category whose email stays off by default sends no email', async () => {
    await send({ category: 'live_game_alerts' })
    expect(h.sentNotification).not.toHaveBeenCalled()
  })
})

describe('desktop push', () => {
  it('is on unless the person switched it off', () => {
    expect(resolvePushDevices(null)).toEqual({ mobile: true, desktop: true })
    expect(resolvePushDevices({ pushDevices: {} } as never).desktop).toBe(true)
    expect(resolvePushDevices({ pushDevices: { desktop: false } } as never).desktop).toBe(false)
    expect(resolvePushDevices({ pushDevices: { mobile: false } } as never)).toEqual({ mobile: false, desktop: true })
  })
})
