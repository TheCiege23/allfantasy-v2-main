// @vitest-environment node
/**
 * The `followed_players` notification category (2026-09-14): a real setting with its own push
 * switch, on by default for someone who followed a player, and gated like every other push.
 */
import { describe, expect, it } from 'vitest'

import {
  NOTIFICATION_CATEGORY_IDS,
  NOTIFICATION_CATEGORY_LABELS,
} from '@/lib/notification-settings/types'
import { PUSH_NOTIFICATION_CATEGORIES, isPushCategory } from '@/lib/push-notifications/categories'
import { resolveNotificationPreferences } from '@/lib/notification-settings/NotificationPreferenceResolver'
import { categoryFromMeta } from '@/lib/core-app/notificationMutes'

describe('followed_players category', () => {
  it('🛑 is a listed, labelled category — so the settings card and its switches render', () => {
    expect(NOTIFICATION_CATEGORY_IDS).toContain('followed_players')
    expect(NOTIFICATION_CATEGORY_LABELS.followed_players).toMatch(/follow/i)
  })

  it('🛑 is push-capable, so the push switch is drawn and pushGate can allow it', () => {
    expect(PUSH_NOTIFICATION_CATEGORIES).toContain('followed_players')
    expect(isPushCategory('followed_players')).toBe(true)
  })

  it('defaults on (in-app and push) for a user who never opened settings', () => {
    const prefs = resolveNotificationPreferences(null)
    expect(prefs.categories?.followed_players).toMatchObject({ enabled: true, inApp: true, push: true })
  })

  it('a stored switch-off is honoured', () => {
    const prefs = resolveNotificationPreferences({
      categories: { followed_players: { enabled: false, inApp: false, email: false, sms: false } },
    })
    expect(prefs.categories?.followed_players?.enabled).toBe(false)
  })

  it('a followed-player row can be muted from the notifications center', () => {
    expect(categoryFromMeta({ notificationCategory: 'followed_players' })).toBe('followed_players')
  })
})
