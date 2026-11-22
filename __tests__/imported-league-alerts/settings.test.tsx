import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationPreferences } from '@/lib/notification-settings/types'
const h = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('@/components/i18n/LanguageProviderClient', async (original) => {
  const actual = await original<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue, useOptionalLanguage: () => actual.defaultLanguageValue }
})
vi.mock('@/components/chimmy-surfaces/ChimmyAlertPreferencesPanel', () => ({ default: () => null }))
vi.mock('@/components/notifications/EnableWebPushCard', () => ({ EnableWebPushCard: () => null }))
vi.mock('@/components/notifications/IosAppPushCard', () => ({ IosAppPushCard: () => null }))
vi.mock('@/components/settings/TeamFollowsSettingsCard', () => ({ default: () => null }))
vi.mock('@/components/notification-settings/LeagueNotificationOverridesCard', () => ({ LeagueNotificationOverridesCard: () => null }))
vi.mock('@/lib/notification-settings', async (original) => ({
  ...await original<typeof import('@/lib/notification-settings')>(), updateNotificationPreferences: h.save,
}))
import { NotificationsSettingsSection } from '@/app/settings/components/sections/NotificationsSettingsSection'
import { getNotificationPreferencesFingerprint, resolveNotificationPreferences } from '@/lib/notification-settings/NotificationPreferenceResolver'
import { IMPORTED_NOTIFICATION_CATEGORY_IDS } from '@/lib/notification-settings/types'
import { mergeNotificationPreferences } from '@/lib/notification-settings/mergeNotificationPreferences'
import { decidePush } from '@/lib/notifications/pushGate'

beforeEach(() => { vi.clearAllMocks(); h.save.mockResolvedValue({ ok: true }) })
afterEach(cleanup)
function renderSettings(prefs: NotificationPreferences = {}) {
  return render(<NotificationsSettingsSection profile={{ email: 'manager@example.com', notificationPreferences: prefs } as never} onRefetch={vi.fn()} />)
}
describe('Imported league alert preferences', () => {
  it('renders four independent opt-in toggles alongside existing categories and saves without changing native preferences', async () => {
    renderSettings({ categories: { chat_mentions: { enabled: false, inApp: true, email: false, sms: false } } })
    const section = screen.getByRole('region', { name: 'Imported league alerts' })
    expect(within(section).getAllByRole('switch')).toHaveLength(4)
    const scoring = within(section).getByRole('switch', { name: 'Imported league scoring enabled' }) as HTMLInputElement
    expect(scoring.checked).toBe(false)
    fireEvent.click(scoring)
    expect(scoring.checked).toBe(true)
    expect((within(section).getByRole('switch', { name: 'Imported league completed trades enabled' }) as HTMLInputElement).checked).toBe(false)
    fireEvent.click(screen.getByTestId('notifications-save-button'))
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1))
    expect(h.save.mock.calls[0][0].categories.imported_scoring.enabled).toBe(true)
    expect(h.save.mock.calls[0][0].categories.chat_mentions.enabled).toBe(false)
  })
  it('offers push, email and in-app delivery for imported categories and reloads saved choices', () => {
    renderSettings({ categories: { imported_trade: { enabled: true, inApp: false, push: false, email: true, sms: false } } })
    fireEvent.click(screen.getByRole('button', { name: /Imported league completed trades/ }))
    expect((screen.getByLabelText('Imported league completed trades In-app') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText('Imported league completed trades Push') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText('Imported league completed trades Email') as HTMLInputElement).checked).toBe(true)
  })
  it('round-trips imported category choices through the profile merge and preference resolver', () => {
    const saved = mergeNotificationPreferences({ categories: { chat_mentions: { enabled: false } }, aiSettings: { keep: true } }, {
      categories: { imported_scoring: { enabled: true, inApp: true, push: false, email: false, sms: false } },
    })
    const resolved = resolveNotificationPreferences(saved as NotificationPreferences)
    expect(resolved.categories?.imported_scoring).toMatchObject({ enabled: true, push: false })
    expect(resolved.categories?.chat_mentions?.enabled).toBe(false)
    expect(saved.aiSettings).toEqual({ keep: true })
    expect(getNotificationPreferencesFingerprint(saved as NotificationPreferences)).not.toBe(getNotificationPreferencesFingerprint({}))
  })
  it('requires opt-in for imported push and respects the account, league, push switch and quiet hours', () => {
    const base = { category: 'imported_scoring' as const, leagueId: 'l1', severity: 'low' as const, now: new Date('2026-11-17T18:00:00Z') }
    expect(decidePush({}, base)).toEqual({ allowed: false, reason: 'category_off' })
    const prefs: NotificationPreferences = { categories: { imported_scoring: { enabled: true, inApp: true, push: true, email: false, sms: false } } }
    for (const category of IMPORTED_NOTIFICATION_CATEGORY_IDS) {
      expect(decidePush({ categories: { [category]: { enabled: true, inApp: true, push: true, email: false, sms: false } } }, { ...base, category })).toEqual({ allowed: true })
    }
    expect(decidePush({ ...prefs, globalEnabled: false }, base)).toHaveProperty('reason', 'global_off')
    expect(decidePush({ ...prefs, leagues: { l1: { enabled: false } } }, base)).toHaveProperty('reason', 'league_muted')
    expect(decidePush({ ...prefs, leagues: { l1: { mutedCategories: ['imported_scoring'] } } }, base)).toHaveProperty('reason', 'league_muted')
    expect(decidePush({ categories: { imported_scoring: { ...prefs.categories!.imported_scoring!, push: false } } }, base)).toHaveProperty('reason', 'push_off')
    expect(decidePush({ ...prefs, quietHours: { enabled: true, startHour: 17, endHour: 20, timezone: 'UTC' } }, base)).toHaveProperty('reason', 'quiet_hours')
  })
})
