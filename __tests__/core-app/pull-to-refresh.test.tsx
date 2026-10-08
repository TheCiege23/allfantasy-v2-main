import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'

const nav = vi.hoisted(() => ({ refresh: vi.fn() }))
const sync = vi.hoisted(() => ({ start: vi.fn(async () => ({})) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: nav.refresh, push() {}, prefetch() {} }) }))
vi.mock('@/lib/core-app/clientSyncJob', () => ({ startClientSync: sync.start }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: 'en' }) }))

import { pullAxis, pullDistance, pullIsReady, pullStartBlocked, PULL_MAX_PX } from '@/lib/core-app/pullToRefresh'
import { PullToRefresh } from '@/components/core-app/PullToRefresh'

describe('pull to refresh — the rules', () => {
  it('moves the indicator half as far as the finger, capped, and is ready past the threshold', () => {
    expect(pullDistance(-20)).toBe(0)
    expect(pullDistance(100)).toBe(50)
    expect(pullIsReady(pullDistance(100))).toBe(false)
    expect(pullIsReady(pullDistance(140))).toBe(true)
    expect(pullDistance(1000)).toBe(PULL_MAX_PX)
  })

  it('counts only a downward, mostly vertical drag as a pull', () => {
    expect(pullAxis(2, 3)).toBeNull()
    expect(pullAxis(0, 40)).toBe('pull')
    expect(pullAxis(60, 30)).toBe('other') // a league swipe
    expect(pullAxis(0, -40)).toBe('other') // scrolling down the page
  })

  it('leaves scrolled pages, form fields, dialogs, opt-outs and inner scrollers alone', () => {
    const plain = { tagName: 'DIV', getAttribute: () => null, parentElement: null }
    expect(pullStartBlocked(plain, 0)).toBe(false)
    expect(pullStartBlocked(plain, 12)).toBe(true)
    expect(pullStartBlocked({ tagName: 'TEXTAREA', parentElement: null }, 0)).toBe(true)
    expect(pullStartBlocked({ tagName: 'DIV', getAttribute: (n) => (n === 'role' ? 'dialog' : null), parentElement: null }, 0)).toBe(true)
    const thread = { tagName: 'DIV', overflowY: 'auto', scrollHeight: 2000, clientHeight: 400, parentElement: null }
    expect(pullStartBlocked({ tagName: 'P', parentElement: thread }, 0)).toBe(true)
    const fits = { tagName: 'DIV', overflowY: 'auto', scrollHeight: 400, clientHeight: 400, parentElement: null }
    expect(pullStartBlocked({ tagName: 'P', parentElement: fits }, 0)).toBe(false)
  })
})

/* jsdom has no Touch constructor; a plain event carrying `touches` is what the listeners read. */
function touch(target: EventTarget, type: string, x: number, y: number) {
  const e = new Event(type, { bubbles: true }) as Event & { touches: unknown; changedTouches: unknown }
  const point = [{ clientX: x, clientY: y }]
  Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : point })
  Object.defineProperty(e, 'changedTouches', { value: point })
  act(() => {
    target.dispatchEvent(e)
  })
}

function pull(target: Element, from: { x: number; y: number }, to: { x: number; y: number }) {
  touch(target, 'touchstart', from.x, from.y)
  touch(target, 'touchmove', (from.x + to.x) / 2, (from.y + to.y) / 2)
  touch(target, 'touchmove', to.x, to.y)
  touch(target, 'touchend', to.x, to.y)
}

function mount(syncStale = false) {
  document.body.innerHTML = ''
  const content = document.createElement('div')
  content.textContent = 'screen'
  document.body.appendChild(content)
  const slot = document.createElement('div')
  document.body.appendChild(slot)
  const view = render(<PullToRefresh syncStale={syncStale} />, { container: slot })
  return { content, view }
}

describe('pull to refresh — the gesture', () => {
  beforeEach(() => {
    nav.refresh.mockClear()
    sync.start.mockClear()
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    document.body.style.overflow = ''
  })

  it('a long pull from the top refreshes the screen, and says it is releasing first', () => {
    const { content, view } = mount()
    touch(content, 'touchstart', 200, 100)
    touch(content, 'touchmove', 200, 260)
    expect(view.container.textContent).toContain('Release to refresh')
    touch(content, 'touchend', 200, 260)
    expect(nav.refresh).toHaveBeenCalledTimes(1)
    expect(sync.start).not.toHaveBeenCalled() // fresh leagues: no provider sync
  })

  it('says "Up to date" when the refresh settles, then gets out of the way', async () => {
    vi.useFakeTimers()
    try {
      const { content, view } = mount()
      pull(content, { x: 200, y: 100 }, { x: 200, y: 260 })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50)
      })
      expect(view.container.querySelector('.af-ptr')?.getAttribute('data-phase')).toBe('done')
      expect(view.container.textContent).toContain('Up to date')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800)
      })
      // 🛑 It used to stay up forever: the timer that hides it was cancelled by its own effect's cleanup.
      expect(view.container.querySelector('.af-ptr')?.getAttribute('data-phase')).toBe('idle')
    } finally {
      vi.useRealTimers()
    }
  })

  it('also starts the league sync when the leagues are stale', () => {
    const { content } = mount(true)
    pull(content, { x: 200, y: 100 }, { x: 200, y: 260 })
    expect(nav.refresh).toHaveBeenCalledTimes(1)
    expect(sync.start).toHaveBeenCalledTimes(1)
  })

  it('a short pull, a sideways swipe, a scrolled page, or an open modal does nothing', () => {
    const { content } = mount()
    pull(content, { x: 200, y: 100 }, { x: 200, y: 160 }) // short
    pull(content, { x: 300, y: 100 }, { x: 100, y: 130 }) // league swipe
    Object.defineProperty(window, 'scrollY', { value: 300, configurable: true })
    pull(content, { x: 200, y: 100 }, { x: 200, y: 300 }) // mid-page
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    document.body.style.overflow = 'hidden'
    pull(content, { x: 200, y: 100 }, { x: 200, y: 300 }) // modal open
    expect(nav.refresh).not.toHaveBeenCalled()
  })

  it('a pull inside something that scrolls on its own belongs to it', () => {
    const { content } = mount()
    const thread = document.createElement('div')
    thread.style.overflowY = 'auto'
    Object.defineProperty(thread, 'scrollHeight', { value: 2000 })
    Object.defineProperty(thread, 'clientHeight', { value: 400 })
    const msg = document.createElement('p')
    thread.appendChild(msg)
    content.appendChild(thread)
    pull(msg, { x: 200, y: 100 }, { x: 200, y: 300 })
    expect(nav.refresh).not.toHaveBeenCalled()
  })
})
