import { describe, it, expect } from 'vitest'
import { liveAlertAllowed, readLiveAlertLevel, LIVE_ALERT_LEVELS, DEFAULT_LIVE_ALERT_LEVEL, LIVE_ALERT_LEVEL_LABEL_KEYS } from '@/lib/notification-settings/liveAlertLevel'
import { resolveNotificationPreferences, getNotificationPreferencesFingerprint } from '@/lib/notification-settings/NotificationPreferenceResolver'
import { buildResetNotificationPreferences } from '@/lib/notification-settings/resetNotificationPreferences'
import { translations } from '@/lib/i18n/translations'
import { translationsEsParity } from '@/lib/i18n/translations-es-parity'

describe('live alert levels do what the settings screen says', () => {
  const allowed = (level: Parameters<typeof liveAlertAllowed>[0], inGame: boolean) =>
    (['starter_play', 'play', 'checkpoint', 'final', 'recap', 'close'] as const).filter(k => liveAlertAllowed(level, k, { inGame }))
  it('Everything: all of it, from your games and close games anywhere', () => {
    expect(allowed('everything', true)).toEqual(['starter_play', 'play', 'checkpoint', 'final', 'recap', 'close'])
    expect(allowed('everything', false)).toContain('close')
  })
  it('My teams & players: only games you are in — no close games from other games', () => {
    expect(allowed('my_teams', true)).toEqual(['starter_play', 'play', 'checkpoint', 'final', 'recap', 'close'])
    expect(allowed('my_teams', false)).toEqual(['starter_play', 'recap'])
  })
  it('Close games only: close finishes and overtime, nothing else', () => {
    expect(allowed('close_games', true)).toEqual(['close'])
    expect(allowed('close_games', false)).toEqual(['close'])
  })
  it('Off: nothing', () => {
    expect(allowed('off', true)).toEqual([])
  })
  it('reads an absent or unknown level as the default, which is what everyone had before', () => {
    expect(DEFAULT_LIVE_ALERT_LEVEL).toBe('everything')
    expect(readLiveAlertLevel(null)).toBe('everything')
    expect(readLiveAlertLevel({ liveAlertLevel: 'loud' })).toBe('everything')
    expect(readLiveAlertLevel({ liveAlertLevel: 'off' })).toBe('off')
  })
  it('keeps a saved level through load, notices a change, and resets it', () => {
    expect(resolveNotificationPreferences({ liveAlertLevel: 'close_games' }).liveAlertLevel).toBe('close_games')
    expect(resolveNotificationPreferences({ categories: {}, liveAlertLevel: 'off' }).liveAlertLevel).toBe('off')
    expect(getNotificationPreferencesFingerprint({ liveAlertLevel: 'off' })).not.toBe(getNotificationPreferencesFingerprint({}))
    expect(getNotificationPreferencesFingerprint({ liveAlertLevel: 'everything' })).toBe(getNotificationPreferencesFingerprint({}))
    expect(buildResetNotificationPreferences({ liveAlertLevel: 'off' }).liveAlertLevel).toBe('everything')
  })
  it('has a name and a definition for every level in English and Spanish', () => {
    for (const level of LIVE_ALERT_LEVELS) {
      for (const key of Object.values(LIVE_ALERT_LEVEL_LABEL_KEYS[level])) {
        expect(translations.en[key], key).toBeTruthy()
        expect(translations.es?.[key] ?? translationsEsParity[key], key).toBeTruthy()
      }
    }
  })
})
