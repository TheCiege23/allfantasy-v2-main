// @vitest-environment node
/**
 * The two new settings categories (2026-09-25):
 *   direct_messages  "Direct messages & huddles" — bell + push + email ON, SMS OFF until opted in
 *   league_chat      "League chat messages"      — OFF on every channel until opted in
 */
import { describe, expect, it } from 'vitest'

import {
  NOTIFICATION_CATEGORY_IDS,
  NOTIFICATION_CATEGORY_LABELS,
  OPT_IN_NOTIFICATION_CATEGORY_IDS,
} from '@/lib/notification-settings/types'
import {
  getDefaultCategoryPreferences,
  getDefaultNotificationPreferences,
  getNotificationPreferencesFingerprint,
  resolveNotificationPreferences,
} from '@/lib/notification-settings/NotificationPreferenceResolver'
import { isPushCategory } from '@/lib/push-notifications/categories'
import { decidePush } from '@/lib/notifications/pushGate'
import { categoryFromMeta } from '@/lib/core-app/notificationMutes'

describe('direct_messages', () => {
  it('is a listed, labelled, push-capable category', () => {
    expect(NOTIFICATION_CATEGORY_IDS).toContain('direct_messages')
    expect(NOTIFICATION_CATEGORY_LABELS.direct_messages).toMatch(/direct message/i)
    expect(isPushCategory('direct_messages')).toBe(true)
  })

  it('🛑 defaults: bell, push and email ON; SMS OFF — for someone who never opened settings', () => {
    expect(resolveNotificationPreferences(null).categories?.direct_messages).toEqual({
      enabled: true,
      inApp: true,
      email: true,
      sms: false,
      push: true,
    })
  })

  it('an existing saved row (which predates the category) gets the defaults, not silence', () => {
    const prefs = resolveNotificationPreferences({
      globalEnabled: true,
      categories: { chat_mentions: { enabled: true, inApp: true, email: false, sms: false } },
    })
    expect(prefs.categories?.direct_messages).toMatchObject({ enabled: true, inApp: true, push: true })
  })

  it('push is allowed by default, and a saved switch-off is honoured by the push gate', () => {
    expect(decidePush(null, { category: 'direct_messages', severity: 'low' })).toEqual({ allowed: true })
    expect(
      decidePush(
        { categories: { direct_messages: { enabled: true, inApp: true, email: true, sms: false, push: false } } },
        { category: 'direct_messages', severity: 'low' },
      ),
    ).toEqual({ allowed: false, reason: 'push_off' })
  })

  it('a DM bell row can be muted from the notifications center', () => {
    expect(categoryFromMeta({ notificationCategory: 'direct_messages' })).toBe('direct_messages')
  })
})

describe('league_chat — opt-in', () => {
  it('is listed, labelled, push-capable, and marked opt-in', () => {
    expect(NOTIFICATION_CATEGORY_IDS).toContain('league_chat')
    expect(NOTIFICATION_CATEGORY_LABELS.league_chat).toMatch(/league chat/i)
    expect(isPushCategory('league_chat')).toBe(true)
    expect(OPT_IN_NOTIFICATION_CATEGORY_IDS).toContain('league_chat')
  })

  it('🛑 defaults OFF on every channel', () => {
    const off = { enabled: false, inApp: false, email: false, sms: false, push: false }
    expect(getDefaultCategoryPreferences('league_chat')).toEqual(off)
    expect(getDefaultNotificationPreferences().categories?.league_chat).toEqual(off)
    expect(resolveNotificationPreferences(null).categories?.league_chat).toEqual(off)
    expect(decidePush(null, { category: 'league_chat', severity: 'low' })).toEqual({ allowed: false, reason: 'category_off' })
  })

  it('switching it on with only `enabled` does not quietly switch email on', () => {
    const cat = resolveNotificationPreferences({ categories: { league_chat: { enabled: true, inApp: true } as never } }).categories
      ?.league_chat
    expect(cat).toMatchObject({ enabled: true, inApp: true, email: false, sms: false })
  })

  it('every other category keeps its on-by-default (only the opt-in list changed)', () => {
    for (const id of NOTIFICATION_CATEGORY_IDS) {
      if (OPT_IN_NOTIFICATION_CATEGORY_IDS.includes(id)) continue
      expect(getDefaultCategoryPreferences(id)).toMatchObject({ enabled: true, inApp: true, email: true, sms: false })
    }
  })

  it('the settings fingerprint sees a league_chat change', () => {
    const base = getDefaultNotificationPreferences()
    const on = { ...base, categories: { ...base.categories, league_chat: { enabled: true, inApp: true, email: false, sms: false, push: true } } }
    expect(getNotificationPreferencesFingerprint(on)).not.toBe(getNotificationPreferencesFingerprint(base))
  })
})
