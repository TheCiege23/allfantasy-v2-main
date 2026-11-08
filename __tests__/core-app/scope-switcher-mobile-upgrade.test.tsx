import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/**
 * The phone league picker, brought level with the desktop rail (user report, 2026-11-08):
 *   1. the list is grouped by sport, with the sport on every row
 *   2. every row says how you stand (W-L, or your place in a field race — scope-switcher-record.test.tsx)
 *   3. every row carries its platform's colour
 *   4. sport and platform chips FILTER THE LIST in place — they no longer navigate to a filtered Home
 *   5. Customize: reorder, hide / unhide, and show hidden leagues
 */

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: () => {}, prefetch: () => {}, refresh: nav.refresh }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: _p, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: unknown }) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}))

import { ScopeSwitcher, type ScopeSwitcherLeague } from '@/components/core-app/ScopeSwitcher'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

const LEAGUES: ScopeSwitcherLeague[] = [
  { id: 'n1', name: 'Dynasty Dragons', sport: 'NFL', platform: 'sleeper' },
  { id: 'b1', name: 'Hoops Club', sport: 'NBA', platform: 'sleeper' },
  { id: 'n2', name: 'Work League', sport: 'NFL', platform: 'espn' },
  { id: 'n3', name: 'AF Guillotine', sport: 'NFL', platform: 'allfantasy' },
  { id: 'b2', name: 'Fantrax Hoops', sport: 'NBA', platform: 'fantrax' },
]

function open(props: Partial<React.ComponentProps<typeof ScopeSwitcher>> = {}) {
  render(
    <ScopeSwitcher leagues={LEAGUES} scopeValue={null} label="All leagues" selectedLeagueId={null} favoriteIds={[]} leagueScreen={false} {...props} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Viewing/ }))
}

const names = () => Array.from(document.querySelectorAll('.af-scope-league-name')).map((n) => n.textContent)
const headings = () => Array.from(document.querySelectorAll('[data-testid="scope-sport-heading"]')).map((h) => h.getAttribute('data-section'))
const chip = (name: RegExp) => within(document.querySelector('.af-scope-filters') as HTMLElement).getByRole('button', { name })

describe('sport on every row, and the list grouped by sport', () => {
  it('draws a heading per sport in product order, each row under its own', () => {
    open()
    expect(headings()).toEqual(['NFL', 'NBA'])
    expect(names()).toEqual(['Dynasty Dragons', 'Work League', 'AF Guillotine', 'Hoops Club', 'Fantrax Hoops'])
    const sports = Array.from(document.querySelectorAll('[data-testid="scope-league-sport"]')).map((s) => s.textContent)
    expect(sports).toEqual(['🏈NFL', '🏈NFL', '🏈NFL', '🏀NBA', '🏀NBA'])
  })

  it('puts starred leagues in their own section on top', () => {
    open({ favoriteIds: ['b2'] })
    expect(headings()).toEqual(['favorites', 'NFL', 'NBA'])
    expect(names()[0]).toBe('Fantrax Hoops')
  })

  it('files a league with no sport under "Other", last, with no empty sport tag on the row', () => {
    open({ leagues: [...LEAGUES, { id: 'x', name: 'Mystery League', sport: '', platform: 'sleeper' }] })
    expect(headings()).toEqual(['NFL', 'NBA', 'other'])
    expect(document.querySelector('[data-section="other"]')?.textContent).toContain('Other')
    const row = Array.from(document.querySelectorAll('.af-scope-row')).find((r) => r.textContent?.includes('Mystery League'))!
    expect(row.querySelector('[data-testid="scope-league-sport"]')).toBeNull()
  })

  it('CONTROL: one sport draws no heading', () => {
    open({ leagues: LEAGUES.filter((l) => l.sport === 'NFL') })
    expect(headings()).toEqual([])
  })
})

describe('the favorites note', () => {
  it('says favorites follow the account, which is where a star is saved', () => {
    open()
    expect(document.querySelector('.af-scope-note')?.textContent).toBe('Favorites are saved to your account, across devices.')
  })
})

describe('the platform in its own colour', () => {
  it('tags each row and its chip with the platform the shared colours read', () => {
    open()
    const tones = Array.from(document.querySelectorAll('.af-scope-row')).map((r) => r.getAttribute('data-platform'))
    expect(tones).toEqual(['sleeper', 'espn', 'native', 'sleeper', 'fantrax'])
    const chips = Array.from(document.querySelectorAll('[data-testid="scope-league-platform"]'))
    expect(chips.map((c) => c.textContent)).toEqual(['Sleeper', 'ESPN', 'AllFantasy', 'Sleeper', 'Fantrax'])
    expect(chips.every((c) => c.classList.contains('af-platform'))).toBe(true)
  })
})

