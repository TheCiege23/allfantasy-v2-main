import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/i18n/LanguageProviderClient', async (original) => {
  const actual = await original<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue, useOptionalLanguage: () => actual.defaultLanguageValue }
})
vi.mock('@/components/chimmy-surfaces/ChimmyAlertPreferencesPanel', () => ({ default: () => null }))
vi.mock('@/components/notifications/EnableWebPushCard', () => ({ EnableWebPushCard: () => null }))
vi.mock('@/components/notifications/IosAppPushCard', () => ({ IosAppPushCard: () => null }))
vi.mock('@/components/settings/TeamFollowsSettingsCard', () => ({ default: () => null }))
vi.mock('@/components/notification-settings/LeagueNotificationOverridesCard', () => ({ LeagueNotificationOverridesCard: () => null }))

import { NotificationsSettingsSection } from '@/app/settings/components/sections/NotificationsSettingsSection'

afterEach(cleanup)

/** Source with comments removed, so a comment describing a removed thing cannot satisfy or fail a check. */
function code(rel: string): string {
  return fs
    .readFileSync(path.join(process.cwd(), rel), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('Settings › Notifications on a phone (2026-11-25 simplify pass)', () => {
  function renderIt() {
    return render(
      <NotificationsSettingsSection
        profile={{ email: 'manager@example.com', notificationPreferences: { categories: { chat_mentions: { enabled: false, inApp: true, email: false, sms: false } } } } as never}
        onRefetch={vi.fn()}
      />,
    )
  }

  it('folds the category list into a closed row that says how many are on', () => {
    renderIt()
    const fold = screen.getByTestId('notifications-categories')
    expect(fold.tagName).toBe('DETAILS')
    expect(fold.hasAttribute('open')).toBe(false)
    expect(within(fold).getByRole('button', { name: /Waiver processing/ })).toBeTruthy()
    const count = screen.getByTestId('notifications-categories-count').textContent ?? ''
    const m = count.match(/^(\d+) of (\d+) on$/)
    expect(m).not.toBeNull()
    // chat_mentions is off, so not every category is on.
    expect(Number(m![1])).toBeLessThan(Number(m![2]))
  })

  it('folds imported-league alerts, the test send and Chimmy controls', () => {
    renderIt()
    const imported = screen.getByRole('region', { name: 'Imported league alerts' })
    expect(imported.querySelector('details:not([open])')).not.toBeNull()
    expect(within(imported).getByText('0 of 4 on')).toBeTruthy()
    for (const id of ['notifications-test-fold', 'notifications-chimmy-fold']) {
      const el = screen.getByTestId(id)
      expect(el.tagName).toBe('DETAILS')
      expect(el.hasAttribute('open')).toBe(false)
    }
  })

  it('spells out only the chosen level, drops the intro and the Back to profile link', () => {
    renderIt()
    // One chosen level in Live game alerts, one in Player news.
    expect(screen.getAllByTestId('notifications-level-definition')).toHaveLength(2)
    expect(within(screen.getByTestId('notifications-live-level-close_games')).queryByTestId('notifications-level-definition')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Choose how you receive alerts/)
    expect(screen.queryByTestId('notifications-back-to-profile-link')).toBeNull()
  })
})

describe('Settings › Preferences and Security (2026-11-25 simplify pass)', () => {
  it('Preferences keeps Chimmy and AutoCoach behind one closed row and has no intro line', () => {
    const src = code('app/settings/components/sections/PreferencesSettingsSection.tsx')
    const fold = src.slice(src.indexOf('settings-preferences-chimmy-fold'))
    expect(src).toMatch(/<details[^>]*data-testid="settings-preferences-chimmy-fold"/)
    for (const card of ['<ChimmyVoiceSettingsCard', '<ChimmyPreferencesCard', '<AutoCoachSettingsCard']) {
      expect(src.match(new RegExp(card, 'g'))).toHaveLength(1)
      expect(fold.slice(0, fold.indexOf('</details>'))).toContain(card)
    }
    expect(src).not.toContain('settings.preferences.subtitle')
  })

  it('Security has no two-factor card that only says it is not available', () => {
    expect(code('app/settings/components/sections/SecuritySettingsSection.tsx')).not.toMatch(/twoFactor/)
  })
})
