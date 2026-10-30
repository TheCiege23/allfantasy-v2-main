/**
 * The /league workspace rail, arranged like /core's (2026-10-30): favorites pinned on top, sport
 * headings that fold, filter chips, Pin and Move from a right-click, and your record per league.
 * The same helpers and the same sheet as /core (railArrange.ts, RailLeagueMenu.tsx).
 */
import React from 'react'
import { act, fireEvent, render, within } from '@testing-library/react'
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

  it('draws your record beside the platform', () => {
    const c = draw({ records: { f2: { wins: 6, losses: 3, ties: 0, rank: 2, teams: 12 } } })
    expect(tile(c, 'f2').querySelector('.af-rail-row-record')?.textContent).toBe('6-3 · 2nd')
    expect(tile(c, 'f1').querySelector('.af-rail-row-record')).toBeNull()
  })
})
