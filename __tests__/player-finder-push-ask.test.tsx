import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The in-context push ask (2026-10-10): offered only while the browser is undecided, never to
 * someone who already said yes or no, never inside the iPhone app, with the iPhone-Safari how-to
 * instead of a button that cannot work — and every outcome counted.
 */

const h = vi.hoisted(() => ({
  state: { supported: true, permission: 'default', subscribed: false, busy: false, error: null as string | null },
  subscribe: vi.fn(),
  iphone: vi.fn(() => false),
}))

vi.mock('@/lib/push-notifications/useWebPushSubscription', () => ({
  useWebPushSubscription: () => ({ ...h.state, subscribe: h.subscribe, unsubscribe: vi.fn() }),
}))
vi.mock('@/components/notifications/EnableWebPushCard', () => ({ isIosSafariWithoutStandalone: h.iphone }))

import { PushAsk } from '@/components/core-app/player-finder/PushAsk'

const fetchMock = vi.fn()

function tracked(): Array<{ event: string; meta: { placement: string } }> {
  return fetchMock.mock.calls
    .filter((c) => c[0] === '/api/analytics/track')
    .map((c) => JSON.parse((c[1] as { body: string }).body))
}

beforeEach(() => {
  h.state = { supported: true, permission: 'default', subscribed: false, busy: false, error: null }
  h.subscribe.mockReset()
  h.iphone.mockReturnValue(false)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => (url === '/api/push/subscribe' ? { configured: true, vapidPublicKey: 'BKey' } : { ok: true }),
  }))
  vi.stubGlobal('fetch', fetchMock)
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-ios-app')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('PushAsk', () => {
  it('undecided browser: offers to turn alerts on, counts the view, and calls the ONE subscribe flow', async () => {
    render(<PushAsk placement="follow" />)
    const go = await screen.findByRole('button', { name: 'Turn on alerts' })
    expect(screen.getByText('Get this alert on your phone')).toBeInTheDocument()
    fireEvent.click(go)
    expect(h.subscribe).toHaveBeenCalledTimes(1)
    expect(tracked()).toEqual([expect.objectContaining({ event: 'push_ask_shown', meta: { placement: 'follow' } })])
  })

  it('once subscribed, says so and counts the conversion', async () => {
    const { rerender } = render(<PushAsk placement="finder_home" />)
    await screen.findByRole('button', { name: 'Turn on alerts' })
    h.state = { ...h.state, permission: 'granted', subscribed: true }
    rerender(<PushAsk placement="finder_home" />)
    expect(await screen.findByRole('status')).toHaveTextContent('Alerts are on for this phone.')
    expect(tracked().map((e) => e.event)).toEqual(['push_ask_shown', 'push_ask_enabled'])
  })

  it('🛑 already granted (subscription not confirmed yet): never flashes, never logs a false conversion', async () => {
    h.state = { ...h.state, permission: 'granted', subscribed: false }
    const { container, rerender } = render(<PushAsk placement="follow" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/push/subscribe'))
    expect(container.innerHTML).toBe('')
    h.state = { ...h.state, subscribed: true }
    rerender(<PushAsk placement="follow" />)
    expect(container.innerHTML).toBe('')
    expect(tracked()).toEqual([])
  })

  it('denied: says nothing — a denial cannot be re-asked from script', async () => {
    h.state = { ...h.state, permission: 'denied' }
    const { container } = render(<PushAsk placement="follow" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('iPhone Safari outside a Home Screen app: the how-to, and no button that cannot work', async () => {
    h.state = { ...h.state, supported: false, permission: 'unsupported' }
    h.iphone.mockReturnValue(true)
    render(<PushAsk placement="follow" />)
    expect(await screen.findByText(/Add to Home Screen/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Turn on alerts' })).toBeNull()
  })

  it('inside the iPhone app (native push), or with push not configured on the server: nothing', async () => {
    document.documentElement.setAttribute('data-ios-app', '')
    const app = render(<PushAsk placement="follow" />)
    expect(app.container.innerHTML).toBe('')
    app.unmount()
    document.documentElement.removeAttribute('data-ios-app')
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ configured: false, vapidPublicKey: null }) }))
    const off = render(<PushAsk placement="follow" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/push/subscribe'))
    expect(off.container.innerHTML).toBe('')
  })

  it('"Not now" hides this placement for the week, and is counted', async () => {
    const { container, unmount } = render(<PushAsk placement="finder_home" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }))
    expect(container.innerHTML).toBe('')
    expect(tracked().map((e) => e.event)).toEqual(['push_ask_shown', 'push_ask_dismissed'])
    unmount()
    const again = render(<PushAsk placement="finder_home" />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(again.container.innerHTML).toBe('')
  })

  it('notOnGameDays: quiet on a Sunday (the game-day banner already asks), offered on a Tuesday', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 11, 12)) // Sunday, local time
    const sun = render(<PushAsk placement="finder_home" notOnGameDays />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(sun.container.innerHTML).toBe('')
    sun.unmount()
    vi.setSystemTime(new Date(2026, 9, 13, 12)) // Tuesday
    render(<PushAsk placement="finder_home" notOnGameDays />)
    expect(await screen.findByRole('button', { name: 'Turn on alerts' })).toBeInTheDocument()
  })
})
