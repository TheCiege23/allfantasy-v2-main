// @vitest-environment node
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Three things people saw or missed (2026-11-15):
 *   1. the injury FINAL CALL text near lock — written and approved, and refused by the SMS policy every time;
 *   2. sample notifications ("Rival GM mentioned you…") shown in the right rail to people with none;
 *   3. phone alert buttons keyed on types nothing sends, opening pages that do not exist.
 */

const h = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  sendSms: vi.fn(async () => true),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: { create: vi.fn(async () => ({})), delete: vi.fn(async () => ({})) },
    notificationOutbox: { create: vi.fn(async () => ({})) },
  },
}))
vi.mock('@/lib/notifications/durableTransport', () => ({ deliverDurably: async (_m: unknown, send: () => Promise<void>) => { await send(); return 'sent' } }))
vi.mock('@/lib/user-settings', () => ({ getSettingsProfile: async () => h.profile }))
vi.mock('@/lib/platform/notification-service', () => ({ createPlatformNotification: vi.fn(async () => ({})) }))
vi.mock('@/lib/resend-client', () => ({ sendNotificationEmail: vi.fn(async () => ({ ok: true })), sendTemplatedEmail: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/twilio-client', () => ({ sendSms: h.sendSms }))
vi.mock('@/lib/notifications/smsDailyCap', () => ({ reserveSmsToday: vi.fn(async () => true) }))
vi.mock('@/lib/push-notifications', () => ({ sendPushToUser: vi.fn(async () => []) }))

import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { allowsLeagueEventSms, isSmsCategory } from '@/lib/notifications/channelPolicy'
import { mergeWithPlaceholders } from '@/lib/notifications/placeholder'

const PHONE = '+15555550123'

describe('the injury final call texts', () => {
  beforeEach(() => {
    h.sendSms.mockClear()
    h.profile = {
      userId: 'u-1',
      email: null,
      phone: PHONE,
      phoneVerifiedAt: new Date('2026-10-01'),
      timezone: 'America/New_York',
      notificationPreferences: { smsConsent: { consentedAt: '2026-10-01T00:00:00.000Z', phone: PHONE } },
      emailSubscription: { unsubscribedAt: null },
    }
  })

  const finalCall = (over: Record<string, unknown> = {}) =>
    dispatchNotification({
      userIds: ['u-1'],
      category: 'injury_alerts',
      type: 'chimmy_alert',
      severity: 'high',
      title: 'Final call: Puka Nacua is out',
      body: 'Still in your lineup.',
      leagueId: null,
      smsBody: 'Final call: Puka Nacua is out and still starting. Fix: https://allfantasy.ai/x',
      dedupePrefix: 'inj:final',
      ...over,
    } as never)

  it('reaches a consented, verified phone — with no league, since one text can cover several', async () => {
    await finalCall()
    expect(h.sendSms).toHaveBeenCalledTimes(1)
    expect((h.sendSms.mock.calls[0] as unknown as [string, string])[1]).toContain('Final call: Puka Nacua')
  })

  it('still needs consent: a withdrawn STOP means no text', async () => {
    h.profile!.notificationPreferences = { smsConsent: { consentedAt: 'a', phone: PHONE, revokedAt: 'b', revokedReason: 'sms_stop' } }
    await finalCall()
    expect(h.sendSms).not.toHaveBeenCalled()
  })

  it('only that alert: player news, digests and lineup-impact alerts under the same category never text', () => {
    expect(allowsLeagueEventSms('injury_alerts', null, { type: 'chimmy_alert', severity: 'high' })).toBe(true)
    expect(allowsLeagueEventSms('injury_alerts', null, { type: 'chimmy_alert', severity: 'medium' })).toBe(false)
    expect(allowsLeagueEventSms('injury_alerts', 'lg-1', { type: 'player_injury_update', severity: 'high' })).toBe(false)
    expect(allowsLeagueEventSms('injury_alerts', null, { type: 'player_news_digest', severity: 'low' })).toBe(false)
    expect(allowsLeagueEventSms('injury_alerts', 'lg-1', { type: 'injured_starter', severity: 'high' })).toBe(false)
  })

  it('Settings offers its SMS switch, so a person can turn it off', () => {
    expect(isSmsCategory('injury_alerts')).toBe(true)
    expect(isSmsCategory('draft_alerts')).toBe(true)
    expect(isSmsCategory('player_news' as never)).toBe(false)
    expect(isSmsCategory('league_chat')).toBe(false)
  })
})

describe('no sample notifications for real people', () => {
  it('an empty bell stays empty unless a screen asks for samples', () => {
    expect(mergeWithPlaceholders([])).toEqual([])
    expect(mergeWithPlaceholders([], true).length).toBeGreaterThan(0)
    const src = readFileSync('hooks/useNotifications.ts', 'utf8')
    expect(src).toMatch(/usePlaceholders \?\? false/)
  })
})

describe('phone alert buttons', () => {
  function worker() {
    const handlers: Record<string, (event: unknown) => void> = {}
    const shown: Array<{ title: string; options: { actions: Array<{ action: string; title: string }>; data: unknown } }> = []
    const opened: string[] = []
    runInNewContext(readFileSync('public/sw.js', 'utf8'), {
      self: {
        addEventListener: (name: string, fn: (event: unknown) => void) => { handlers[name] = fn },
        registration: { showNotification: (title: string, options: never) => { shown.push({ title, options }); return Promise.resolve() } },
        location: { origin: 'https://allfantasy.ai' },
      },
      clients: { matchAll: async () => [], openWindow: async (u: string) => { opened.push(u) } },
      URL, Date, console,
    })
    const push = (payload: Record<string, unknown>) => handlers.push!({ data: { json: () => payload }, waitUntil: () => {} })
    const click = async (action: string) => {
      let p: Promise<unknown> = Promise.resolve()
      handlers.notificationclick!({ action, notification: { close: () => {}, data: shown.at(-1)!.options.data }, waitUntil: (x: Promise<unknown>) => { p = x } })
      await p
    }
    return { push, click, shown, opened }
  }

  it('the types the app really sends get a named button', () => {
    const w = worker()
    const title = (type: string) => { w.push({ title: 't', type, url: '/x' }); return w.shown.at(-1)!.options.actions[0]!.title }
    expect(title('trade_proposed')).toBe('View trade')
    expect(title('waiver_won')).toBe('View waivers')
    expect(title('draft_on_the_clock')).toBe('Open draft')
    expect(title('matchup_final')).toBe('View matchup')
    expect(title('direct_message')).toBe('Reply')
    expect(title('chimmy_alert')).toBe('Open')
  })

  it("every button opens the alert's own page; Dismiss opens nothing", async () => {
    const w = worker()
    w.push({ title: 't', type: 'trade_proposed', url: '/league/lg-1?tab=trades', leagueId: 'lg-1' })
    await w.click('open')
    await w.click('')
    expect(w.opened).toEqual(['/league/lg-1?tab=trades', '/league/lg-1?tab=trades'])
    await w.click('dismiss')
    expect(w.opened).toHaveLength(2)
    expect(w.opened.join()).not.toMatch(/\/app\/league\/[^/]+\/(trades|scores)/)
  })
})
