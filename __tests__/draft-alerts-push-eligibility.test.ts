import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * N1 — standard draft events could not reach the push transport.
 *
 * `DraftNotificationService.resolveCategoryForEvent` maps every non-AI draft event, ON THE
 * CLOCK included, to `draft_alerts`. `NotificationDispatcher` gates push on
 * `isPushCategory(category)`, and `draft_alerts` was absent from that allowlist while
 * `draft_intel_alerts` was present — so Chimmy's draft recap could buzz a phone and "you are on
 * the clock" could not, however completely the user had opted in.
 *
 * ⚠ THIS EXERCISES THE PRODUCER-TO-DISPATCH PATH, NOT ALLOWLIST MEMBERSHIP. Asserting that the
 * string is in the array proves nothing about whether the event that needs it actually carries
 * that category. `createDraftNotification` is called with a real event type and the real
 * dispatcher runs; only the leaf transports and the store are mocked.
 */

const h = vi.hoisted(() => ({
  sendPushToUser: vi.fn(),
  sendNotificationEmail: vi.fn(),
  sendTemplatedEmail: vi.fn(),
  sendSms: vi.fn(),
  createPlatformNotification: vi.fn(),
  getSettingsProfile: vi.fn(),
  leagueFindUnique: vi.fn(),
}))

vi.mock('@/lib/push-notifications/push-service', () => ({
  sendPushToUser: h.sendPushToUser,
  savePushSubscription: vi.fn(),
  removePushSubscription: vi.fn(),
  getPushSubscriptions: vi.fn(),
}))
vi.mock('@/lib/resend-client', () => ({
  sendNotificationEmail: h.sendNotificationEmail,
  sendTemplatedEmail: h.sendTemplatedEmail,
}))
vi.mock('@/lib/twilio-client', () => ({ sendSms: h.sendSms }))
vi.mock('@/lib/platform/notification-service', () => ({
  createPlatformNotification: h.createPlatformNotification,
}))
vi.mock('@/lib/user-settings', () => ({ getSettingsProfile: h.getSettingsProfile }))
vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findUnique: h.leagueFindUnique } },
}))

import { createDraftNotification } from '@/lib/draft-notifications/DraftNotificationService'
import { isPushCategory, PUSH_NOTIFICATION_CATEGORIES } from '@/lib/push-notifications'

/** A user who has opted in to draft alerts on every channel and is not in quiet hours. */
const optedInProfile = (over: Record<string, unknown> = {}) => ({
  userId: 'user-1',
  email: 'manager@example.org',
  phone: null,
  phoneVerifiedAt: null,
  timezone: 'America/New_York',
  notificationPreferences: {
    globalEnabled: true,
    categories: {
      draft_alerts: { enabled: true, inApp: true, email: false, sms: false },
      draft_intel_alerts: { enabled: true, inApp: true, email: false, sms: false },
    },
    quietHours: { enabled: false, startHour: 0, endHour: 0 },
  },
  ...over,
})

beforeEach(() => {
  h.sendPushToUser.mockReset().mockResolvedValue([{ ok: true }])
  h.sendNotificationEmail.mockReset().mockResolvedValue({ ok: true })
  h.sendTemplatedEmail.mockReset().mockResolvedValue({ ok: true })
  h.sendSms.mockReset().mockResolvedValue(true)
  h.createPlatformNotification.mockReset().mockResolvedValue({})
  h.getSettingsProfile.mockReset().mockResolvedValue(optedInProfile())
  h.leagueFindUnique.mockReset().mockResolvedValue({ name: 'Beta League' })
})

describe('the allowlist', () => {
  it('contains draft_alerts', () => {
    expect(isPushCategory('draft_alerts')).toBe(true)
  })

  it('still contains draft_intel_alerts — the fix adds, it does not swap', () => {
    expect(PUSH_NOTIFICATION_CATEGORIES).toContain('draft_intel_alerts')
  })
})

