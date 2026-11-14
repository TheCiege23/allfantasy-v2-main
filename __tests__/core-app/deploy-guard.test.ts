import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetDeployGuardForTests,
  canRefreshInBackground,
  isNewVersionReady,
  primeDeployBaseline,
  refreshInBackground,
  subscribeNewVersionReady,
} from '@/lib/core-app/deployGuard'

/**
 * A background `router.refresh()` after a deploy is a full page reload (Next.js hard-
 * navigates on a build-id mismatch). The guard must let same-deploy refreshes through,
 * stop them once the deployment changes, and stop them while the marker cannot be read.
 */

type Reply = { status: number; body?: unknown } | 'throw'

function mockMarker(replies: Reply[]) {
  const calls: string[] = []
  const fetchMock = vi.fn(async (url: string) => {
    calls.push(String(url))
    const next = replies.length > 1 ? replies.shift()! : replies[0]
    if (next === 'throw') throw new TypeError('network down')
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls }
}

const deploy = (id: string) => ({ status: 200, body: { ok: true, sha: 'abc', deploymentId: id } })

describe('deployGuard', () => {
  beforeEach(() => {
    __resetDeployGuardForTests()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-14T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('lets a refresh through while the deployment is unchanged', async () => {
    const { calls } = mockMarker([deploy('d-1')])
    await primeDeployBaseline()
    const refresh = vi.fn()
    await refreshInBackground(refresh)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(isNewVersionReady()).toBe(false)
    expect(calls.every((u) => u === '/api/af-debug/sha')).toBe(true)
  })

  it('skips the refresh and raises "new version" once the deployment changes', async () => {
    mockMarker([deploy('d-1'), deploy('d-2')])
    await primeDeployBaseline()
    const listener = vi.fn()
    subscribeNewVersionReady(listener)
    const refresh = vi.fn()
    await refreshInBackground(refresh)
    expect(refresh).not.toHaveBeenCalled()
    expect(isNewVersionReady()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)

    // Sticky: later ticks never refresh again on this page, even past the TTL.
    vi.setSystemTime(new Date('2026-11-14T12:05:00Z'))
    await refreshInBackground(refresh)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('skips the tick when the marker is unreadable (server mid-swap), then recovers', async () => {
    mockMarker([deploy('d-1'), { status: 502 }, 'throw', deploy('d-1')])
    await primeDeployBaseline()
    const refresh = vi.fn()

    await refreshInBackground(refresh)
    expect(refresh).not.toHaveBeenCalled()

    vi.setSystemTime(new Date('2026-11-14T12:00:11Z'))
    await refreshInBackground(refresh)
    expect(refresh).not.toHaveBeenCalled()

    vi.setSystemTime(new Date('2026-11-14T12:00:22Z'))
    await refreshInBackground(refresh)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(isNewVersionReady()).toBe(false)
  })

  it('shares one marker read across pollers ticking together', async () => {
    const { fetchMock } = mockMarker([deploy('d-1')])
    await primeDeployBaseline()
    fetchMock.mockClear()
    const results = await Promise.all([canRefreshInBackground(), canRefreshInBackground(), canRefreshInBackground()])
    expect(results).toEqual([true, true, true])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the commit sha when no deployment id is reported', async () => {
    mockMarker([
      { status: 200, body: { sha: 'aaa', deploymentId: null } },
      { status: 200, body: { sha: 'bbb', deploymentId: null } },
    ])
    await primeDeployBaseline()
    const refresh = vi.fn()
    await refreshInBackground(refresh)
    expect(refresh).not.toHaveBeenCalled()
    expect(isNewVersionReady()).toBe(true)
  })
})
