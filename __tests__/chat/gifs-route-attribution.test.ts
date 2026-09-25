import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, search: vi.fn(), configured: vi.fn(), name: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    chatGif: { findMany: async () => h.rows, count: async () => h.rows.length },
    $queryRaw: async () => h.rows,
  },
}))
vi.mock('@/lib/rich-message/GIFIntegrationResolver', async (orig) => ({
  ...(await orig<typeof import('@/lib/rich-message/GIFIntegrationResolver')>()),
  isGifSearchConfigured: h.configured,
  getGifProviderName: h.name,
  searchGifs: h.search,
}))

import { GET } from '@/app/api/chat/gifs/route'

const row = (url: string) => ({ id: 'r1', giphyId: 'k1', title: 'td', url, previewUrl: url, tags: [], category: 'sports', width: 1, height: 1 })
const get = async (qs = '') => (await GET(new NextRequest(`https://allfantasy.ai/api/chat/gifs${qs}`))).json()

beforeEach(() => {
  h.rows = [row('https://static.klipy.com/a.gif')]
  h.configured.mockReturnValue(true)
  h.name.mockReturnValue('klipy')
  h.search.mockReset()
})

describe('/api/chat/gifs attribution', () => {
  it('names the service behind the preloaded grid from its URLs, and the one a search asks', async () => {
    expect(await get()).toMatchObject({ provider: 'klipy', searchProvider: 'klipy' })
    h.rows = [row('https://media.giphy.com/a.gif')]
    h.name.mockReturnValue(null)
    expect(await get()).toMatchObject({ provider: 'giphy', searchProvider: null })
  })

  it('names the service that answered a live search', async () => {
    h.search.mockResolvedValue([{ id: 'x', url: 'https://static.klipy.com/x.gif', provider: 'klipy' }])
    expect(await get('?q=touchdown')).toMatchObject({ provider: 'klipy', searchProvider: 'klipy' })
  })

  it('falls back to the local table with its own attribution when the live search finds nothing', async () => {
    h.search.mockResolvedValue([])
    expect(await get('?q=touchdown')).toMatchObject({ provider: 'klipy', gifs: [expect.objectContaining({ url: 'https://static.klipy.com/a.gif' })] })
    h.rows = []
    expect(await get('?q=nothing')).toMatchObject({ provider: null, gifs: [] })
  })
})