describe('producer to dispatch', () => {
  it('sends a push for an ordinary on-the-clock event', async () => {
    // The reproduction: pre-fix this reached the dispatcher and was discarded at the gate.
    await createDraftNotification('user-1', 'draft_on_the_clock', {
      leagueId: 'league-1',
      pickNumber: 14,
    } as never)

    expect(h.sendPushToUser).toHaveBeenCalledTimes(1)
    expect(h.sendPushToUser.mock.calls[0][0]).toBe('user-1')
    expect(h.sendPushToUser.mock.calls[0][1].type).toBe('draft_on_the_clock')
  })

  it.each([
    'draft_approaching_timeout',
    'draft_auto_pick_fired',
    'draft_paused',
    'draft_resumed',
    'draft_slow_reminder',
    'draft_starting_soon',
    'draft_auction_outbid',
  ])('sends a push for %s', async (eventType) => {
    await createDraftNotification('user-1', eventType as never, { leagueId: 'league-1' } as never)
    expect(h.sendPushToUser).toHaveBeenCalledTimes(1)
  })

  it('writes the in-app row as well — push is added, nothing is displaced', async () => {
    await createDraftNotification('user-1', 'draft_on_the_clock', { leagueId: 'league-1' } as never)
    expect(h.createPlatformNotification).toHaveBeenCalledTimes(1)
  })
})

describe('the existing gates still apply', () => {
  it('sends nothing when the user has not enabled draft alerts', async () => {
    h.getSettingsProfile.mockResolvedValue(
      optedInProfile({
        notificationPreferences: {
          globalEnabled: true,
          categories: { draft_alerts: { enabled: false, inApp: true, email: false, sms: false } },
        },
      }),
    )

    await createDraftNotification('user-1', 'draft_on_the_clock', { leagueId: 'league-1' } as never)

    expect(h.sendPushToUser).not.toHaveBeenCalled()
    expect(h.createPlatformNotification).not.toHaveBeenCalled()
  })

  it('sends nothing when notifications are globally off', async () => {
    h.getSettingsProfile.mockResolvedValue(
      optedInProfile({ notificationPreferences: { globalEnabled: false } }),
    )

    await createDraftNotification('user-1', 'draft_on_the_clock', { leagueId: 'league-1' } as never)

    expect(h.sendPushToUser).not.toHaveBeenCalled()
  })

  it('sends nothing when the user has no settings profile at all', async () => {
    h.getSettingsProfile.mockResolvedValue(null)

    await createDraftNotification('user-1', 'draft_on_the_clock', { leagueId: 'league-1' } as never)

    expect(h.sendPushToUser).not.toHaveBeenCalled()
  })

  it('suppresses push during quiet hours while keeping the in-app row', async () => {
    // Quiet hours defer a buzz; they do not delete history.
    const now = new Date()
    const hour = now.getHours()
    h.getSettingsProfile.mockResolvedValue(
      optedInProfile({
        timezone: null,
        notificationPreferences: {
          globalEnabled: true,
          categories: {
            draft_alerts: { enabled: true, inApp: true, email: false, sms: false },
          },
          quietHours: {
            enabled: true,
            startHour: hour,
            endHour: (hour + 2) % 24,
            allowCritical: false,
            timezone: null,
          },
        },
      }),
    )

    await createDraftNotification('user-1', 'draft_slow_reminder', { leagueId: 'league-1' } as never)

    expect(h.sendPushToUser).not.toHaveBeenCalled()
    expect(h.createPlatformNotification).toHaveBeenCalledTimes(1)
  })

  it('respects a per-league mute for the category', async () => {
    h.getSettingsProfile.mockResolvedValue(
      optedInProfile({
        notificationPreferences: {
          globalEnabled: true,
          categories: { draft_alerts: { enabled: true, inApp: true, email: false, sms: false } },
          leagues: { 'league-1': { mutedCategories: ['draft_alerts'] } },
        },
      }),
    )

    await createDraftNotification('user-1', 'draft_on_the_clock', { leagueId: 'league-1' } as never)

    expect(h.sendPushToUser).not.toHaveBeenCalled()
  })
})
