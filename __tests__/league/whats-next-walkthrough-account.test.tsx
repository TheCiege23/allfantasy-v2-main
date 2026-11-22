import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const getServerSession = vi.fn()
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
const store = { getWalkthroughSeen: vi.fn(), markWalkthroughSeenForUser: vi.fn() }
vi.mock('@/lib/league/whats-next/walkthroughSeenStore', async (orig) => {
  const real = await orig<typeof import('@/lib/league/whats-next/walkthroughSeenStore')>()
  return { ...real, getWalkthroughSeen: (...a: unknown[]) => store.getWalkthroughSeen(...a), markWalkthroughSeenForUser: (...a: unknown[]) => store.markWalkthroughSeenForUser(...a) }
})

import { readWalkthroughSeen } from '@/lib/league/whats-next/walkthroughSeenStore'
import { fetchAccountWalkthroughSeen, walkthroughSeenKey } from '@/lib/league/whats-next/formatWalkthroughs'
import { GET, POST } from '@/app/api/user/format-walkthroughs/route'
import { WhatsNextPanel } from '@/components/league/whats-next/WhatsNextPanel'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

beforeEach(() => {
  getServerSession.mockReset()
  store.getWalkthroughSeen.mockReset()
  store.markWalkthroughSeenForUser.mockReset()
  window.localStorage.clear()
})
afterEach(() => cleanup())

describe('readWalkthroughSeen', () => {
  it('keeps only real formats with a parseable time', () => {
    expect(readWalkthroughSeen({ big_brother: '2026-11-10T12:00:00.000Z', redraft: '2026-11-10T12:00:00.000Z', survivor: 'yesterday', nope: '2026-01-01T00:00:00Z' }))
      .toEqual({ big_brother: '2026-11-10T12:00:00.000Z' })
    expect(readWalkthroughSeen(null)).toEqual({})
    expect(readWalkthroughSeen(['big_brother'])).toEqual({})
  })
})

describe('fetchAccountWalkthroughSeen', () => {
  it('is true, false, or null for unknown — never a guess', async () => {
    expect(await fetchAccountWalkthroughSeen('big_brother', vi.fn(async () => json({ seen: { big_brother: '2026-11-10T00:00:00Z' } })) as never)).toBe(true)
    expect(await fetchAccountWalkthroughSeen('big_brother', vi.fn(async () => json({ seen: {} })) as never)).toBe(false)
    expect(await fetchAccountWalkthroughSeen('big_brother', vi.fn(async () => json({ error: 'x' }, 503)) as never)).toBeNull()
    expect(await fetchAccountWalkthroughSeen('big_brother', vi.fn(async () => { throw new Error('offline') }) as never)).toBeNull()
  })
})

describe('/api/user/format-walkthroughs', () => {
  const post = (body: unknown) => POST(new Request('http://x/api/user/format-walkthroughs', { method: 'POST', body: JSON.stringify(body) }) as never)

  it('refuses a signed-out caller', async () => {
    getServerSession.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
    expect((await post({ format: 'big_brother' })).status).toBe(401)
    expect(store.markWalkthroughSeenForUser).not.toHaveBeenCalled()
  })

  it('reports a failed read as unavailable, not as "nothing seen"', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } })
    store.getWalkthroughSeen.mockResolvedValue(null)
    expect((await GET()).status).toBe(503)
    store.getWalkthroughSeen.mockResolvedValue({ survivor: '2026-11-10T00:00:00Z' })
    const res = await GET()
    expect(await res.json()).toEqual({ seen: { survivor: '2026-11-10T00:00:00Z' } })
  })

  it('marks only a format that has a walkthrough, for the caller only', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } })
    expect((await post({ format: 'redraft' })).status).toBe(400)
    expect((await post({ format: 'big_brother', userId: 'someone-else' })).status).toBe(200)
    expect(store.markWalkthroughSeenForUser).toHaveBeenCalledTimes(1)
    expect(store.markWalkthroughSeenForUser.mock.calls[0].slice(0, 2)).toEqual(['u1', 'big_brother'])
  })
})

describe('the panel’s first-time walkthrough', () => {
  const summary = { cycle: null, rosterDisplayNames: {} }
  const league = { id: 'L1', leagueType: 'big_brother', format: 'redraft' } as never
  const renderPanel = () =>
    render(<WhatsNextPanel league={league} userId="u1" isCommissioner draftDateIso={null} onSelectTab={() => {}} autoOpenWalkthrough />)

  function mockFetch(seen: Record<string, string> | 'fail') {
    const calls: { url: string; method: string; body?: string }[] = []
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body as string | undefined })
      if (String(url).includes('format-walkthroughs')) {
        if (init?.method === 'POST') return json({ ok: true })
        return seen === 'fail' ? json({ error: 'x' }, 503) : json({ seen })
      }
      return json(summary)
    }) as never
    return calls
  }

  it('does not open on this device when the account has already seen it', async () => {
    const calls = mockFetch({ big_brother: '2026-11-01T00:00:00Z' })
    renderPanel()
    await waitFor(() => expect(calls.some((c) => c.url.includes('format-walkthroughs'))).toBe(true))
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('format-walkthrough')).toBeNull()
    // …and remembers it here, so the next visit makes no request.
    expect(window.localStorage.getItem(walkthroughSeenKey('u1', 'big_brother'))).toBe('1')
  })

  it('opens when the account has not seen it, and saves to the account on close', async () => {
    const calls = mockFetch({})
    renderPanel()
    expect(await screen.findByTestId('format-walkthrough')).toBeTruthy()
    fireEvent.click(screen.getByTestId('format-walkthrough-skip'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body!)).toEqual({ format: 'big_brother' })
  })

  it('still opens when the account cannot answer (unknown is not "seen")', async () => {
    mockFetch('fail')
    renderPanel()
    expect(await screen.findByTestId('format-walkthrough')).toBeTruthy()
  })

  it('makes no account request when this browser already knows', async () => {
    window.localStorage.setItem(walkthroughSeenKey('u1', 'big_brother'), '1')
    const calls = mockFetch({})
    renderPanel()
    await new Promise((r) => setTimeout(r, 30))
    expect(calls.some((c) => c.url.includes('format-walkthroughs'))).toBe(false)
    expect(screen.queryByTestId('format-walkthrough')).toBeNull()
  })
})