describe('chips filter the list in place', () => {
  it('a sport chip narrows the list and does not navigate', () => {
    open()
    fireEvent.click(chip(/NBA/))
    expect(names()).toEqual(['Hoops Club', 'Fantrax Hoops'])
    expect(nav.push).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(chip(/NBA/).getAttribute('aria-pressed')).toBe('true')
  })

  it('a sport and a platform combine, and the counts follow the other chip', () => {
    open()
    fireEvent.click(chip(/NFL/))
    // Under NFL: Sleeper 1, ESPN 1, AllFantasy 1, Fantrax 0 (disabled).
    expect(chip(/Fantrax/)).toBeDisabled()
    fireEvent.click(chip(/Sleeper/))
    expect(names()).toEqual(['Dynasty Dragons'])
  })

  it('tapping a pressed chip lets it go; All leagues clears everything', () => {
    open()
    fireEvent.click(chip(/NBA/))
    fireEvent.click(chip(/NBA/))
    expect(names()).toHaveLength(5)
    fireEvent.click(chip(/ESPN/))
    expect(names()).toEqual(['Work League'])
    fireEvent.click(chip(/All leagues/))
    expect(names()).toHaveLength(5)
  })

  it('opens on the filter Home is showing, and offers to put a new one on Home', () => {
    open({ scopeValue: 'sport:NBA', label: 'NBA leagues' })
    expect(names()).toEqual(['Hoops Club', 'Fantrax Hoops'])
    expect(screen.queryByTestId('scope-apply-home')).toBeNull()
    fireEvent.click(chip(/NBA/))
    fireEvent.click(chip(/NFL/))
    const apply = screen.getByTestId('scope-apply-home')
    expect(apply.getAttribute('href')).toBe('/core?view=all&scope=sport%3ANFL')
    fireEvent.click(apply)
    expect(nav.push).toHaveBeenCalledExactlyOnceWith('/core?view=all&scope=sport%3ANFL')
  })

  it('CONTROL: two facets at once cannot be a Home filter, so none is offered', () => {
    open()
    fireEvent.click(chip(/NFL/))
    fireEvent.click(chip(/Sleeper/))
    expect(screen.queryByTestId('scope-apply-home')).toBeNull()
  })
})

describe('Customize: show hidden, reorder, hide', () => {
  it('shows hidden leagues on request, marked as hidden', () => {
    open({ hiddenIds: ['n2'] })
    expect(names()).not.toContain('Work League')
    fireEvent.click(screen.getByTestId('scope-show-hidden'))
    expect(names()).toContain('Work League')
    const row = Array.from(document.querySelectorAll('.af-scope-row')).find((r) => r.textContent?.includes('Work League'))!
    expect(row.getAttribute('data-hidden')).toBe('true')
    expect(row.textContent).toContain('Hidden')
  })

  it('CONTROL: no hidden leagues, no "Show hidden" button', () => {
    open()
    expect(screen.queryByTestId('scope-show-hidden')).toBeNull()
  })

  it('moves a league within its sport and saves the account order', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    open()
    fireEvent.click(screen.getByTestId('scope-customize'))
    expect(screen.getByRole('button', { name: 'Move Dynasty Dragons up' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Move Work League up' }))
    expect(names().slice(0, 3)).toEqual(['Work League', 'Dynasty Dragons', 'AF Guillotine'])
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/core/league-preferences')
    expect(JSON.parse(String(init.body))).toEqual({ field: 'order', leagueIds: ['n2', 'b1', 'n1', 'n3', 'b2'] })
  })

  it('hides a league, reading the saved hidden list back first', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? new Response('{}') : new Response(JSON.stringify({ hidden: ['old'] })),
    )
    vi.stubGlobal('fetch', fetchMock)
    open()
    fireEvent.click(screen.getByTestId('scope-customize'))
    fireEvent.click(screen.getByRole('button', { name: 'Hide Hoops Club' }))
    expect(screen.getByRole('button', { name: 'Show Hoops Club again' }).getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(true))
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!
    expect(JSON.parse(String(post[1]!.body))).toEqual({ field: 'hidden', leagueIds: ['old', 'b1'] })
  })

  it('unhides a league, removing only that one', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? new Response('{}') : new Response(JSON.stringify({ hidden: ['n2', 'other'] })),
    )
    vi.stubGlobal('fetch', fetchMock)
    open({ hiddenIds: ['n2'] })
    fireEvent.click(screen.getByTestId('scope-customize'))
    fireEvent.click(screen.getByRole('button', { name: 'Show Work League again' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(true))
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!
    expect(JSON.parse(String(post[1]!.body))).toEqual({ field: 'hidden', leagueIds: ['other'] })
  })
})

