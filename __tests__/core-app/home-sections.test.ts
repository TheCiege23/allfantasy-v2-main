import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Settings → Home page (2026-10-24): switching a /core home section off hides its card AND stops
 * the notifications that come from it. See lib/core-app/homeSections.ts.
 *
 * The send-time half is tested through the REAL dispatcher and push gate, not the helper alone —
 * a helper that answers correctly while no sender calls it is the failure this repo keeps finding.
 */

const m = vi.hoisted(() => ({
  profile: vi.fn(),
  store: vi.fn(),
  email: vi.fn(),
  sms: vi.fn(),
  push: vi.fn(),
  cap: vi.fn(),
  receipt: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/notifications/durableTransport', () => ({
  deliverDurably: async (_message: unknown, send: () => Promise<unknown>) => {
    const r = await send()
    return r === 'unavailable' ? 'skipped' : 'sent'
  },
}))
vi.mock('@/lib/user-settings', () => ({ getSettingsProfile: m.profile }))
vi.mock('@/lib/platform/notification-service', () => ({ createPlatformNotification: m.store }))
vi.mock('@/lib/resend-client', () => ({ sendNotificationEmail: m.email, sendTemplatedEmail: m.email }))
vi.mock('@/lib/twilio-client', () => ({ sendSms: m.sms }))
vi.mock('@/lib/push-notifications', () => ({ sendPushToUser: m.push }))
vi.mock('@/lib/notifications/smsDailyCap', () => ({ reserveSmsToday: m.cap }))

import {
  HOME_SECTIONS,
  hiddenHomeCards,
  readHiddenHomeSections,
  toggleHomeSection,
} from '@/lib/core-app/homeSections'
import { HOME_CARD_GROUPS } from '@/lib/core-app/homeCardOrder'
import { decidePush } from '@/lib/notifications/pushGate'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { translations } from '@/lib/i18n/translations'
import { translationsEsParity } from '@/lib/i18n/translations-es-parity'

const ON = { enabled: true, inApp: true, email: true, sms: false, push: true }

describe('the section map', () => {
  it('names only cards the home actually renders, and never the league list or the coverage note', () => {
    // HomeCardName (components/core-app/home/HomeCards.tsx) is a type, so read the union from source.
    const src = readFileSync(join(process.cwd(), 'components/core-app/home/HomeCards.tsx'), 'utf8')
    const union = src.slice(src.indexOf('export type HomeCardName'), src.indexOf('/** Holds a card'))
    const names = new Set([...union.matchAll(/'([a-z-]+)'/g)].map((x) => x[1]))
    expect(names.size).toBeGreaterThan(15)
    for (const section of HOME_SECTIONS) for (const card of section.cards) expect(names, card).toContain(card)
    const all = hiddenHomeCards(new Set(HOME_SECTIONS.map((s) => s.id)))
    expect(all.has('leagues')).toBe(false)
    expect(all.has('coverage')).toBe(false)
  })

  it('covers every orderable card, so no card on the home is impossible to switch off by accident', () => {
    const all = hiddenHomeCards(new Set(HOME_SECTIONS.map((s) => s.id)))
    for (const card of Object.values(HOME_CARD_GROUPS).flat()) expect(all, card).toContain(card)
  })

  it('🛑 a section is layout only — it carries no notification categories (owner, 2026-11-22)', () => {
    for (const section of HOME_SECTIONS) expect(Object.keys(section).sort(), section.id).toEqual(['cards', 'group', 'id'])
  })

  it('reads only known ids from a stored list, and nothing from a malformed one', () => {
    expect([...readHiddenHomeSections({ hiddenHomeSections: ['drafts', 'nope', 7, 'rivals'] })]).toEqual([
      'drafts',
      'rivals',
    ])
    expect(readHiddenHomeSections({ hiddenHomeSections: 'drafts' }).size).toBe(0)
    expect(readHiddenHomeSections(null).size).toBe(0)
    expect(readHiddenHomeSections({}).size).toBe(0)
  })

  it('toggles to a stable, page-ordered list', () => {
    let hidden = new Set<ReturnType<typeof toggleHomeSection>[number]>()
    hidden = new Set(toggleHomeSection(hidden, 'rivals', false))
    hidden = new Set(toggleHomeSection(hidden, 'streak', false))
    expect([...hidden]).toEqual(['streak', 'rivals'])
    expect(toggleHomeSection(hidden, 'streak', true)).toEqual(['rivals'])
  })

  it('has English and Spanish copy for every section', () => {
    const en = translations.en
    for (const s of HOME_SECTIONS) {
      for (const part of ['title', 'desc']) {
        const key = `settings.home.section.${s.id}.${part}`
        expect(en[key], key).toBeTruthy()
        expect(translationsEsParity[key], key).toBeTruthy()
      }
    }
  })
})

