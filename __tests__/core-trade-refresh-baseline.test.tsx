import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Home's trade check rebuilds the page only when the trade feed changed. Its first answer is the
 * baseline for the page just rendered; before 2026-11-19 it counted as a change, so every open of
 * Home paid one needless full rebuild.
 */

const nav = vi.hoisted(() => ({ router: { refresh: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => nav.router }))
vi.mock('@/lib/core-app/deployGuard', () => ({
  primeDeployBaseline: () => Promise.resolve(),
  refreshInBackground: (fn: () => void) => { fn(); return Promise.resolve() },
}))

import CoreTradeRefresh from '@/components/core-app/CoreTradeRefresh'

const server = { version: 't1' }
const fetchMock = vi.fn(async () => new Response(JSON.stringify({ version: server.version }), { status: 200 }))
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  nav.router.refresh.mockClear()
  fetchMock.mockClear()
  server.version = 't1'
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('CoreTradeRefresh', () => {
  it('does not rebuild on its first answer, or while nothing changes', async () => {
    render(<CoreTradeRefresh />)
    await tick(5_000 * 6)
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(6)
    expect(nav.router.refresh).not.toHaveBeenCalled()
  })

  it('rebuilds once when the trade feed changes', async () => {
    render(<CoreTradeRefresh />)
    await tick(5_000)
    server.version = 't2'
    await tick(5_000)
    expect(nav.router.refresh).toHaveBeenCalledTimes(1)
    await tick(5_000 * 3)
    expect(nav.router.refresh).toHaveBeenCalledTimes(1)
  })
})