describe('drag to reorder, by the grip', () => {
  /** Lay the rows out 50px apart, top to bottom, the way they render. jsdom has no layout of its own. */
  const layOut = () =>
    Array.from(document.querySelectorAll<HTMLElement>('.af-scope-list > li')).forEach((el, i) => {
      el.getBoundingClientRect = () => ({ top: i * 50, height: 40, bottom: i * 50 + 40, left: 0, right: 300, width: 300, x: 0, y: i * 50, toJSON: () => ({}) })
    })
  const grip = (name: string) =>
    Array.from(document.querySelectorAll('.af-scope-row')).find((r) => r.textContent?.includes(name))!.querySelector<HTMLElement>('[data-testid="scope-drag-handle"]')!
  const rowOf = (name: string) => Array.from(document.querySelectorAll<HTMLElement>('.af-scope-row')).find((r) => r.textContent?.includes(name))!

  it('draws a grip only while customizing', () => {
    open()
    expect(document.querySelector('[data-testid="scope-drag-handle"]')).toBeNull()
    fireEvent.click(screen.getByTestId('scope-customize'))
    expect(document.querySelectorAll('[data-testid="scope-drag-handle"]')).toHaveLength(5)
  })

  it('a finger on the grip drags a league within its sport, and the order is saved', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    open()
    fireEvent.click(screen.getByTestId('scope-customize'))
    layOut()
    // List: [NFL heading 0] Dynasty Dragons 50, Work League 100, AF Guillotine 150, [NBA heading 200] …
    fireEvent.pointerDown(grip('Dynasty Dragons'), { button: 0, pointerType: 'touch', clientX: 10, clientY: 70 })
    fireEvent.pointerMove(window, { pointerType: 'touch', clientX: 10, clientY: 190 })
    expect(rowOf('AF Guillotine').getAttribute('data-drop')).toBe('after')
    expect(rowOf('Dynasty Dragons').getAttribute('data-dragging')).toBe('true')
    await act(async () => {
      fireEvent.pointerUp(window, { pointerType: 'touch', clientX: 10, clientY: 190 })
    })
    expect(names().slice(0, 3)).toEqual(['Work League', 'AF Guillotine', 'Dynasty Dragons'])
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ field: 'order', leagueIds: ['n2', 'b1', 'n3', 'n1', 'b2'] })
    expect(rowOf('Dynasty Dragons').getAttribute('data-dragging')).toBeNull()
  })

  it('CONTROL: a finger on the row itself scrolls — it does not drag', () => {
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    open()
    fireEvent.click(screen.getByTestId('scope-customize'))
    layOut()
    const link = rowOf('Dynasty Dragons').querySelector<HTMLElement>('.af-scope-league')!
    fireEvent.pointerDown(link, { button: 0, pointerType: 'touch', clientX: 10, clientY: 70 })
    fireEvent.pointerMove(window, { pointerType: 'touch', clientX: 10, clientY: 190 })
    fireEvent.pointerUp(window, { pointerType: 'touch', clientX: 10, clientY: 190 })
    expect(names().slice(0, 3)).toEqual(['Dynasty Dragons', 'Work League', 'AF Guillotine'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a small wobble on the grip is not a move', () => {
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    open()
    fireEvent.click(screen.getByTestId('scope-customize'))
    layOut()
    fireEvent.pointerDown(grip('Dynasty Dragons'), { button: 0, pointerType: 'touch', clientX: 10, clientY: 70 })
    fireEvent.pointerMove(window, { pointerType: 'touch', clientX: 11, clientY: 72 })
    fireEvent.pointerUp(window, { pointerType: 'touch', clientX: 11, clientY: 72 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a sport with one league draws its grip dimmed, and it does not drag', () => {
    open({ leagues: LEAGUES.filter((l) => l.id !== 'b2') })
    fireEvent.click(screen.getByTestId('scope-customize'))
    expect(grip('Hoops Club').getAttribute('data-disabled')).toBe('true')
    expect(grip('Dynasty Dragons').getAttribute('data-disabled')).toBeNull()
  })
})
