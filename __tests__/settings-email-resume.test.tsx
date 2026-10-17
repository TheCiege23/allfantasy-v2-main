import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * Settings › Notifications after an Unsubscribe (2026-10-03). The dispatcher now withholds alert
 * emails for an unsubscribed address, so the email switches would read ON while nothing arrives.
 * The section says so and offers the way back.
 */

vi.mock('@/components/chimmy-surfaces/ChimmyAlertPreferencesPanel', () => ({ default: () => null }))
vi.mock('@/components/notification-settings/LeagueNotificationOverridesCard', () => ({
  LeagueNotificationOverridesCard: () => null,
}))
vi.mock('@/components/notifications/EnableWebPushCard', () => ({ EnableWebPushCard: () => null }))
vi.mock('@/components/notifications/IosAppPushCard', () => ({ IosAppPushCard: () => null }))
// Nested in the same section and fetching its own data; stubbed like the other children (2026-10-03).
vi.mock('@/components/settings/TeamFollowsSettingsCard', () => ({ default: () => null }))
vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})

import { NotificationsSettingsSection } from '@/app/settings/components/sections/NotificationsSettingsSection'

const baseProfile = {
  userId: 'u-1',
  email: 'manager@allfantasy-test.net',
  notificationPreferences: null,
  phone: null,
  phoneVerifiedAt: null,
  timezone: 'America/New_York',
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderWith(emailSubscription: unknown) {
  const onRefetch = vi.fn()
  render(
    <NotificationsSettingsSection
      profile={{ ...baseProfile, emailSubscription } as never}
      onRefetch={onRefetch}
    />,
  )
  return onRefetch
}

describe('Settings › Notifications after an Unsubscribe', () => {
  it('says alert emails are off since the unsubscribe, and resumes them', async () => {
    // Over the wire the date arrives as a string, which is exactly what the section must handle.
    const onRefetch = renderWith({ unsubscribedAt: '2026-10-01T12:00:00.000Z' })
    expect(screen.getByTestId('settings-email-unsubscribed').textContent).toMatch(/unsubscribed from alert emails/i)
    fireEvent.click(screen.getByTestId('settings-email-resume'))
    await waitFor(() => expect(onRefetch).toHaveBeenCalled())
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/user/settings') as unknown as [string, RequestInit]
    expect(call[1].method).toBe('PATCH')
    expect(JSON.parse(String(call[1].body))).toEqual({ emailResubscribe: true })
  })

  it('shows nothing for a subscribed address, an unknown state, or no state', () => {
    for (const state of [{ unsubscribedAt: null }, 'unknown', undefined]) {
      renderWith(state)
      expect(screen.queryByTestId('settings-email-unsubscribed')).toBeNull()
      cleanup()
    }
  })

  it('reports a failed resume and does not pretend it worked', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 503 }))
    const onRefetch = renderWith({ unsubscribedAt: '2026-10-01T12:00:00.000Z' })
    fireEvent.click(screen.getByTestId('settings-email-resume'))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(onRefetch).not.toHaveBeenCalled()
  })
})
