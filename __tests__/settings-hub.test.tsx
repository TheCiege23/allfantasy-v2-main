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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  // SettingsChrome reads ?returnTo= (2026-10-02).
  useSearchParams: () => new URLSearchParams(),
}))
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

  it('says notifications are off only when the saved preferences say so', () => {
    const off = hub(profile({ notificationPreferences: { globalEnabled: false } }))
    const offCard = screen.getByTestId('settings-hub-card-notifications')
    expect(offCard.dataset.tone).toBe('warn')
    expect(within(offCard).getByTestId('settings-hub-state-notifications').textContent).toBe('Off: nothing reaches you')
    off.unmount()

    hub(profile({ notificationPreferences: { globalEnabled: true } }))
    const card = screen.getByTestId('settings-hub-card-notifications')
    expect(card.dataset.tone).toBeUndefined()
    expect(within(card).getByTestId('settings-hub-state-notifications').textContent).toBe('On')
  })

  it('names the linked accounts from the profile, and says so when there are none', () => {
    const none = hub()
    expect(screen.getByTestId('settings-hub-state-connected').textContent).toBe('Nothing linked yet')
    none.unmount()

    hub(profile({ sleeperUserId: 's1', discordUserId: 'd1' }))
    expect(screen.getByTestId('settings-hub-state-connected').textContent).toBe('Sleeper, Discord')
  })

  it('names the plan and its renewal once, on its own card, and never prints a price it does not hold', () => {
    ents.value = SUPREME
    hub()
    const state = screen.getByTestId('settings-hub-state-billing')
    expect(state.textContent).toBe(`AF Supreme · renews ${new Date('2027-01-15T00:00:00Z').toLocaleDateString()}`)
    const page = screen.getByTestId('settings-hub').textContent ?? ''
    expect(page.split('AF Supreme').length - 1).toBe(1)
    expect(page).not.toMatch(/\$\s?\d/)
    expect(page).not.toMatch(/tokens\/mo/i)
  })

  it('says an admin bypass is not billed — it has no Stripe subscription behind it', () => {
    ents.value = { ...SUPREME, isAdminBypassAccount: true }
    hub()
    expect(screen.getByTestId('settings-hub-state-billing').textContent).toBe('AF Supreme · admin access, not billed')
  })

  it('searches card descriptions as well as titles', () => {
    hub()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'password' } })
    expect(screen.getAllByTestId(/^settings-hub-card-/).map((c) => c.dataset.testid)).toEqual([
      'settings-hub-card-security',
    ])
  })

  it('asks for the first empty profile field, on the headline and the Profile card alike', () => {
    // Avatar and timezone both empty: both lines name the earlier one — they read one list.
    const both = hub(profile({ timezone: null }))
    expect(screen.getByTestId('settings-guide-headline').textContent).toBe('Add a picture to finish your profile')
    expect(screen.getByTestId('settings-hub-state-profile').textContent).toBe('Add a picture')
    both.unmount()

    hub(profile({ timezone: null, avatarPreset: 'fox' }))
    expect(screen.getByTestId('settings-guide-headline').textContent).toBe('Set your timezone to finish your profile')
    expect(screen.getByTestId('settings-hub-state-profile').textContent).toBe('Set your timezone')
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

describe('settings hub groups (2026-10-02 layout pass)', () => {
  beforeEach(() => {
    ents.value = FREE
  })

  it('puts every tab in exactly one group, under four headings', () => {
    hub()
    const groups = screen.getAllByRole('region').filter((r) => r.className.includes('ns-hub-group'))
    expect(groups).toHaveLength(4)
    const seen = groups.flatMap((g) =>
      within(g).getAllByTestId(/^settings-hub-card-/).map((c) => c.dataset.testid),
    )
    expect(seen.sort()).toEqual(SETTINGS_NAV.map((n) => `settings-hub-card-${n.id}`).sort())
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('drops a group with no match while searching', () => {
    hub()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'password' } })
    const groups = screen.getAllByRole('region').filter((r) => r.className.includes('ns-hub-group'))
    expect(groups).toHaveLength(1)
  })

  it('the sidebar search on a tab also matches descriptions', () => {
    render(
      <SettingsChrome activeTab="profile" onTabChange={vi.fn()} onShowHub={vi.fn()} profile={profile()}>
        <p>profile section</p>
      </SettingsChrome>,
    )
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'password' } })
    const nav = screen.getByRole('navigation', { name: /./ })
    const items = within(nav).getAllByRole('button').map((b) => b.textContent)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatch(/security/i)
  })

  // 2026-10-03: the empty-result line once referenced a `tInterpolate` that was not in scope —
  // a ReferenceError the moment a search matched nothing, which no test reached.
  it('the sidebar search says when nothing matches, instead of crashing', () => {
    render(
      <SettingsChrome activeTab="profile" onTabChange={vi.fn()} onShowHub={vi.fn()} profile={profile()}>
        <p>profile section</p>
      </SettingsChrome>,
    )
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzqqxx' } })
    const nav = screen.getByRole('navigation', { name: /./ })
    expect(within(nav).queryAllByRole('button')).toHaveLength(0)
    expect(nav.textContent).toMatch(/No settings match “zzqqxx”/)
  })
})
