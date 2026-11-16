import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * A new deploy is picked up WITHOUT a button: the page reloads itself only when the reader cannot
 * see it or is not using it, and never over text they typed.
 */
const guard = vi.hoisted(() => ({ ready: false, listeners: new Set<() => void>() }))
vi.mock('@/lib/core-app/deployGuard', () => ({
  isNewVersionReady: () => guard.ready,
  subscribeNewVersionReady: (fn: () => void) => {
    guard.listeners.add(fn)
    return () => guard.listeners.delete(fn)
  },
}))
const route = vi.hoisted(() => ({ path: '/core' }))
vi.mock('next/navigation', () => ({ usePathname: () => route.path }))

import { IDLE_RELOAD_MS, NewVersionReload } from '@/components/shell/NewVersionReload'

const reload = vi.fn()
const realLocation = window.location

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

function deployLands() {
  guard.ready = true
  act(() => {
    for (const fn of guard.listeners) fn()
  })
}

function hideTab() {
  setVisibility('hidden')
  act(() => void document.dispatchEvent(new Event('visibilitychange')))
}

beforeEach(() => {
  vi.useFakeTimers()
  guard.ready = false
  route.path = '/core'
  guard.listeners.clear()
  reload.mockClear()
  setVisibility('visible')
  Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, reload } })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  document.body.innerHTML = ''
})

describe('NewVersionReload', () => {
  it('does nothing while the build has not changed', () => {
    render(<NewVersionReload />)
    hideTab()
    act(() => void vi.advanceTimersByTime(IDLE_RELOAD_MS * 3))
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads the moment the tab goes into the background after a deploy', () => {
    render(<NewVersionReload />)
    deployLands()
    expect(reload).not.toHaveBeenCalled()
    hideTab()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads at once if the deploy is noticed while the tab is already hidden', () => {
    render(<NewVersionReload />)
    setVisibility('hidden')
    deployLands()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('on a visible page, waits for the idle window — and a tap resets it', () => {
    render(<NewVersionReload />)
    deployLands()
    act(() => void vi.advanceTimersByTime(IDLE_RELOAD_MS - 1000))
    expect(reload).not.toHaveBeenCalled()

    act(() => void window.dispatchEvent(new Event('pointerdown')))
    act(() => void vi.advanceTimersByTime(IDLE_RELOAD_MS - 1000))
    expect(reload).not.toHaveBeenCalled()

    act(() => void vi.advanceTimersByTime(2000))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('🛑 never reloads over text the reader typed and has not sent', () => {
    render(<NewVersionReload />)
    const box = document.createElement('textarea')
    document.body.appendChild(box)
    box.value = 'trade offer: my RB for your WR'
    act(() => void box.dispatchEvent(new Event('input', { bubbles: true })))
    box.blur()

    deployLands()
    hideTab()
    act(() => void vi.advanceTimersByTime(IDLE_RELOAD_MS * 2))
    expect(reload).not.toHaveBeenCalled()
  })

  it('a field that was sent and cleared no longer blocks it', () => {
    render(<NewVersionReload />)
    const box = document.createElement('input')
    box.type = 'text'
    document.body.appendChild(box)
    box.value = 'gg'
    act(() => void box.dispatchEvent(new Event('input', { bubbles: true })))
    box.value = ''

    deployLands()
    hideTab()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('screens that are watched, not used', () => {
  it.each([
    '/core/draft-hq',
    '/draft/room/d1',
    '/draft/live/d1',
    '/mock-draft',
    '/mock-draft-simulator',
    '/league/L1/draft',
    '/league/L1/dispersal-draft/d1',
  ])('🛑 a draft screen (%s) is never reloaded — not idle, not even in the background', (path) => {
    route.path = path
    render(<NewVersionReload />)
    deployLands()
    act(() => void vi.advanceTimersByTime(IDLE_RELOAD_MS * 2))
    hideTab()
    expect(reload).not.toHaveBeenCalled()
  })

  it.each(['/core/live', '/core/matchup', '/live'])(
    'a game screen (%s) is not reloaded for being untouched, but is once it goes into the background',
    (path) => {
      route.path = path
      render(<NewVersionReload />)
      deployLands()
      act(() => void vi.advanceTimersByTime(IDLE_RELOAD_MS * 2))
      expect(reload).not.toHaveBeenCalled()
      hideTab()
      expect(reload).toHaveBeenCalledTimes(1)
    },
  )

  it('every other screen keeps the idle rule', () => {
    route.path = '/core/standings'
    render(<NewVersionReload />)
    deployLands()
    act(() => void vi.advanceTimersByTime(IDLE_RELOAD_MS + 1000))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
