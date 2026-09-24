import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchIpApi, fetchProxycheck } from '@/lib/geo/geoIpFetch'

/**
 * Both geo vendors take their key in the QUERY STRING. Passing `cache: "no-store"` together with
 * `next: { revalidate: 0 }` makes Next.js warn about the conflict — and that warning quotes the
 * full URL, key and visitor IP included, into the server log. Seen in production deploy logs on
 * 2026-09-24 on every /api/geo/check. One option, never both.
 */
afterEach(() => vi.unstubAllGlobals())

function captureInit() {
  const calls: Array<RequestInit & { next?: unknown }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init)
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
    }),
  )
  return calls
}

describe('geo vendor fetches never trip the Next warning that prints the URL', () => {
  it.each([
    ['proxycheck', () => fetchProxycheck('203.0.113.9', 'k-secret')],
    ['ipapi', () => fetchIpApi('203.0.113.9', 'k-secret')],
  ])('%s asks for no caching once, not twice', async (_name, call) => {
    const calls = captureInit()
    await call()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.cache).toBe('no-store')
    expect(calls[0]!.next).toBeUndefined()
  })
})
