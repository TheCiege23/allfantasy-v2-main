/**
 * The /league workspace rail, arranged like /core's (2026-10-30): favorites pinned on top, sport
 * headings that fold, filter chips, Pin and Move from a right-click, and your record per league.
 * The same helpers and the same sheet as /core (railArrange.ts, RailLeagueMenu.tsx).
 */
import React from 'react'
import { act, createEvent, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import type { LeagueRailData } from '@/components/league/native/LeagueRail'
import { resetRailOddsCache } from '@/components/core-app/useRailOdds'

const TABS = [{ id: 'native_home', label: 'League home' }]
const lg = (id: string, name: string, sport: string, extra: Record<string, unknown> = {}) =>
  ({ id, name, platform: 'allfantasy', sport, season: 2026, teamCount: 12, format: 'Redraft', scoring: 'PPR', currentWeek: 5, lifecycleState: 'in_season', leagueVariant: 'redraft', ...extra }) as never
const LEAGUES = [
  lg('f1', 'Gridiron One', 'NFL', { isCommissioner: true }),
  lg('f2', 'Gridiron Two', 'NFL'),
  lg('f3', 'Gridiron Three', 'NFL'),
  lg('b1', 'Hoops One', 'NBA'),
  lg('b2', 'Hoops Two', 'NBA'),
  lg('b3', 'Hoops Three', 'NBA'),
]

const fetchMock = vi.fn(async (_u: string, _init?: RequestInit) => ({ ok: true, json: async () => ({}) }))

beforeEach(() => {
  resetRailOddsCache()
  fetchMock.mockClear()
  window.localStorage.clear()
  // Wide: the rail is expanded.
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('fetch', fetchMock)
  HTMLDialogElement.prototype.showModal ??= function () {}
  HTMLDialogElement.prototype.close ??= function () {}
})
afterEach(() => vi.unstubAllGlobals())

function draw(rail: Partial<LeagueRailData> = {}) {
  const { container } = render(
    <NativeLeagueWorkspace native league={LEAGUES[0]} leagues={LEAGUES} tabs={TABS} activeTab="native_home"
      isCommissioner={false} onSelectTab={() => {}} onOpenSettings={() => {}} leftPanel={null} rightPanel={null}
      rail={{ matchups: {}, imageUrls: {}, ...rail }}>
      <div>tab</div>
    </NativeLeagueWorkspace>,
  )
  return container
}
const list = (c: HTMLElement) => c.querySelector('#nl-rail-leagues')!
const order = (c: HTMLElement) =>
  Array.from(list(c).children)
    .filter((el) => el.matches('.af-rail-sport, a.nl-rail-tile'))
    .map((el) => (el.classList.contains('af-rail-sport') ? `# ${el.getAttribute('data-section')}` : decodeURIComponent(el.getAttribute('href')!).replace(/^\/league\/([^/?]+).*$/, '$1')))
const tile = (c: HTMLElement, id: string) => list(c).querySelector<HTMLAnchorElement>(`a.nl-rail-tile[href^="/league/${id}"]`)!
const posts = () =>
  fetchMock.mock.calls
    .filter(([u, init]) => String(u).includes('league-preferences') && init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init!.body)))

