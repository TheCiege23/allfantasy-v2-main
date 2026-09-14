import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

/*
 * The Settings hub — `/settings` with no `?tab` (2026-09-13 Settings handoff).
 *
 * ⚠ THESE ARE HONESTY AND REACHABILITY RULES, NOT LAYOUT ONES. The design draws a
 * price, a token allowance and an "OFF" badge; the hub may show a state only when
 * the client actually holds it, and every tab must stay one click from the
 * landing. The grid's look is the CSS's business.
 */

const ents = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ents.value }))
vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})

import { SETTINGS_NAV, SettingsChrome } from '@/app/settings/components/SettingsChrome'

const FREE = {
  loading: false,
  error: null,
  hasAnyPaid: false,
  hasSupreme: false,
  hasCommissioner: false,
  hasPro: false,
  hasWarRoom: false,
  isAdminBypassAccount: false,
  snapshot: { plans: [], status: 'none', currentPeriodEnd: null, gracePeriodEnd: null },
}

const SUPREME = {
  ...FREE,
  hasAnyPaid: true,
  hasSupreme: true,
  hasCommissioner: true,
  hasPro: true,
  hasWarRoom: true,
  snapshot: { plans: ['supreme'], status: 'active', currentPeriodEnd: '2027-01-15T00:00:00Z', gracePeriodEnd: null },
}

function profile(over: Record<string, unknown> = {}) {
  return {
    userId: 'u1',
    username: 'guap',
    displayName: 'Guap',
    profileImageUrl: null,
    avatarPreset: null,
    bio: 'Dynasty lifer.',
    preferredSports: ['NFL'],
    timezone: 'America/New_York',
    notificationPreferences: null,
    sleeperUserId: null,
    discordUserId: null,
    spotifyConnectedAt: null,
    xpLevel: 14,
    rankTier: 'All-Pro',
    ...over,
  } as never
}

function hub(p = profile(), onTabChange = vi.fn()) {
  return render(
    <SettingsChrome activeTab={null} onTabChange={onTabChange} onShowHub={vi.fn()} profile={p}>
      {null}
    </SettingsChrome>,
  )
}

beforeEach(() => {
  ents.value = FREE
})

describe('Settings hub', () => {
  it('puts every settings tab one click from the landing', () => {
    hub()
    const cards = screen.getAllByTestId(/^settings-hub-card-/).map((c) => c.dataset.testid)
    expect(cards.sort()).toEqual(SETTINGS_NAV.map((n) => `settings-hub-card-${n.id}`).sort())
    // The landing is the grid, not a tab with a sidebar.
    expect(screen.queryByTestId('settings-show-hub')).toBeNull()
  })

  it('opens the tab a card names', () => {
    const onTabChange = vi.fn()
    hub(profile(), onTabChange)
    fireEvent.click(screen.getByTestId('settings-hub-card-security'))
    expect(onTabChange).toHaveBeenCalledWith('security')
  })

  it('flags notifications OFF only when the saved preferences say so', () => {
    const off = hub(profile({ notificationPreferences: { globalEnabled: false } }))
    const offCard = screen.getByTestId('settings-hub-card-notifications')
    expect(offCard.dataset.tone).toBe('warn')
    expect(within(offCard).getByText('OFF')).toBeTruthy()
    off.unmount()

    hub(profile({ notificationPreferences: { globalEnabled: true } }))
    const card = screen.getByTestId('settings-hub-card-notifications')
    expect(card.dataset.tone).toBeUndefined()
    expect(within(card).queryByText('OFF')).toBeNull()
  })

  it('counts connected accounts from the profile, and shows no badge for none', () => {
    const none = hub()
    expect(within(screen.getByTestId('settings-hub-card-connected')).queryByText('0')).toBeNull()
    none.unmount()

    hub(profile({ sleeperUserId: 's1', discordUserId: 'd1' }))
    expect(within(screen.getByTestId('settings-hub-card-connected')).getByText('2')).toBeTruthy()
  })

  it('names the plan and its renewal, and never prints a price it does not hold', () => {
    ents.value = SUPREME
    hub()
    const banner = screen.getByRole('region', { name: /current plan/i })
    expect(banner.textContent).toContain('AF Supreme')
    expect(banner.textContent).not.toMatch(/\$\s?\d/)
    expect(banner.textContent).not.toMatch(/tokens\/mo/i)
    expect(within(banner).getByTestId('settings-hub-manage-billing').getAttribute('href')).toBe(
      '/api/subscription/billing-portal',
    )
  })

  it('sends an admin bypass to pricing — it has no Stripe customer to open', () => {
    ents.value = { ...SUPREME, isAdminBypassAccount: true }
    hub()
    expect(screen.queryByTestId('settings-hub-manage-billing')).toBeNull()
    expect(screen.getByTestId('settings-hub-pricing').getAttribute('href')).toBe('/pricing')
  })

  it('searches card descriptions as well as titles', () => {
    hub()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'password' } })
    expect(screen.getAllByTestId(/^settings-hub-card-/).map((c) => c.dataset.testid)).toEqual([
      'settings-hub-card-security',
    ])
  })

  it('nudges for the first empty field the completion score counts', () => {
    // Avatar and timezone both empty: the nudge names the earlier one, and the
    // percentage counts both — the two read one list, so they cannot drift.
    const both = hub(profile({ timezone: null }))
    expect(screen.getByText('Next: add an avatar.')).toBeTruthy()
    expect(screen.getByText('60%')).toBeTruthy()
    both.unmount()

    hub(profile({ timezone: null, avatarPreset: 'fox' }))
    expect(screen.getByText('Next: add a timezone.')).toBeTruthy()
    expect(screen.getByText('80%')).toBeTruthy()
  })

  it('keeps the sidebar on a tab, with a way back to the hub', () => {
    const onShowHub = vi.fn()
    render(
      <SettingsChrome activeTab="profile" onTabChange={vi.fn()} onShowHub={onShowHub} profile={profile()}>
        <p>profile section</p>
      </SettingsChrome>,
    )
    expect(screen.queryByTestId('settings-hub')).toBeNull()
    expect(screen.getByText('profile section')).toBeTruthy()
    fireEvent.click(screen.getByTestId('settings-show-hub'))
    expect(onShowHub).toHaveBeenCalled()
  })
})
