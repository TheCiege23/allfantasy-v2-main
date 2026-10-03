import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * League list preferences for the universal My Team view (2026-10-02, owner's call: "hide from
 * lists, keep in totals"). Favorites follow the account, hidden leagues leave the rail / switcher /
 * My Leagues lists but stay in totals and pickers, and the lists follow a saved order.
 */

const nav = vi.hoisted(() => ({
  router: { push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/core-app/comms/CommsDock', () => ({ default: () => null }))
vi.mock('@/components/core-app/SyncNowButton', () => ({ default: () => null }))
vi.mock('@/components/core-app/GeoRestrictionNotice', () => ({ GeoRestrictionNotice: () => null }))
vi.mock('@/components/core-app/AfCrest', () => ({ AfCrest: () => null }))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))
vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})

import {
  applyLeagueOrder,
  arrangeLeagueList,
  normalizeLeagueIdList,
  readLeaguePreferences,
  withoutHidden,
} from '@/lib/core-app/leaguePreferences'
import { ScopeSwitcher } from '@/components/core-app/ScopeSwitcher'
import AfCoreShell from '@/components/core-app/AfCoreShell'
import LeagueListPreferencesCard from '@/components/settings/LeagueListPreferencesCard'

const L = (id: string, name: string) => ({ id, name })
const LIST = [L('a', 'Alpha'), L('b', 'Bravo'), L('c', 'Charlie'), L('d', 'Delta')]

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('pure rules', () => {
  it('orders saved ids first, keeps the rest in their original order', () => {
    expect(applyLeagueOrder(LIST, ['c', 'a']).map((l) => l.id)).toEqual(['c', 'a', 'b', 'd'])
    expect(applyLeagueOrder(LIST, []).map((l) => l.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('ignores order ids that are not in the list (a foreign id can only narrow, never add)', () => {
    expect(applyLeagueOrder(LIST, ['zzz', 'b']).map((l) => l.id)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('drops hidden leagues but never the open one', () => {
    expect(withoutHidden(LIST, ['b', 'c']).map((l) => l.id)).toEqual(['a', 'd'])
    expect(withoutHidden(LIST, ['b', 'c'], 'c').map((l) => l.id)).toEqual(['a', 'c', 'd'])
    expect(arrangeLeagueList(LIST, { order: ['d'], hidden: ['a'] }).map((l) => l.id)).toEqual(['d', 'b', 'c'])
  })

  it('reads a stored corePreferences object defensively', () => {
    expect(readLeaguePreferences(null)).toEqual({ favorites: null, hidden: [], order: [] })
    expect(
      readLeaguePreferences({ favoriteLeagueIds: ['a', 'a', 7, ''], hiddenLeagueIds: 'x', leagueOrder: ['b'], playerFinderLeagueIds: ['q'] }),
    ).toEqual({ favorites: ['a'], hidden: [], order: ['b'] })
    expect(normalizeLeagueIdList(['x'.repeat(65), ' ok '])).toEqual(['ok'])
  })
})

describe('the league switcher', () => {
  const leagues = [
    { id: 'a', name: 'Alpha', platform: 'sleeper', sport: 'NFL' },
    { id: 'b', name: 'Bravo', platform: 'sleeper', sport: 'NFL' },
    { id: 'c', name: 'Charlie', platform: 'espn', sport: 'NFL' },
  ]
  const open = (props: Partial<React.ComponentProps<typeof ScopeSwitcher>> = {}) => {
    render(
      <ScopeSwitcher
        leagues={leagues}
        scopeValue={null}
        label="All leagues"
        selectedLeagueId={null}
        favoriteIds={[]}
        leagueScreen={false}
        hiddenIds={['b']}
        {...props}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Viewing/ }))
  }
  const names = () => Array.from(document.querySelectorAll('.af-scope-league-name')).map((n) => n.textContent)

  it('leaves a hidden league out of the list', () => {
    open()
    expect(names()).toEqual(['Alpha', 'Charlie'])
  })

  it('keeps a hidden league in the filter counts (Home still counts it)', () => {
    open()
    // "Sleeper" covers Alpha AND the hidden Bravo.
    expect(document.body.textContent).toMatch(/Sleeper\s*2/)
  })

  it('still finds a hidden league by search, and shows it when it is the open league', () => {
    open()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'brav' } })
    expect(names()).toEqual(['Bravo'])
    cleanup()
    open({ selectedLeagueId: 'b' })
    expect(names()).toContain('Bravo')
  })

  it('a star saves the whole favorites list to the account', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    open()
    const star = document.querySelector('[aria-label*="Alpha"][aria-pressed]') as HTMLElement | null
    expect(star).toBeTruthy()
    fireEvent.click(star!)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/core/league-preferences')
    expect(JSON.parse(String(init.body))).toEqual({ field: 'favorites', leagueIds: ['a'] })
  })
})

describe('the /core rail', () => {
  const rail = LIST.map((l) => ({ ...l, platform: 'manual', mark: 'M' }))
  const shell = (props: Record<string, unknown> = {}) => (
    <AfCoreShell active="home" leagues={rail as never} syncAge={{ label: 'just now', stale: false }} syncEligibleCount={0} {...props}>
      <div>screen</div>
    </AfCoreShell>
  )
  const rowNames = (c: HTMLElement) => Array.from(c.querySelectorAll('.af-rail-row-name')).map((n) => n.textContent)

  it('drops hidden rows and says how many are hidden', () => {
    const { container } = render(shell({ hiddenLeagueIds: ['b', 'c'] }))
    expect(rowNames(container)).toEqual(['Alpha', 'Delta'])
    expect(container.textContent).toMatch(/4 leagues · 2 hidden/)
  })

  it('CONTROL: no hidden ids, every row', () => {
    const { container } = render(shell())
    expect(rowNames(container)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
  })
})

describe('Settings › Your leagues', () => {
  let posts: Array<{ field: string; leagueIds: string[] }>
  beforeEach(() => {
    posts = []
    document.cookie = 'af_core_favs=; max-age=0'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posts.push(JSON.parse(String(init.body)))
          return new Response(JSON.stringify({ ok: true }))
        }
        if (url.startsWith('/api/league/list'))
          return new Response(JSON.stringify({ leagues: LIST.map((l) => ({ ...l, platform: 'sleeper', hasUnifiedRecord: true })) }))
        return new Response(JSON.stringify({ favorites: null, hidden: [], order: [] }))
      }),
    )
  })

  it('hides a league and saves the hidden list', async () => {
    render(<LeagueListPreferencesCard />)
    fireEvent.click(await screen.findByTestId('league-hide-b'))
    await waitFor(() => expect(posts).toEqual([{ field: 'hidden', leagueIds: ['b'] }]))
    expect(within(screen.getByTestId('league-list-row-b')).getByText(/Hidden/)).toBeTruthy()
  })

  it('moves a league up and saves the full order', async () => {
    render(<LeagueListPreferencesCard />)
    fireEvent.click(await screen.findByTestId('league-up-c'))
    await waitFor(() => expect(posts).toEqual([{ field: 'order', leagueIds: ['a', 'c', 'b', 'd'] }]))
  })

  it('reverts and says so when a save fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') return new Response('{}', { status: 503 })
        if (url.startsWith('/api/league/list'))
          return new Response(JSON.stringify({ leagues: LIST.map((l) => ({ ...l, platform: 'sleeper', hasUnifiedRecord: true })) }))
        return new Response(JSON.stringify({ favorites: null, hidden: [], order: [] }))
      }),
    )
    render(<LeagueListPreferencesCard />)
    fireEvent.click(await screen.findByTestId('league-fav-a'))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByTestId('league-fav-a').getAttribute('aria-pressed')).toBe('false')
  })
})
