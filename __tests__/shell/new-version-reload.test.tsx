import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * A new deploy is picked up WITHOUT a button: the page reloads itself only when the reader cannot
 * see it, never over text they typed, and never while music is loaded.
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

import { NewVersionReload } from '@/components/shell/NewVersionReload'
import { musicBus, type MusicSnapshot } from '@/components/app-music/musicBus'

const reload = vi.fn()
const realLocation = window.location
const NO_MUSIC: MusicSnapshot = musicBus.getServerSnapshot()
/** Far longer than the three-minute idle window the visible-page reload used to have. */
const A_LONG_TIME_MS = 60 * 60_000

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
  musicBus.publish(NO_MUSIC)
  setVisibility('visible')
  Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, reload } })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  musicBus.publish(NO_MUSIC)
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  document.body.innerHTML = ''
})

describe('NewVersionReload', () => {
  it('does nothing while the build has not changed', () => {
    render(<NewVersionReload />)
    hideTab()
    act(() => void vi.advanceTimersByTime(A_LONG_TIME_MS))
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

  it.each(['/core', '/core/standings', '/core/live', '/core/matchup'])(
    '🛑 a page the reader can see (%s) is never reloaded, however long it sits untouched',
    (path) => {
      route.path = path
      render(<NewVersionReload />)
      deployLands()
      act(() => void vi.advanceTimersByTime(A_LONG_TIME_MS))
      expect(reload).not.toHaveBeenCalled()
      // …and the background reload still works afterwards.
      hideTab()
      expect(reload).toHaveBeenCalledTimes(1)
    },
  )

  it('🛑 never reloads over text the reader typed and has not sent', () => {
    render(<NewVersionReload />)
    const box = document.createElement('textarea')
    document.body.appendChild(box)
    box.value = 'trade offer: my RB for your WR'
    act(() => void box.dispatchEvent(new Event('input', { bubbles: true })))
    box.blur()

    deployLands()
    hideTab()
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

describe('music', () => {
  it('🛑 a YouTube track is never cut off — not when the tab goes into the background', () => {
    render(<NewVersionReload />)
    musicBus.publish({
      ...NO_MUSIC,
      ready: true,
      yt: { key: 'v:abc', label: 'Clipse - So Be It' } as MusicSnapshot['yt'],
    })
    deployLands()
    hideTab()
    act(() => void vi.advanceTimersByTime(A_LONG_TIME_MS))
    expect(reload).not.toHaveBeenCalled()
  })

  it('🛑 nor when the deploy is noticed while the tab is already in the background', () => {
    render(<NewVersionReload />)
    musicBus.publish({
      ...NO_MUSIC,
      ready: true,
      yt: { key: 'v:abc', label: 'Clipse - So Be It' } as MusicSnapshot['yt'],
    })
    setVisibility('hidden')
    deployLands()
    expect(reload).not.toHaveBeenCalled()
  })

  it('🛑 an Apple Music track blocks it too, paused or playing', () => {
    render(<NewVersionReload />)
    musicBus.publish({
      ...NO_MUSIC,
      ready: true,
      appleNow: { title: 'So Be It', artist: 'Clipse', art: null, playing: false },
    })
    deployLands()
    hideTab()
    expect(reload).not.toHaveBeenCalled()
  })

  it('once the music is stopped, the next trip to the background picks the build up', () => {
    render(<NewVersionReload />)
    musicBus.publish({
      ...NO_MUSIC,
      ready: true,
      yt: { key: 'v:abc', label: 'Clipse - So Be It' } as MusicSnapshot['yt'],
    })
    deployLands()
    hideTab()
    expect(reload).not.toHaveBeenCalled()

    setVisibility('visible')
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    musicBus.publish({ ...NO_MUSIC, ready: true })
    hideTab()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('draft screens', () => {
  it.each([
    '/core/draft-hq',
    '/draft/room/d1',
    '/draft/live/d1',
    '/mock-draft',
    '/mock-draft-simulator',
    '/league/L1/draft',
    '/league/L1/dispersal-draft/d1',
  ])('🛑 a draft screen (%s) is never reloaded — not even in the background', (path) => {
    route.path = path
    render(<NewVersionReload />)
    deployLands()
    act(() => void vi.advanceTimersByTime(A_LONG_TIME_MS))
    hideTab()
    expect(reload).not.toHaveBeenCalled()
  })
})