/*
 * 🛑 Until 2026-11-22 a hidden section ALSO muted its alerts at send time. The owner's own account had
 * hidden Matchups and Live games to tidy the page and received zero scoring alerts for a week while the
 * Notifications tab showed them ON. Hiding a card must never change what is sent.
 */
describe('a hidden section never stops a notification', () => {
  const prefs = (hidden: string[]) => ({
    globalEnabled: true,
    categories: { trade_accept_reject: { ...ON }, trade_proposals: { ...ON }, matchup_results: { ...ON }, live_game_alerts: { ...ON } },
    hiddenHomeSections: hidden,
  })
  const profile = (np: unknown) => ({
    email: 'qa@allfantasy.ai',
    phone: null,
    phoneVerifiedAt: null,
    timezone: 'UTC',
    notificationPreferences: np,
    emailSubscription: { unsubscribedAt: null },
  })
  const send = (category: 'trade_accept_reject' | 'trade_proposals' | 'matchup_results' | 'live_game_alerts') =>
    dispatchNotification({
      userIds: ['u1'],
      leagueId: 'L',
      category,
      type: 'trade_update',
      title: 'Trade',
      onDeliveryReceipt: m.receipt,
    })

  beforeEach(() => {
    vi.clearAllMocks()
    m.store.mockResolvedValue(true)
    m.email.mockResolvedValue({ ok: true, providerId: 'e' })
    m.push.mockResolvedValue([{ ok: true }])
    m.cap.mockResolvedValue(true)
    m.receipt.mockResolvedValue(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('🛑 the owner\'s case: Matchups and Live games hidden, scoring alerts still reach bell, email and phone', async () => {
    m.profile.mockResolvedValue(profile(prefs(['matchups', 'live-games'])))
    await send('matchup_results')
    expect(m.store).toHaveBeenCalledTimes(1)
    expect(m.email).toHaveBeenCalledTimes(1)
    expect(m.push).toHaveBeenCalledTimes(1)
    await send('live_game_alerts')
    expect(m.store).toHaveBeenCalledTimes(2)
  })

  it('every section hidden: a trade offer sent to you still arrives (it was muted with League trades before)', async () => {
    m.profile.mockResolvedValue(profile(prefs(HOME_SECTIONS.map((section) => section.id))))
    await send('trade_proposals')
    expect(m.store).toHaveBeenCalledTimes(1)
    expect(m.push).toHaveBeenCalledTimes(1)
  })

  it('the push gate allows it too, for pushes sent outside the dispatcher', () => {
    const input = { category: 'matchup_results' as const, leagueId: 'L', severity: 'high' as const }
    expect(decidePush(prefs(HOME_SECTIONS.map((section) => section.id)), input)).toEqual({ allowed: true })
  })

  it('[control] the Notifications switch still decides: category off means nothing is sent', async () => {
    m.profile.mockResolvedValue(profile({ ...prefs([]), categories: { matchup_results: { ...ON, enabled: false } } }))
    await send('matchup_results')
    expect(m.store).not.toHaveBeenCalled()
    expect(m.push).not.toHaveBeenCalled()
  })
})
