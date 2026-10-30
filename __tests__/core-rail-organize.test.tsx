import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetRailOddsCache } from '@/components/core-app/useRailOdds'

/*
 * Organising the /core league list (2026-10-30): favorites pinned on top, filter chips, sport
 * sections that fold, Pin and Move from a press-and-hold or right-click, unread chat on the crest,
 * and your record beside the platform.
 */

const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: () => {}, prefetch: () => {}, refresh: vi.fn() },
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
vi.mock('@/components/core-app/ScopeSwitcher', () => ({ ScopeSwitcher: () => null, default: () => null }))

import AfCoreShell from '@/components/core-app/AfCoreShell'

const LEAGUES = [
  { id: 'f1', name: 'Gridiron One', platform: 'espn', mark: 'G', sport: 'NFL', isCommissioner: true },
  { id: 'f2', name: 'Gridiron Two', platform: 'espn', mark: 'G', sport: 'NFL' },
  { id: 'f3', name: 'Gridiron Three', platform: 'espn', mark: 'G', sport: 'NFL' },
  { id: 'b1', name: 'Hoops One', platform: 'espn', mark: 'H', sport: 'NBA' },
  { id: 'b2', name: 'Hoops Two', platform: 'espn', mark: 'H', sport: 'NBA' },
  { id: 'b3', name: 'Hoops Three', platform: 'espn', mark: 'H', sport: 'NBA' },
]

const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: true, odds: {} }), { status: 200 }))

beforeEach(() => {
  resetRailOddsCache()
  nav.router.push.mockClear()
  nav.router.refresh.mockClear()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  window.localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function open(extra: Record<string, unknown> = {}) {
  const view = render(
    <AfCoreShell
      active="home"
      leagues={LEAGUES as never}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      {...extra}
    >
      <div>screen</div>
    </AfCoreShell>,
  )
  const c = view.container
  if (c.querySelector('.af-shell')?.getAttribute('data-rail-open') !== 'true') fireEvent.click(c.querySelector('.af-rail-toggle')!)
  return c
}
const scroll = (c: HTMLElement) => c.querySelector('#af-rail-scroll')!
/** The list in order: a heading as `# KEY`, a league as its id. */
const order = (c: HTMLElement) =>
  Array.from(scroll(c).children)
    .filter((el) => el.matches('.af-rail-sport, a.af-rail-tile[href*="league="]'))
    .map((el) => (el.classList.contains('af-rail-sport') ? `# ${el.getAttribute('data-section')}` : el.getAttribute('href')!.replace(/^.*league=/, '')))
const tile = (c: HTMLElement, id: string) => c.querySelector<HTMLAnchorElement>(`#af-rail-scroll a.af-rail-tile[href*="league=${id}"]`)!
const posts = () =>
  fetchMock.mock.calls
    .filter(([u, init]) => String(u).includes('league-preferences') && init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init!.body)))

describe('favorites pinned on top', () => {
  it('the account favorites lead the list under ★, out of their sport', () => {
    const c = open({ scope: { value: null, label: 'All leagues', favoriteIds: ['b2'], leagues: [] } })
    expect(order(c)).toEqual(['# favorites', 'b2', '# NFL', 'f1', 'f2', 'f3', '# NBA', 'b1', 'b3'])
  })
})

