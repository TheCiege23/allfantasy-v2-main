import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The 30s tab cache must not show a tab as it was BEFORE a change the reader made: a real write,
 * followed by a navigation, refreshes once in the background. Telemetry, previews and chat do not.
 */
const nav = vi.hoisted(() => ({ path: '/core', search: 'league=L1', refresh: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: nav.refresh }),
  usePathname: () => nav.path,
  useSearchParams: () => new URLSearchParams(nav.search),
}))
vi.mock('@/lib/core-app/deployGuard', () => ({
  refreshInBackground: (fn: () => void) => {
    fn()
    return Promise.resolve()
  },
}))

import {
  RouterCacheFreshness,
  __resetRouterCacheFreshnessForTests,
  isAppWrite,
  writeCount,
} from '@/components/shell/RouterCacheFreshness'

let status = 200
beforeEach(() => {
  __resetRouterCacheFreshnessForTests()
  nav.path = '/core'
  nav.search = 'league=L1'
  nav.refresh.mockClear()
  status = 200
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })))
})
afterEach(() => {
  cleanup()
  __resetRouterCacheFreshnessForTests()
  vi.unstubAllGlobals()
})

describe('isAppWrite', () => {
  it.each([
    ['/api/commissioner/join-requests/approve', 'POST', true],
    ['/api/core/lineup', 'PATCH', true],
    ['/api/leagues/L1/members/m2', 'DELETE', true],
    ['/api/core/lineup', 'GET', false],
    ['/api/analytics/track', 'POST', false],
    ['/api/share/track', 'POST', false],
    ['/api/redraft/trade-value-preview', 'POST', false],
    ['/api/shared/chat/threads/t1', 'POST', false],
    ['/api/chimmy/ask', 'POST', false],
    ['https://example.com/api/core/lineup', 'POST', false],
  ])('%s %s -> %s', (url, method, expected) => {
    expect(isAppWrite(url, { method })).toBe(expected)
  })
})

describe('RouterCacheFreshness', () => {
  function navigate(path: string, search: string, rerender: (ui: React.ReactElement) => void) {
    nav.path = path
    nav.search = search
    act(() => rerender(<RouterCacheFreshness />))
  }

  it('a real write, then a tab change, refreshes once in the background', async () => {
    const { rerender } = render(<RouterCacheFreshness />)
    await act(async () => {
      await window.fetch('/api/commissioner/join-requests/approve', { method: 'POST' })
    })
    expect(writeCount()).toBe(1)
    expect(nav.refresh).not.toHaveBeenCalled() // nothing until the reader navigates

    navigate('/core/standings', 'league=L1', rerender)
    expect(nav.refresh).toHaveBeenCalledTimes(1)

    navigate('/core/matchup', 'league=L1', rerender)
    expect(nav.refresh).toHaveBeenCalledTimes(1) // already caught up
  })

  it('tab changes with no write in between cost nothing', () => {
    const { rerender } = render(<RouterCacheFreshness />)
    navigate('/core/standings', 'league=L1', rerender)
    navigate('/core/matchup', 'league=L2', rerender)
    expect(nav.refresh).not.toHaveBeenCalled()
  })

  it('reads, telemetry and failed writes do not mark the cache dirty', async () => {
    const { rerender } = render(<RouterCacheFreshness />)
    await act(async () => {
      await window.fetch('/api/core/lineup')
      await window.fetch('/api/analytics/track', { method: 'POST' })
      status = 500
      await window.fetch('/api/core/lineup', { method: 'PATCH' })
    })
    expect(writeCount()).toBe(0)
    navigate('/core/standings', 'league=L1', rerender)
    expect(nav.refresh).not.toHaveBeenCalled()
  })
})