describe('the /league rail', () => {
  it('pins favorites on top and keeps the saved order, by sport', () => {
    const c = draw({ favoriteIds: ['b2'], order: ['f3', 'f1', 'f2'] })
    expect(order(c)).toEqual(['# favorites', 'b2', '# NFL', 'f3', 'f1', 'f2', '# NBA', 'b1', 'b3'])
  })

  it('a sport heading folds its leagues and remembers it on this device', () => {
    const c = draw()
    fireEvent.click(list(c).querySelector('.af-rail-sport[data-section="NBA"]')!)
    expect(order(c)).toEqual(['# NFL', 'f1', 'f2', 'f3', '# NBA'])
    expect(JSON.parse(window.localStorage.getItem('af-rail-folded-sports')!)).toEqual(['NBA'])
  })

  it('filter chips from six leagues; Commissioner narrows the list', () => {
    const c = draw()
    expect(Array.from(list(c).querySelectorAll('.af-rail-filter')).map((b) => b.getAttribute('data-filter'))).toEqual(['all', 'commissioner'])
    fireEvent.click(list(c).querySelector('.af-rail-filter[data-filter="commissioner"]')!)
    expect(order(c)).toEqual(['# NFL', 'f1'])
  })

  it('right-click opens Pin and Move; Pin saves the favorites and lifts the league to the top', async () => {
    const c = draw()
    fireEvent.contextMenu(tile(c, 'b3'))
    const sheet = c.querySelector<HTMLElement>('.af-rail-menu')!
    await act(async () => {
      fireEvent.click(within(sheet).getByText('Pin to top'))
    })
    expect(order(c).slice(0, 2)).toEqual(['# favorites', 'b3'])
    expect(posts()).toEqual([{ field: 'favorites', leagueIds: ['b3'] }])
  })

  it('Move down saves the whole order and moves it within its sport', async () => {
    const c = draw()
    fireEvent.contextMenu(tile(c, 'f1'))
    await act(async () => {
      fireEvent.click(within(c.querySelector<HTMLElement>('.af-rail-menu')!).getByText('Move down'))
    })
    expect(order(c)).toEqual(['# NFL', 'f2', 'f1', 'f3', '# NBA', 'b1', 'b2', 'b3'])
    expect(posts()).toEqual([{ field: 'order', leagueIds: ['f2', 'f1', 'f3', 'b1', 'b2', 'b3'] }])
  })

  it('flags what needs you and offers the Needs action chip, from the /core badge facts', () => {
    const c = draw({ lineupLeagueIds: ['f2'], offerLeagueIds: ['b1'] })
    expect([...tile(c, 'f2').querySelectorAll('.af-rail-row-flag')].map((f) => f.textContent)).toEqual(['Fix lineup'])
    expect([...tile(c, 'b1').querySelectorAll('.af-rail-row-flag')].map((f) => f.textContent)).toEqual(['Trade offer'])
    expect(Array.from(list(c).querySelectorAll('.af-rail-filter')).map((b) => b.getAttribute('data-filter'))).toEqual(['all', 'commissioner', 'needs'])
    fireEvent.click(list(c).querySelector('.af-rail-filter[data-filter="needs"]')!)
    expect(order(c)).toEqual(['# NFL', 'f2', '# NBA', 'b1'])
  })

  it('Hide takes the league off the list, saves it hidden, and points to Settings', async () => {
    const c = draw()
    fireEvent.contextMenu(tile(c, 'b3'))
    await act(async () => {
      fireEvent.click(within(c.querySelector<HTMLElement>('.af-rail-menu')!).getByText('Hide from this list'))
    })
    expect(order(c)).toEqual(['# NFL', 'f1', 'f2', 'f3', '# NBA', 'b1', 'b2'])
    expect(posts()).toEqual([{ field: 'hidden', leagueIds: ['b3'] }])
    const link = list(c).querySelector<HTMLAnchorElement>('a.nl-rail-hidden')!
    expect(link.textContent).toBe('1 hidden · Settings')
    expect(link.getAttribute('href')).toBe('/settings?tab=preferences&returnTo=%2Fleague%2Ff1#your-leagues')
  })

  it('leaves out leagues the account hid, but never the league you are in', () => {
    const c = draw({ hiddenIds: ['b1', 'f1'] })
    expect(order(c)).toEqual(['# NFL', 'f1', 'f2', 'f3', '# NBA', 'b2', 'b3'])
    expect(list(c).querySelector('a.nl-rail-hidden')?.textContent).toBe('1 hidden · Settings')
  })

  /** Lay the rows out 50px apart, in DOM order, so the drag can read where it is. */
  const layOut = (c: HTMLElement) =>
    Array.from(list(c).querySelectorAll<HTMLElement>('[data-rail-id]')).forEach((el, i) => {
      el.getBoundingClientRect = () => ({ top: i * 50, height: 40, bottom: i * 50 + 40, left: 0, right: 200, width: 200, x: 0, y: i * 50, toJSON: () => ({}) })
    })
  const dragFrom = (el: HTMLElement, fromY: number, toY: number, pointerType = 'mouse') => {
    fireEvent.pointerDown(el, { button: 0, pointerType, clientX: 10, clientY: fromY })
    fireEvent.pointerMove(window, { pointerType, clientX: 10, clientY: (fromY + toY) / 2 })
    fireEvent.pointerMove(window, { pointerType, clientX: 10, clientY: toY })
  }

  it('a mouse drags a league within its sport, marks where it lands, saves the order and does not open it', async () => {
    const c = draw()
    layOut(c)
    dragFrom(tile(c, 'f3'), 120, 10)
    expect(tile(c, 'f3').getAttribute('data-dragging')).toBe('true')
    expect(tile(c, 'f1').getAttribute('data-drop')).toBe('before')
    await act(async () => {
      fireEvent.pointerUp(window, { pointerType: 'mouse', clientX: 10, clientY: 10 })
    })
    expect(order(c)).toEqual(['# NFL', 'f3', 'f1', 'f2', '# NBA', 'b1', 'b2', 'b3'])
    expect(posts()).toEqual([{ field: 'order', leagueIds: ['f3', 'f1', 'f2', 'b1', 'b2', 'b3'] }])
    const click = createEvent.click(tile(c, 'f3'))
    fireEvent(tile(c, 'f3'), click)
    expect(click.defaultPrevented).toBe(true)
    expect(tile(c, 'f3').getAttribute('data-dragging')).toBeNull()
  })

  it('a finger scrolls the list until Reorder is chosen, then drags by the handle', async () => {
    const c = draw()
    layOut(c)
    dragFrom(tile(c, 'b1'), 220, 330, 'touch')
    fireEvent.pointerUp(window, { pointerType: 'touch', clientX: 10, clientY: 330 })
    expect(posts()).toEqual([])

    fireEvent.contextMenu(tile(c, 'b1'))
    fireEvent.click(within(c.querySelector<HTMLElement>('.af-rail-menu')!).getByText('Reorder leagues'))
    expect(list(c).getAttribute('data-reorder')).toBe('true')
    expect(list(c).querySelector('.af-rail-reorder-bar')?.textContent).toContain('Drag ⠿ to put your leagues in order.')
    expect(tile(c, 'b1').querySelector('.af-rail-drag-handle')).not.toBeNull()
    layOut(c)
    dragFrom(tile(c, 'b1'), 220, 330, 'touch')
    await act(async () => {
      fireEvent.pointerUp(window, { pointerType: 'touch', clientX: 10, clientY: 330 })
    })
    expect(order(c)).toEqual(['# NFL', 'f1', 'f2', 'f3', '# NBA', 'b2', 'b3', 'b1'])
    // While reordering a tap never opens a league; Done ends it.
    const click = createEvent.click(tile(c, 'b2'))
    fireEvent(tile(c, 'b2'), click)
    expect(click.defaultPrevented).toBe(true)
    fireEvent.click(within(list(c)).getByText('Done'))
    expect(list(c).getAttribute('data-reorder')).toBeNull()
  })

  it('draws your record beside the platform', () => {
    const c = draw({ records: { f2: { wins: 6, losses: 3, ties: 0, rank: 2, teams: 12 } } })
    expect(tile(c, 'f2').querySelector('.af-rail-row-record')?.textContent).toBe('6-3 · 2nd')
    expect(tile(c, 'f1').querySelector('.af-rail-row-record')).toBeNull()
  })
})
