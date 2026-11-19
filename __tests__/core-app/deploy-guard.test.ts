import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetDeployGuardForTests,
  canRefreshInBackground,
  isNewVersionReady,
  primeDeployBaseline,
  refreshInBackground,
  reloadOntoNewVersion,
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
/** A deployment that also reports the Next build id it is serving. */
const build = (id: string, buildId: string | null) => ({
  status: 200,
  body: { ok: true, sha: 'abc', deploymentId: id, buildId },
})

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

  describe('a pinned build id', () => {
    it('keeps refreshing across a deploy — and still raises "new version"', async () => {
      mockMarker([build('d-1', 'af-stable-1'), build('d-2', 'af-stable-1')])
      await primeDeployBaseline()
      const listener = vi.fn()
      subscribeNewVersionReady(listener)
      const refresh = vi.fn()

      await refreshInBackground(refresh)
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(isNewVersionReady()).toBe(true)
      expect(listener).toHaveBeenCalledTimes(1)

      // Not a one-off: later ticks, and later deploys on the same build id, keep refreshing.
      vi.setSystemTime(new Date('2026-11-14T12:05:00Z'))
      await refreshInBackground(refresh)
      expect(refresh).toHaveBeenCalledTimes(2)
    })

    it('🛑 stops for good the moment a deploy reports a DIFFERENT build id', async () => {
      mockMarker([build('d-1', 'af-stable-1'), build('d-2', 'af-stable-1'), build('d-3', 'af-stable-2')])
      await primeDeployBaseline()
      const refresh = vi.fn()

      await refreshInBackground(refresh)
      expect(refresh).toHaveBeenCalledTimes(1)

      vi.setSystemTime(new Date('2026-11-14T12:05:00Z'))
      await refreshInBackground(refresh)
      expect(refresh).toHaveBeenCalledTimes(1)

      // Sticky, and it no longer asks: this page can never soft-refresh again.
      vi.setSystemTime(new Date('2026-11-14T12:10:00Z'))
      await refreshInBackground(refresh)
      expect(refresh).toHaveBeenCalledTimes(1)
    })

    it('🛑 an UNKNOWN build id on either side is not a match', async () => {
      // Booted without one (an older server), then a pinned server appears.
      mockMarker([build('d-1', null), build('d-2', 'af-stable-1')])
      await primeDeployBaseline()
      const refresh = vi.fn()
      await refreshInBackground(refresh)
      expect(refresh).not.toHaveBeenCalled()

      // Booted with one, then a server that cannot say.
      __resetDeployGuardForTests()
      mockMarker([build('d-1', 'af-stable-1'), build('d-2', null)])
      await primeDeployBaseline()
      await refreshInBackground(refresh)
      expect(refresh).not.toHaveBeenCalled()
      expect(isNewVersionReady()).toBe(true)
    })
  })

  describe('reloading onto the new build after a screen breaks', () => {
    const reload = vi.fn()
    const realLocation = window.location
    beforeEach(() => {
      reload.mockClear()
      window.sessionStorage.clear()
      Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, reload } })
    })
    afterEach(() => {
      Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
    })

    it('does nothing when no newer build is out', async () => {
      mockMarker([build('d-1', 'af-stable-1')])
      await primeDeployBaseline()
      expect(await reloadOntoNewVersion({ canInterrupt: () => true })).toBe(false)
      expect(reload).not.toHaveBeenCalled()
    })

    it('reloads once when one is — finding that out itself if no poller has looked', async () => {
      mockMarker([build('d-1', 'af-stable-1'), build('d-2', 'af-stable-1')])
      await primeDeployBaseline()
      expect(isNewVersionReady()).toBe(false)
      expect(await reloadOntoNewVersion({ canInterrupt: () => true })).toBe(true)
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('🛑 never twice inside the cooldown, so a broken new build cannot loop', async () => {
      mockMarker([build('d-1', 'af-stable-1'), build('d-2', 'af-stable-1')])
      await primeDeployBaseline()
      await reloadOntoNewVersion({ canInterrupt: () => true })
      expect(await reloadOntoNewVersion({ canInterrupt: () => true })).toBe(false)
      expect(reload).toHaveBeenCalledTimes(1)

      vi.setSystemTime(new Date('2026-11-14T12:02:00Z'))
      expect(await reloadOntoNewVersion({ canInterrupt: () => true })).toBe(true)
      expect(reload).toHaveBeenCalledTimes(2)
    })

    it('🛑 not when the caller says a reload would destroy something (music)', async () => {
      mockMarker([build('d-1', 'af-stable-1'), build('d-2', 'af-stable-1')])
      await primeDeployBaseline()
      expect(await reloadOntoNewVersion({ canInterrupt: () => false })).toBe(false)
      expect(reload).not.toHaveBeenCalled()
      // …and refusing does not spend the cooldown.
      expect(await reloadOntoNewVersion({ canInterrupt: () => true })).toBe(true)
    })
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
