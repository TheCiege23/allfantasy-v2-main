import React from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The League settings screen inside /core (2026-11-15). /core hands the hub only what its rail holds —
 * id, name, platform, sport — so the hub has to take the league's format from its own settings read,
 * and the screen decides who gets an editor at all: an AllFantasy league's commissioner, nobody else.
 */

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }), usePathname: () => '/core/league-settings' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { LeagueSettingsScreen } from '@/components/core-app/screens/LeagueSettingsScreen'

/** Answers the hub's settings read with `league`; every other read 404s, which each section treats as empty. */
function serve(league: Record<string, unknown>, canEdit = false) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/league/settings')) {
      return new Response(JSON.stringify({ canEdit, league: { teams: [], ...league }, settings: {} }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }))
}

beforeEach(() => push.mockReset())
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the league’s format comes from the settings read when /core cannot pass it', () => {
  it('a guillotine league opened from /core reads as Guillotine, not Redraft', async () => {
    serve({ guillotineMode: true, sport: 'NFL' })
    const { getByTestId } = render(<LeagueSettingsScreen league={{ id: 'g1', name: 'Chopped', platform: 'sleeper', sport: 'NFL' }} userId="u1" />)
    await waitFor(() => expect(getByTestId('league-settings-hub-type').textContent).toBe('Guillotine'))
  })

  it('a best-ball league reads as Best Ball', async () => {
    serve({ bestBallMode: true, sport: 'NFL' })
    const { getByTestId } = render(<LeagueSettingsScreen league={{ id: 'b1', name: 'BB', platform: 'sleeper', sport: 'NFL' }} userId="u1" />)
    await waitFor(() => expect(getByTestId('league-settings-hub-type').textContent).toBe('Best Ball'))
  })
})

describe('who gets an editor', () => {
  it('an imported league is a read-only mirror: no Advanced settings, even for its commissioner', async () => {
    serve({ sport: 'NFL' }, true)
    const { getByTestId, queryByText, container } = render(
      <LeagueSettingsScreen league={{ id: 's1', name: 'AFC Dreaming!', platform: 'sleeper', sport: 'NFL', isCommissioner: true }} userId="u1" />,
    )
    await waitFor(() => expect(getByTestId('league-settings-hub')).toBeTruthy())
    expect(container.querySelector('[data-native="false"]')).not.toBeNull()
    await waitFor(() => expect(queryByText('Read-only mirror')).not.toBeNull())
    expect(queryByText('Advanced settings')).toBeNull()
  })

  it('an AllFantasy league’s commissioner gets Advanced settings, which opens the league’s full editor', async () => {
    serve({ sport: 'NFL' }, true)
    const { findByText } = render(
      <LeagueSettingsScreen league={{ id: 'n1', name: 'Kingdom North', platform: 'allfantasy', sport: 'NFL', isCommissioner: true }} userId="u1" />,
    )
    const advanced = await findByText('Advanced settings')
    advanced.click()
    expect(push).toHaveBeenCalledWith('/league/n1?tab=settings')
  })

  it('an AllFantasy league’s member gets no Advanced settings', async () => {
    serve({ sport: 'NFL' }, false)
    const { getByTestId, queryByText } = render(
      <LeagueSettingsScreen league={{ id: 'n2', name: 'Kingdom North', platform: 'allfantasy', sport: 'NFL', isCommissioner: false }} userId="u1" />,
    )
    await waitFor(() => expect(getByTestId('league-settings-hub')).toBeTruthy())
    expect(queryByText('Advanced settings')).toBeNull()
  })
})
