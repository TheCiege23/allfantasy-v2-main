import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

const nav = vi.hoisted(() => ({ push: vi.fn(), prefetch: vi.fn(), pathname: '/core/my-team' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, prefetch: nav.prefetch }),
  usePathname: () => nav.pathname,
}))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: 'en' }) }))

import {
  classifySwipe,
  leagueSwipeHref,
  neighborLeagues,
  swipeStartBlocked,
  LEAGUE_SWIPE_SCREENS,
} from '@/lib/core-app/leagueSwipe'
import { LeagueSwipe } from '@/components/core-app/LeagueSwipe'

const LEAGUES = [
  { id: 'A', name: 'Alpha League' },
  { id: 'B', name: 'Bravo League' },
  { id: 'C', name: 'Charlie League' },
]

describe('league swipe — the rules', () => {
  it('finds neighbours in the rail order, without wrapping at the ends', () => {
    expect(neighborLeagues(LEAGUES, 'B')).toMatchObject({ prev: { id: 'A' }, next: { id: 'C' }, index: 1, total: 3 })
    expect(neighborLeagues(LEAGUES, 'A')).toMatchObject({ prev: null, next: { id: 'B' } })
    expect(neighborLeagues(LEAGUES, 'C')).toMatchObject({ prev: { id: 'B' }, next: null })
    expect(neighborLeagues(LEAGUES, 'Z')).toBeNull()
    expect(neighborLeagues([LEAGUES[0]!], 'A')).toBeNull()
  })

  it('keeps the screen and carries only the league', () => {
    expect(leagueSwipeHref('/core/my-team', 'L 2')).toBe('/core/my-team?league=L%202')
    expect(leagueSwipeHref('/core', 'X')).toBe('/core?league=X')
    expect(leagueSwipeHref('/somewhere-else', 'X')).toBe('/core?league=X')
  })

  it('counts a fast, mostly horizontal swipe — left is next, right is previous', () => {
    expect(classifySwipe({ dx: -120, dy: 10, ms: 250 })).toBe('next')
    expect(classifySwipe({ dx: 120, dy: -10, ms: 250 })).toBe('prev')
    expect(classifySwipe({ dx: -40, dy: 0, ms: 200 })).toBeNull() // too short
    expect(classifySwipe({ dx: -120, dy: 90, ms: 200 })).toBeNull() // diagonal: a scroll
    expect(classifySwipe({ dx: -120, dy: 0, ms: 1500 })).toBeNull() // slow drag
  })

  it('leaves edge gestures, form controls, opt-outs and sideways scrollers alone', () => {
    const plain = { tagName: 'DIV', getAttribute: () => null, parentElement: null }
    expect(swipeStartBlocked(plain, 200, 390)).toBe(false)
    expect(swipeStartBlocked(plain, 10, 390)).toBe(true) // iOS back edge
    expect(swipeStartBlocked(plain, 380, 390)).toBe(true)
    expect(swipeStartBlocked({ tagName: 'INPUT', parentElement: null }, 200, 390)).toBe(true)
    expect(swipeStartBlocked({ tagName: 'SPAN', parentElement: { tagName: 'DIV', getAttribute: (n) => (n === 'data-no-league-swipe' ? '' : null) } }, 200, 390)).toBe(true)
    const scroller = { tagName: 'UL', overflowX: 'auto', scrollWidth: 800, clientWidth: 390, parentElement: null }
    expect(swipeStartBlocked({ tagName: 'LI', parentElement: scroller }, 200, 390)).toBe(true)
    const fits = { tagName: 'UL', overflowX: 'auto', scrollWidth: 390, clientWidth: 390, parentElement: null }
    expect(swipeStartBlocked({ tagName: 'LI', parentElement: fits }, 200, 390)).toBe(false)
  })

  it('never runs on a draft room or the commissioner desk', () => {
    expect(LEAGUE_SWIPE_SCREENS.has('home')).toBe(true)
    expect(LEAGUE_SWIPE_SCREENS.has('draft-hq')).toBe(false)
    expect(LEAGUE_SWIPE_SCREENS.has('commissioner')).toBe(false)
  })
})

/* jsdom has no Touch constructor; a plain event carrying `touches` is what the listeners read. */
function touch(target: Element, type: string, x: number, y: number) {
  const e = new Event(type, { bubbles: true }) as Event & { touches: unknown; changedTouches: unknown }
  const point = [{ clientX: x, clientY: y }]
  Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : point })
  Object.defineProperty(e, 'changedTouches', { value: point })
  act(() => {
    target.dispatchEvent(e)
  })
}

function mount(selected = 'B') {
  document.body.innerHTML = ''
  const main = document.createElement('main')
  main.id = 'af-content'
  const content = document.createElement('div')
  content.textContent = 'screen'
  main.appendChild(content)
  /*
   * ⚠ The component renders into its OWN slot beside the content. `render({ container: main })`
   * replaces main's children, which detached the div being swiped — and the "does nothing" tests
   * then passed for no reason. The positive tests below are what prove the dispatch reaches main.
   */
  const slot = document.createElement('div')
  main.appendChild(slot)
  document.body.appendChild(main)
  render(<LeagueSwipe leagues={LEAGUES} selectedLeagueId={selected} />, { container: slot })
  expect(content.isConnected).toBe(true)
  return content
}

function swipe(el: Element, fromX: number, toX: number, dy = 0) {
  touch(el, 'touchstart', fromX, 300)
  touch(el, 'touchmove', (fromX + toX) / 2, 300 + dy / 2)
  touch(el, 'touchmove', toX, 300 + dy)
  touch(el, 'touchend', toX, 300 + dy)
}

describe('league swipe — the gesture', () => {
  beforeEach(() => {
    nav.push.mockClear()
    nav.prefetch.mockClear()
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
  })

  it('a left swipe opens the next league on the same screen, warming it first', () => {
    const el = mount('B')
    swipe(el, 300, 120)
    expect(nav.prefetch).toHaveBeenCalledWith('/core/my-team?league=C')
    expect(nav.push).toHaveBeenCalledWith('/core/my-team?league=C')
  })

  it('a right swipe opens the previous league', () => {
    const el = mount('B')
    swipe(el, 100, 280)
    expect(nav.push).toHaveBeenCalledWith('/core/my-team?league=A')
  })

  it('a vertical scroll, an edge swipe, or a swipe past the last league does nothing', () => {
    const el = mount('B')
    swipe(el, 200, 180, 240)
    swipe(el, 8, 200)
    expect(nav.push).not.toHaveBeenCalled()
    const last = mount('C')
    swipe(last, 300, 120)
    expect(nav.push).not.toHaveBeenCalled()
  })

  it('a swipe inside a sideways scroller belongs to the scroller', () => {
    const el = mount('B')
    const row = document.createElement('ul')
    row.style.overflowX = 'auto'
    Object.defineProperty(row, 'scrollWidth', { value: 900 })
    Object.defineProperty(row, 'clientWidth', { value: 360 })
    const chip = document.createElement('li')
    row.appendChild(chip)
    el.appendChild(row)
    swipe(chip, 300, 120)
    expect(nav.push).not.toHaveBeenCalled()
  })

  it('shows a pager with real links, so the switch is discoverable and works without a gesture', () => {
    mount('B')
    expect(screen.getByText('2 / 3')).toBeTruthy()
    expect(screen.getByText('Alpha League').closest('a')?.getAttribute('href')).toBe('/core/my-team?league=A')
    expect(screen.getByText('Charlie League').closest('a')?.getAttribute('href')).toBe('/core/my-team?league=C')
  })
})
