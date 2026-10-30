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
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
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
    expect(container.querySelector('.af-rail-toggle')?.textContent).toMatch(/4 leagues/)
    expect(screen.getByTestId('rail-hidden-count-link').textContent).toBe('2 hidden · Show')
  })

  it('the header count is a link of its own, not text inside the collapse button', () => {
    const { container } = render(shell({ hiddenLeagueIds: ['b', 'c'] }))
    const count = screen.getByTestId('rail-hidden-count-link')
    expect(count.tagName).toBe('A')
    expect(count.getAttribute('href')).toBe('/settings?tab=preferences&returnTo=%2Fcore#your-leagues')
    // Tapping it must not be a tap on the toggle — the bug was that it only closed the tray.
    expect(count.closest('button')).toBeNull()
    expect(container.querySelector('.af-rail-toggle')?.textContent).not.toMatch(/hidden/)
    expect(container.querySelector('#af-rail')?.getAttribute('data-has-hidden')).toBe('true')
  })

  it('links the hidden count to Settings, where unhiding lives', () => {
    render(shell({ hiddenLeagueIds: ['b', 'c'] }))
    const link = screen.getByTestId('rail-hidden-leagues-link')
    expect(link.getAttribute('href')).toBe('/settings?tab=preferences&returnTo=%2Fcore#your-leagues')
    expect(link.textContent).toMatch(/Show 2 hidden leagues/)
    expect(link.getAttribute('data-all-hidden')).toBeNull()
  })

  it('every league hidden: the tray is not a dead end', () => {
    const { container } = render(shell({ hiddenLeagueIds: ['a', 'b', 'c', 'd'] }))
    expect(rowNames(container)).toEqual([])
    const link = screen.getByTestId('rail-hidden-leagues-link')
    expect(link.textContent).toMatch(/Show 4 hidden leagues/)
    expect(link.getAttribute('data-all-hidden')).toBe('true')
  })

  it('CONTROL: no hidden ids, every row', () => {
    const { container } = render(shell())
    expect(rowNames(container)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
    expect(screen.queryByTestId('rail-hidden-leagues-link')).toBeNull()
    expect(screen.queryByTestId('rail-hidden-count-link')).toBeNull()
    expect(container.querySelector('#af-rail')?.getAttribute('data-has-hidden')).toBeNull()
  })
})