describe('Pin and Move', () => {
  it('right-click opens the sheet; Pin moves the league to the top at once and saves the favorites', async () => {
    const c = open()
    fireEvent.contextMenu(tile(c, 'f3'))
    const sheet = c.querySelector<HTMLElement>('.af-rail-menu')!
    expect(sheet.getAttribute('aria-label')).toBe('Options for Gridiron Three')
    await act(async () => {
      fireEvent.click(within(sheet).getByText('Pin to top'))
    })
    expect(order(c).slice(0, 2)).toEqual(['# favorites', 'f3'])
    expect(posts()).toEqual([{ field: 'favorites', leagueIds: ['f3'] }])
    expect(nav.router.refresh).toHaveBeenCalled()
  })

  it('Move up / down trades places within the sport and saves the whole order; the ends are disabled', async () => {
    const c = open()
    fireEvent.contextMenu(tile(c, 'b1'))
    const sheet = () => c.querySelector<HTMLElement>('.af-rail-menu')!
    expect(within(sheet()).getByText('Move up').closest('button')!.disabled).toBe(true)
    await act(async () => {
      fireEvent.click(within(sheet()).getByText('Move down'))
    })
    expect(order(c)).toEqual(['# NFL', 'f1', 'f2', 'f3', '# NBA', 'b2', 'b1', 'b3'])
    expect(posts()).toEqual([{ field: 'order', leagueIds: ['f1', 'f2', 'f3', 'b2', 'b1', 'b3'] }])
  })

  it('a press and hold opens the sheet and the lift does not open the league', () => {
    vi.useFakeTimers()
    const c = open()
    const row = tile(c, 'f2')
    fireEvent.touchStart(row, { touches: [{ clientX: 10, clientY: 10 }] })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(c.querySelector('.af-rail-menu')).not.toBeNull()
    const click = fireEvent.click(row)
    expect(click).toBe(false) // default prevented
    expect(nav.router.push).not.toHaveBeenCalled()
  })

  it('a touch that moves (a scroll) never opens the sheet', () => {
    vi.useFakeTimers()
    const c = open()
    const row = tile(c, 'f2')
    fireEvent.touchStart(row, { touches: [{ clientX: 10, clientY: 10 }] })
    fireEvent.touchMove(row, { touches: [{ clientX: 10, clientY: 60 }] })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(c.querySelector('.af-rail-menu')).toBeNull()
  })
})

describe('filter chips', () => {
  it('appear from six leagues, show only filters with something in them, and narrow the list', () => {
    const c = open({ urgencyBadges: { lineupLeagueIds: ['b3'], offerLeagueIds: [] } })
    const chips = Array.from(c.querySelectorAll('.af-rail-filter')).map((b) => b.getAttribute('data-filter'))
    expect(chips).toEqual(['all', 'commissioner', 'needs'])
    fireEvent.click(c.querySelector('.af-rail-filter[data-filter="needs"]')!)
    expect(order(c)).toEqual(['# NBA', 'b3'])
    fireEvent.click(c.querySelector('.af-rail-filter[data-filter="commissioner"]')!)
    expect(order(c)).toEqual(['# NFL', 'f1'])
  })

  it('no chips under six leagues', () => {
    const view = render(
      <AfCoreShell active="home" leagues={LEAGUES.slice(0, 5) as never} syncAge={{ label: 'just now', stale: false }} syncEligibleCount={0}>
        <div>screen</div>
      </AfCoreShell>,
    )
    const c = view.container
    if (c.querySelector('.af-shell')?.getAttribute('data-rail-open') !== 'true') fireEvent.click(c.querySelector('.af-rail-toggle')!)
    expect(c.querySelector('.af-rail-filters')).toBeNull()
  })
})

describe('folding a sport', () => {
  it('tapping its heading hides its leagues, remembers it on this device, and tapping again brings them back', () => {
    const c = open()
    const nba = () => c.querySelector<HTMLButtonElement>('.af-rail-sport[data-section="NBA"]')!
    fireEvent.click(nba())
    expect(order(c)).toEqual(['# NFL', 'f1', 'f2', 'f3', '# NBA'])
    expect(nba().getAttribute('aria-expanded')).toBe('false')
    expect(JSON.parse(window.localStorage.getItem('af-rail-folded-sports')!)).toEqual(['NBA'])
    fireEvent.click(nba())
    expect(order(c)).toContain('b1')
  })
})

describe('unread chat and your record', () => {
  it('draws the unread count on the crest and the record beside the platform', () => {
    const c = open({
      railUnread: { f1: 3, f2: 0, b1: 140 },
      railRecords: { f1: { wins: 6, losses: 3, ties: 0, rank: 2, teams: 12 }, b1: { wins: 4, losses: 4, ties: 1, rank: null, teams: 10 } },
    })
    expect(tile(c, 'f1').querySelector('.af-rail-unread')?.textContent).toBe('3')
    expect(tile(c, 'f2').querySelector('.af-rail-unread')).toBeNull()
    expect(tile(c, 'b1').querySelector('.af-rail-unread')?.textContent).toBe('99+')
    expect(tile(c, 'f1').getAttribute('aria-label')).toContain('3 unread chat messages')
    expect(tile(c, 'f1').querySelector('.af-rail-row-record')?.textContent).toBe('6-3 · 2nd')
    expect(tile(c, 'b1').querySelector('.af-rail-row-record')?.textContent).toBe('4-4-1')
    expect(tile(c, 'f2').querySelector('.af-rail-row-record')).toBeNull()
  })
})
