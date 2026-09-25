import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Multi-league preference handling, through the REAL dispatcher.
 *
 * 🛑 ONE EVENT CAN AFFECT SEVERAL LEAGUES AND THE GATE WAS A SINGLE LOOKUP. Player news about
 * someone a manager rosters in twelve leagues is ONE notification carrying all twelve — and the
 * first implementation anchored it on `leagueIds[0]`, then ran the single-league mute check
 * against that anchor. Wrong in both directions:
 *
 *   - muted in the anchor league only      → silenced for eleven leagues they never muted;
 *   - muted everywhere EXCEPT the anchor   → notified, with the muted leagues still listed.
 *
 * These tests drive `dispatchNotification` itself with real preference resolution and real
 * league-override logic. Only the leaf transports and the store are mocked.
 */

const h = vi.hoisted(() => ({
  sendPushToUser: vi.fn(),
  sendNotificationEmail: vi.fn(),
  sendTemplatedEmail: vi.fn(),
  sendSms: vi.fn(),
  createPlatformNotification: vi.fn(),
  getSettingsProfile: vi.fn(),
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

import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { allowedLeaguesForCategory } from '@/lib/notifications/leagueOverrides'

const profile = (leagues: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  userId: 'user-1',
  email: 'manager@example.org',
  phone: null,
  phoneVerifiedAt: null,
  timezone: 'America/New_York',
  notificationPreferences: {
    globalEnabled: true,
    categories: {
      injury_alerts: { enabled: true, inApp: true, email: false, sms: false },
    },
    quietHours: { enabled: false, startHour: 0, endHour: 0 },
    leagues,
    ...(over.prefs as object | undefined),
  },
  ...over,
})

const send = (leagueIds: string[]) =>
  dispatchNotification({
    userIds: ['user-1'],
    category: 'injury_alerts',
    type: 'player_injury_update',
    title: 'Injury: Bijan Robinson',
    leagueIds,
    actionHref: '/player/bijan-robinson',
    meta: { affectedLeagueIds: leagueIds },
  })

beforeEach(() => {
  h.sendPushToUser.mockReset().mockResolvedValue([{ ok: true }])
  h.sendNotificationEmail.mockReset().mockResolvedValue({ ok: true })
  h.sendTemplatedEmail.mockReset().mockResolvedValue({ ok: true })
  h.sendSms.mockReset().mockResolvedValue(true)
  h.createPlatformNotification.mockReset().mockResolvedValue({})
  h.getSettingsProfile.mockReset().mockResolvedValue(profile())
})

describe('the set helper', () => {
  it('drops muted leagues and keeps the rest', () => {
    const prefs = {
      globalEnabled: true,
      leagues: { 'league-a': { mutedCategories: ['injury_alerts' as const] } },
    }
    expect(allowedLeaguesForCategory(prefs, 'injury_alerts', ['league-a', 'league-b'])).toEqual([
      'league-b',
    ])
  })

  it('returns nothing when the account is globally off', () => {
    expect(
      allowedLeaguesForCategory({ globalEnabled: false }, 'injury_alerts', ['league-a']),
    ).toEqual([])
  })
})

describe('all affected leagues muted', () => {
  it('sends no interruptive alert and writes no row', async () => {
    h.getSettingsProfile.mockResolvedValue(
      profile({
        'league-a': { mutedCategories: ['injury_alerts'] },
        'league-b': { mutedCategories: ['injury_alerts'] },
      }),
    )

    await send(['league-a', 'league-b'])

    expect(h.sendPushToUser).not.toHaveBeenCalled()
    expect(h.createPlatformNotification).not.toHaveBeenCalled()
  })

  it('respects a whole-league opt-out as well as a category mute', async () => {
    h.getSettingsProfile.mockResolvedValue(
      profile({ 'league-a': { enabled: false }, 'league-b': { enabled: false } }),
    )

    await send(['league-a', 'league-b'])

    expect(h.sendPushToUser).not.toHaveBeenCalled()
  })
})

describe('one muted, one enabled', () => {
  it('sends ONE alert carrying only the eligible league', async () => {
    h.getSettingsProfile.mockResolvedValue(
      profile({ 'league-a': { mutedCategories: ['injury_alerts'] } }),
    )

    await send(['league-a', 'league-b'])

    expect(h.createPlatformNotification).toHaveBeenCalledTimes(1)
    const row = h.createPlatformNotification.mock.calls[0][0]
    expect(row.meta.affectedLeagueIds).toEqual(['league-b'])
    expect(row.leagueId).toBe('league-b')
  })

  it('behaves identically when the league order is reversed', async () => {
    h.getSettingsProfile.mockResolvedValue(
      profile({ 'league-a': { mutedCategories: ['injury_alerts'] } }),
    )

    await send(['league-b', 'league-a'])

    const row = h.createPlatformNotification.mock.calls[0][0]
    expect(row.meta.affectedLeagueIds).toEqual(['league-b'])
    expect(row.leagueId).toBe('league-b')
  })

  it('never lists a muted league in the detail view', async () => {
    h.getSettingsProfile.mockResolvedValue(
      profile({ 'league-b': { mutedCategories: ['injury_alerts'] } }),
    )

    await send(['league-a', 'league-b'])

    const row = h.createPlatformNotification.mock.calls[0][0]
    expect(row.meta.affectedLeagueIds).not.toContain('league-b')
  })

  it('tags the push with an ELIGIBLE league, not the muted anchor', async () => {
    h.getSettingsProfile.mockResolvedValue(
      profile({ 'league-a': { mutedCategories: ['injury_alerts'] } }),
    )

    await send(['league-a', 'league-b'])

    expect(h.sendPushToUser).toHaveBeenCalledTimes(1)
    expect(h.sendPushToUser.mock.calls[0][1].tag).toContain('league-b')
    expect(h.sendPushToUser.mock.calls[0][1].tag).not.toContain('league-a')
  })

  it('sends the deep link, which resolves against an eligible league', async () => {
    h.getSettingsProfile.mockResolvedValue(
      profile({ 'league-a': { mutedCategories: ['injury_alerts'] } }),
    )

    await send(['league-a', 'league-b'])

    const row = h.createPlatformNotification.mock.calls[0][0]
    expect(row.meta.actionHref).toBe('/player/bijan-robinson')
    expect(row.leagueId).toBe('league-b')
  })
})

describe('the global and category gates still dominate', () => {
  it('global-off beats every per-league entry', async () => {
    h.getSettingsProfile.mockResolvedValue(
      profile(
        { 'league-a': { enabled: true } },
        { prefs: { globalEnabled: false } as Record<string, unknown> },
      ),
    )

    await send(['league-a', 'league-b'])

    expect(h.createPlatformNotification).not.toHaveBeenCalled()
    expect(h.sendPushToUser).not.toHaveBeenCalled()
  })

  it('category-off beats an un-muted league', async () => {
    h.getSettingsProfile.mockResolvedValue({
      ...profile(),
      notificationPreferences: {
        globalEnabled: true,
        categories: { injury_alerts: { enabled: false, inApp: true, email: false, sms: false } },
      },
    })

    await send(['league-a', 'league-b'])

    expect(h.createPlatformNotification).not.toHaveBeenCalled()
  })
})

describe('quiet hours over a multi-league event', () => {
  it('suppresses push but preserves the in-app history row', async () => {
    // Quiet hours defer a buzz; they do not delete history.
    const hour = new Date().getHours()
    h.getSettingsProfile.mockResolvedValue({
      ...profile(),
      timezone: null,
      notificationPreferences: {
        globalEnabled: true,
        categories: { injury_alerts: { enabled: true, inApp: true, email: false, sms: false } },
        quietHours: {
          enabled: true,
          startHour: hour,
          endHour: (hour + 2) % 24,
          allowCritical: false,
          timezone: null,
        },
      },
    })

    await send(['league-a', 'league-b'])

    expect(h.sendPushToUser).not.toHaveBeenCalled()
    expect(h.createPlatformNotification).toHaveBeenCalledTimes(1)
    expect(h.createPlatformNotification.mock.calls[0][0].meta.affectedLeagueIds).toEqual([
      'league-a',
      'league-b',
    ])
  })
})

describe('single-league callers are untouched', () => {
  it('still honours a per-league mute passed as `leagueId`', async () => {
    h.getSettingsProfile.mockResolvedValue(
      profile({ 'league-a': { mutedCategories: ['injury_alerts'] } }),
    )

    await dispatchNotification({
      userIds: ['user-1'],
      category: 'injury_alerts',
      type: 'player_injury_update',
      title: 'Injury',
      leagueId: 'league-a',
    })

    expect(h.createPlatformNotification).not.toHaveBeenCalled()
  })

  it('still sends for an un-muted single league', async () => {
    await dispatchNotification({
      userIds: ['user-1'],
      category: 'injury_alerts',
      type: 'player_injury_update',
      title: 'Injury',
      leagueId: 'league-a',
    })

    expect(h.createPlatformNotification).toHaveBeenCalledTimes(1)
    expect(h.createPlatformNotification.mock.calls[0][0].leagueId).toBe('league-a')
  })
})

describe('per-endpoint push delivery', () => {
  it('hands push ONE call per user and lets the transport fan out to every endpoint', async () => {
    /*
     * ⚠ WHAT THIS DOES AND DOES NOT PROVE. `sendPushToUser` loops every stored subscription and
     * records a result per endpoint, so one endpoint failing does not stop another. This test
     * pins that the dispatcher calls it exactly once per recipient and does not pre-filter
     * endpoints. It does NOT prove provider acceptance and it does NOT prove a device
     * displayed anything — per-endpoint retry records are Batch B.
     */
    h.sendPushToUser.mockResolvedValue([
      { ok: true, subscriptionId: 'endpoint-1' },
      { ok: false, error: 'gone', subscriptionId: 'endpoint-2' },
    ])

    await send(['league-a'])

    expect(h.sendPushToUser).toHaveBeenCalledTimes(1)
    expect(h.sendPushToUser.mock.calls[0][0]).toBe('user-1')
  })

  it('a push rejection does not take down the in-app row', async () => {
    h.sendPushToUser.mockRejectedValue(new Error('vapid exploded'))

    await send(['league-a'])

    expect(h.createPlatformNotification).toHaveBeenCalledTimes(1)
  })
})
