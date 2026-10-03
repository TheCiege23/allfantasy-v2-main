import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Settings › Preferences › AutoCoach shows ONLY what the engine honours.
 *
 * 🛑 THE ABSENCE ASSERTIONS ARE THE POINT. The stored preferences still carry aggressiveness, a
 * confidence threshold and an email toggle that the engine does not read. If a later change puts
 * one of them on screen, this file should go red before a user flips a dead switch.
 */

const mocks = vi.hoisted(() => ({ hasAccess: true, posts: [] as unknown[] }))

vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})
vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: () => ({ loading: false, hasAccess: () => mocks.hasAccess, upgradePath: '/upgrade?plan=pro' }),
}))
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import AutoCoachSettingsCard from '@/components/settings/AutoCoachSettingsCard'

beforeEach(() => {
  mocks.hasAccess = true
  mocks.posts = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        mocks.posts.push(JSON.parse(String(init.body)))
        return { ok: true, json: async () => ({ ok: true }) }
      }
      return {
        ok: true,
        json: async () => ({
          globalEnabled: true,
          preferences: { excludedPlayerIds: [], positionOverrides: {}, aggressiveness: 'balanced', confidenceThreshold: 65 },
          settings: [
            {
              leagueId: 'L1',
              enabled: true,
              blockedByCommissioner: false,
              totalSwapsMade: 3,
              league: { id: 'L1', name: 'Dynasty Den', autoCoachEnabled: true },
            },
          ],
          players: [{ id: 'p1', name: 'Patrick Mahomes', position: 'QB', team: 'KC', leagueNames: ['Dynasty Den'] }],
        }),
      }
    }) as unknown as typeof fetch,
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AutoCoachSettingsCard', () => {
  it('shows the switch, leagues, positions and players — and none of the unread knobs', async () => {
    render(<AutoCoachSettingsCard />)
    await screen.findByTestId('settings-autocoach-global')
    // Once as a league row (a link to its Team tab), once under the player it rosters.
    expect(screen.getByRole('link', { name: 'Dynasty Den' }).getAttribute('href')).toBe('/league/L1?tab=team')
    expect(screen.getByTestId('settings-autocoach-pos-QB')).toBeTruthy()
    expect(screen.getByText('Patrick Mahomes')).toBeTruthy()

    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/aggressive|conservative|confidence|threshold|email/i)
  })

  it('switching a position off saves positionOverrides with disabled: true', async () => {
    render(<AutoCoachSettingsCard />)
    fireEvent.click(await screen.findByTestId('settings-autocoach-pos-QB'))
    await waitFor(() => expect(mocks.posts).toHaveLength(1))
    expect(mocks.posts[0]).toEqual({ preferences: { positionOverrides: { QB: { disabled: true } } } })
  })

  it('"Manage myself" adds the roster id to excludedPlayerIds', async () => {
    render(<AutoCoachSettingsCard />)
    fireEvent.click(await screen.findByRole('switch', { name: /Patrick Mahomes/ }))
    await waitFor(() => expect(mocks.posts).toHaveLength(1))
    expect(mocks.posts[0]).toEqual({ preferences: { excludedPlayerIds: ['p1'] } })
  })

  it('without AF Pro it offers the upgrade and fetches nothing', async () => {
    mocks.hasAccess = false
    render(<AutoCoachSettingsCard />)
    expect(screen.getByTestId('settings-autocoach-upgrade').getAttribute('href')).toBe('/upgrade?plan=pro')
    expect(fetch).not.toHaveBeenCalled()
  })
})
