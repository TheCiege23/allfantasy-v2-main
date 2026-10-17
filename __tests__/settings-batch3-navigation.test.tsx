import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * Settings batch 3 (2026-10-02): navigation and the dead ends the audit found.
 *  - Command Center items open their league (they were plain text).
 *  - Settings' Home honours a safe `?returnTo=` (it always went to /core).
 *  - /settings/security redirects to the Security tab (an orphaned duplicate page).
 *  - Imported Leagues asks for the summary list, and does not badge a NATIVE league "Active".
 */

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), params: new URLSearchParams(), redirect: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => nav.params,
  redirect: (to: string) => {
    nav.redirect(to)
    throw new Error('NEXT_REDIRECT')
  },
}))
vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => ({
    loading: false,
    error: null,
    hasAnyPaid: false,
    isAdminBypassAccount: false,
    snapshot: { plans: [], status: 'none', currentPeriodEnd: null },
  }),
}))
vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { CommandCenterSettingsSection } from '@/app/settings/components/sections/CommandCenterSettingsSection'
import { SettingsChrome } from '@/app/settings/components/SettingsChrome'
import { ImportedLeaguesPanel } from '@/app/settings/components/sections/ImportedLeaguesPanel'
import SecuritySettingsPage from '@/app/settings/security/page'

beforeEach(() => {
  nav.push.mockClear()
  nav.redirect.mockClear()
  nav.params = new URLSearchParams()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Command Center items open their league', () => {
  it('links an item through the route-supplied navigable id, and leaves an unmapped one as text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            totalLeagues: 2,
            attentionQueue: [
              { id: 'a1', leagueId: 'row-1', severity: 'high', title: 'Set your lineup' },
              { id: 'a2', leagueId: 'row-2', severity: 'low', title: 'Waivers ran' },
            ],
            leagueLinks: { 'row-1': 'league-abc' },
          }),
        ),
      ),
    )
    render(<CommandCenterSettingsSection />)
    fireEvent.click(screen.getByRole('button', { name: /load today/i }))
    const link = await screen.findByTestId('command-center-item-a1')
    expect(link.getAttribute('href')).toBe('/league/league-abc')
    expect(screen.queryByTestId('command-center-item-a2')).toBeNull()
    expect(screen.getByText('Waivers ran')).toBeTruthy()
  })
})

describe("Settings' Home honours returnTo", () => {
  const chrome = () =>
    render(
      <SettingsChrome activeTab="profile" onTabChange={vi.fn()} onShowHub={vi.fn()} profile={null}>
        <p>section</p>
      </SettingsChrome>,
    )

  it('goes back to the league it was opened from, labelled Back', () => {
    nav.params = new URLSearchParams({ returnTo: '/league/abc?tab=team' })
    chrome()
    const btn = screen.getByTestId('settings-home')
    expect(btn.textContent).toMatch(/back/i)
    fireEvent.click(btn)
    expect(nav.push).toHaveBeenCalledWith('/league/abc?tab=team')
  })

  it('refuses an off-site returnTo and goes home (open-redirect control)', () => {
    nav.params = new URLSearchParams({ returnTo: '//evil.example/x' })
    chrome()
    fireEvent.click(screen.getByTestId('settings-home'))
    expect(nav.push).toHaveBeenCalledWith('/core')
  })

  it('with no returnTo it is Home → /core, as before', () => {
    chrome()
    const btn = screen.getByTestId('settings-home')
    expect(btn.textContent).toMatch(/home/i)
    fireEvent.click(btn)
    expect(nav.push).toHaveBeenCalledWith('/core')
  })
})

describe('/settings/security', () => {
  it('redirects to the Security tab', () => {
    expect(() => SecuritySettingsPage()).toThrow('NEXT_REDIRECT')
    expect(nav.redirect).toHaveBeenCalledWith('/settings?tab=security')
  })
})

describe('Imported Leagues', () => {
  it('asks for the summary list, and badges only imported leagues', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          leagues: [
            { id: 'n1', name: 'Home League', platform: 'allfantasy', navigationLeagueId: 'n1' },
            { id: 's1', name: 'Dynasty Den', platform: 'sleeper', platformLeagueId: '123', navigationLeagueId: 's1', syncStatus: 'error' },
          ],
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<ImportedLeaguesPanel />)
    await screen.findByText('Dynasty Den')
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/league/list?summary=1')
    await waitFor(() => expect(screen.getByText('Sync error')).toBeTruthy())
    // The native league gets no sync pill at all — the old default read "Active".
    expect(screen.queryByText('Active')).toBeNull()
  })
})
