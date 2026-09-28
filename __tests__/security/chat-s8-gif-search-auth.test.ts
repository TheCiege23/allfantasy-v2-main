/**
 * S8 — `/api/chat/gifs` answered anonymous requests with no limit, and a search spends the app's GIF
 * provider quota (Klipy / GIPHY keys held server-side). It now needs a signed-in user, and searches
 * are limited per user with the shared limiter (`consumeRateLimit`, lib/rate-limit.ts).
 *
 * The REAL route and the REAL limiter run; the session, the provider and the table are mocked. What
 * is asserted is whether the provider was reached — the thing that costs money.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  session: null as { user?: { id?: string } } | null,
  search: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => h.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    chatGif: { findMany: async () => [], count: async () => 0 },
    $queryRaw: async () => [],
  },
}))
vi.mock('@/lib/rich-message/GIFIntegrationResolver', async (orig) => ({
  ...(await orig<typeof import('@/lib/rich-message/GIFIntegrationResolver')>()),
  isGifSearchConfigured: () => true,
  getGifProviderName: () => 'klipy',
  searchGifs: h.search,
}))

import { GET } from '@/app/api/chat/gifs/route'

const get = (qs: string) => GET(new NextRequest(`https://allfantasy.ai/api/chat/gifs${qs}`))

beforeEach(() => {
  h.session = null
  h.search.mockReset()
  h.search.mockResolvedValue([{ id: 'g1', url: 'https://static.klipy.com/g1.gif', provider: 'klipy' }])
})

describe('S8 /api/chat/gifs', () => {
  it('refuses an anonymous search without reaching the GIF provider', async () => {
    const res = await get('?q=touchdown')
    expect(res.status).toBe(401)
    expect(h.search).not.toHaveBeenCalled()
  })

  it('refuses the anonymous preloaded grid too', async () => {
    expect((await get('')).status).toBe(401)
  })

  it('serves a signed-in member', async () => {
    h.session = { user: { id: 'gif-member-a' } }
    const res = await get('?q=touchdown')
    expect(res.status).toBe(200)
    expect(h.search).toHaveBeenCalledTimes(1)
  })

  it('limits one member to 30 searches a minute; the 31st never reaches the provider', async () => {
    h.session = { user: { id: 'gif-member-b' } }
    for (let i = 0; i < 30; i += 1) expect((await get(`?q=td${i}`)).status).toBe(200)
    const res = await get('?q=one-too-many')
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toMatch(/^\d+$/)
    expect(h.search).toHaveBeenCalledTimes(30)
  })

  it("one member's limit is not another's", async () => {
    h.session = { user: { id: 'gif-member-c' } }
    for (let i = 0; i < 31; i += 1) await get(`?q=c${i}`)
    h.session = { user: { id: 'gif-member-d' } }
    expect((await get('?q=fresh')).status).toBe(200)
  })

  it('browsing the preloaded grid does not use up the search allowance', async () => {
    h.session = { user: { id: 'gif-member-e' } }
    for (let i = 0; i < 40; i += 1) expect((await get(`?offset=${i * 24}`)).status).toBe(200)
    expect((await get('?q=still-allowed')).status).toBe(200)
  })
})