describe('the Updates menu — lineup handoff', () => {
  const rail = LIST.map((l) => ({ ...l, platform: 'sleeper', mark: 'S' }))
  const shell = (props: Record<string, unknown> = {}) => (
    <AfCoreShell active="home" leagues={rail as never} syncAge={{ label: 'just now', stale: false }} syncEligibleCount={0} {...props}>
      <div>screen</div>
    </AfCoreShell>
  )

  it('is a button to the platform lineup screen when one is known', () => {
    render(shell({ lineupHandoff: { href: 'https://sleeper.com/leagues/1/team', screen: 'Lineup', platformLabel: 'Sleeper' } }))
    const btn = screen.getByTestId('updates-lineup-handoff')
    expect(btn.tagName).toBe('A')
    expect(btn.getAttribute('href')).toBe('https://sleeper.com/leagues/1/team')
    // External: new tab, and no opener handed to the provider's page.
    expect(btn.getAttribute('target')).toBe('_blank')
    expect(btn.getAttribute('rel')).toBe('noopener noreferrer')
    expect(btn.textContent).toMatch(/Fix lineup in Sleeper/)
  })

  it('says "Open league" when only the league page is known (an unverified lineup format)', () => {
    render(shell({ lineupHandoff: { href: 'https://league.example.test/home', screen: 'League', platformLabel: 'Fantrax' } }))
    expect(screen.getByTestId('updates-lineup-handoff').textContent).toMatch(/Open league in Fantrax/)
  })

  it('reads in Spanish from the catalog, platform name kept', () => {
    expect(coreUiCopy('Fix lineup in Sleeper', 'es')).toBe('Arreglar la alineación en Sleeper')
    expect(coreUiCopy('Open league in Fantrax', 'es')).toBe('Abrir la liga en Fantrax')
    expect(coreUiCopy('AllFantasy only reads this league — changes are made in ESPN.', 'es')).toBe('AllFantasy solo lee esta liga: los cambios se hacen en ESPN.')
    expect(coreUiCopy('Make lineup changes on your league’s platform.', 'es')).toBe('Cambia la alineación en la plataforma de tu liga.')
    expect(coreUiCopy('Fix lineup in Sleeper', 'en')).toBe('Fix lineup in Sleeper')
  })

  it('CONTROL: no handoff keeps the sentence and draws no button', () => {
    const { container } = render(shell())
    expect(screen.queryByTestId('updates-lineup-handoff')).toBeNull()
    expect(container.textContent).toMatch(/Make lineup changes on your league/)
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

describe('Settings › Your leagues › Remove', () => {
  let deletes: string[]
  /** Alpha and Charlie are the viewer's own imports; Bravo and Delta reached them through a claimed team. */
  const stub = (deleteResponse: (id: string) => Response) => {
    deletes = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') {
          const id = decodeURIComponent(url.split('/').pop() ?? '')
          deletes.push(id)
          return deleteResponse(id)
        }
        if (init?.method === 'POST') return new Response(JSON.stringify({ ok: true }))
        if (url.startsWith('/api/league/list'))
          return new Response(
            JSON.stringify({
              leagues: LIST.map((l) => ({ ...l, platform: 'sleeper', hasUnifiedRecord: true, viewerOwnsRow: l.id === 'a' || l.id === 'c' })),
            }),
          )
        return new Response(JSON.stringify({ favorites: null, hidden: ['a'], order: [] }))
      }),
    )
  }
  const removed = (n: number) => () =>
    new Response(JSON.stringify({ ok: true, removed: { leagueRows: n, sleeperLeagueRows: 0, tournamentRows: 0 } }))

  it('offers Remove only on leagues the viewer imported', async () => {
    stub(removed(1))
    render(<LeagueListPreferencesCard />)
    await screen.findByTestId('league-list-row-a')
    expect(screen.queryByTestId('league-remove-a')).not.toBeNull()
    expect(screen.queryByTestId('league-remove-c')).not.toBeNull()
    expect(screen.queryByTestId('league-remove-b')).toBeNull()
    expect(screen.queryByTestId('league-remove-d')).toBeNull()
  })

  it('asks first, then deletes and drops the row — including a hidden one', async () => {
    stub(removed(1))
    render(<LeagueListPreferencesCard />)
    fireEvent.click(await screen.findByTestId('league-remove-a'))
    // Nothing is deleted until the confirm.
    expect(deletes).toEqual([])
    expect(screen.getByTestId('league-remove-confirm-a').textContent).toMatch(/other members' copies stay as they are/)
    fireEvent.click(screen.getByTestId('league-remove-go-a'))
    await waitFor(() => expect(screen.queryByTestId('league-list-row-a')).toBeNull())
    expect(deletes).toEqual(['a'])
    expect(screen.queryByTestId('league-list-row-c')).not.toBeNull()
  })

  it('Cancel deletes nothing', async () => {
    stub(removed(1))
    render(<LeagueListPreferencesCard />)
    fireEvent.click(await screen.findByTestId('league-remove-c'))
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByTestId('league-remove-confirm-c')).toBeNull()
    expect(deletes).toEqual([])
    expect(screen.queryByTestId('league-list-row-c')).not.toBeNull()
  })

  it('a 200 that removed nothing is a failure, not a silent success', async () => {
    stub(removed(0))
    render(<LeagueListPreferencesCard />)
    fireEvent.click(await screen.findByTestId('league-remove-c'))
    fireEvent.click(screen.getByTestId('league-remove-go-c'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Another member imported this league/)
    expect(screen.queryByTestId('league-list-row-c')).not.toBeNull()
  })

  it('a failed request keeps the row and says so', async () => {
    stub(() => new Response('{}', { status: 500 }))
    render(<LeagueListPreferencesCard />)
    fireEvent.click(await screen.findByTestId('league-remove-c'))
    fireEvent.click(screen.getByTestId('league-remove-go-c'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn't remove that league/)
    expect(screen.queryByTestId('league-list-row-c')).not.toBeNull()
  })
})

describe('Settings league save ordering', () => {
  it('blocks another edit while saving, then restores and allows retry after failure', async () => {
    let finish!: (value: Response) => void
    const posts: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)))
        if (posts.length === 1) return new Promise<Response>(resolve => { finish = resolve })
        return new Response('{}')
      }
      if (url.startsWith('/api/league/list')) return new Response(JSON.stringify({ leagues: LIST.map(l => ({ ...l, platform: 'sleeper', hasUnifiedRecord: true })) }))
      return new Response(JSON.stringify({ favorites: [], hidden: [], order: [] }))
    }))
    render(<LeagueListPreferencesCard />)
    fireEvent.click(await screen.findByTestId('league-fav-a'))
    fireEvent.click(screen.getByTestId('league-fav-b'))
    fireEvent.click(screen.getByTestId('league-hide-c'))
    expect(posts).toEqual([{ field: 'favorites', leagueIds: ['a'] }])
    expect(screen.getByTestId('league-hide-c').hasAttribute('disabled')).toBe(true)
    finish(new Response('{}', { status: 503 }))
    await screen.findByRole('alert')
    expect(screen.getByTestId('league-fav-a').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('league-hide-c').hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByTestId('league-fav-b'))
    await waitFor(() => expect(posts).toEqual([{ field: 'favorites', leagueIds: ['a'] }, { field: 'favorites', leagueIds: ['b'] }]))
  })
})
