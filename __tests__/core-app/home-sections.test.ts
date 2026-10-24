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
  homeSectionMutingCategory,
  isCategoryHiddenByHomeSection,
  readHiddenHomeSections,
  toggleHomeSection,
} from '@/lib/core-app/homeSections'
import { HOME_CARD_GROUPS } from '@/lib/core-app/homeCardOrder'
import { NOTIFICATION_CATEGORY_IDS } from '@/lib/notification-settings/types'
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

  it('maps only real categories, each to one section', () => {
    const seen = new Map<string, string>()
    for (const section of HOME_SECTIONS) {
      for (const c of section.categories) {
        expect(NOTIFICATION_CATEGORY_IDS).toContain(c)
        expect(seen.get(c), `${c} mapped twice`).toBeUndefined()
        seen.set(c, section.id)
      }
    }
  })

  it('🛑 never silences an alert that needs the person to act', () => {
    const everything = { hiddenHomeSections: HOME_SECTIONS.map((s) => s.id) }
    // On the clock in a draft, and a trade offer sent TO you.
    expect(isCategoryHiddenByHomeSection(everything, 'draft_alerts')).toBe(false)
    expect(isCategoryHiddenByHomeSection(everything, 'trade_proposals')).toBe(false)
    expect(isCategoryHiddenByHomeSection(everything, 'direct_messages')).toBe(false)
    expect(isCategoryHiddenByHomeSection(everything, 'commissioner_alerts')).toBe(false)
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
    expect(homeSectionMutingCategory({ hiddenHomeSections: ['league-trades'] }, 'trade_accept_reject')).toBe(
      'league-trades',
    )
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

describe('a hidden section stops its notifications at send time', () => {
  const prefs = (hidden: string[]) => ({
    globalEnabled: true,
    categories: { trade_accept_reject: { ...ON }, trade_proposals: { ...ON } },
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
  const send = (category: 'trade_accept_reject' | 'trade_proposals') =>
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

  it('suppresses bell, email and push for the hidden section’s category', async () => {
    m.profile.mockResolvedValue(profile(prefs(['league-trades'])))
    await send('trade_accept_reject')
    expect(m.store).not.toHaveBeenCalled()
    expect(m.email).not.toHaveBeenCalled()
    expect(m.push).not.toHaveBeenCalled()
    expect(m.receipt.mock.calls[0][0].channels.inApp).toMatchObject({ status: 'suppressed', reason: 'home_section_hidden' })
  })

  it('leaves a trade OFFER sent to you alone while league trades are hidden', async () => {
    m.profile.mockResolvedValue(profile(prefs(['league-trades'])))
    await send('trade_proposals')
    expect(m.store).toHaveBeenCalledTimes(1)
  })

  it('positive control: the same alert goes out once the section is shown again', async () => {
    m.profile.mockResolvedValue(profile(prefs([])))
    await send('trade_accept_reject')
    expect(m.store).toHaveBeenCalledTimes(1)
  })

  it('the push gate refuses it too, for pushes sent outside the dispatcher', () => {
    const input = { category: 'trade_accept_reject' as const, leagueId: 'L', severity: 'medium' as const }
    expect(decidePush(prefs(['league-trades']), input)).toEqual({ allowed: false, reason: 'home_section_hidden' })
    expect(decidePush(prefs([]), input)).toEqual({ allowed: true })
  })
})
