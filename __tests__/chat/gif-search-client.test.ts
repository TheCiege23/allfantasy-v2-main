import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isAllowedGifUrl } from '@/lib/rich-message/GIFIntegrationResolver'
import {
  fetchGifs,
  gifSearchPlaceholder,
  loadGifSearchProvider,
  resetGifSearchProviderCacheForTests,
} from '@/lib/rich-message/gifSearchClient'

/**
 * GIF search from the browser goes through our server route — never to a GIF service directly —
 * and brings back who answered, so each picker can credit them.
 */

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

beforeEach(() => resetGifSearchProviderCacheForTests())
afterEach(() => vi.unstubAllGlobals())

describe('fetchGifs', () => {
  it('asks /api/chat/gifs — the grid when empty, a search otherwise', async () => {
    const f = vi.fn(async () => json({ gifs: [], provider: null, searchProvider: 'klipy' }))
    vi.stubGlobal('fetch', f)
    await fetchGifs('', 24)
    await fetchGifs('  touchdown  ', 16)
    expect(f.mock.calls.map((c) => String((c as unknown[])[0]))).toEqual([
      '/api/chat/gifs?limit=24',
      '/api/chat/gifs?limit=16&q=touchdown',
    ])
  })

  it('credits each GIF by its own host, falls back to the route’s provider, and drops anything unnamed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          provider: 'klipy',
          searchProvider: 'klipy',
          gifs: [
            { id: 'a', url: 'https://static.klipy.com/a.gif', previewUrl: 'https://static.klipy.com/a-s.gif', title: 'td' },
            { id: 'b', url: 'https://media.giphy.com/b.gif' },
            { id: 'c', url: 'https://cdn.unknown.test/c.gif' },
            { id: '', url: 'https://static.klipy.com/x.gif' },
            { id: 'd' },
          ],
        }),
      ),
    )
    const r = await fetchGifs('td')
    expect(r.gifs).toEqual([
      { id: 'a', url: 'https://static.klipy.com/a.gif', previewUrl: 'https://static.klipy.com/a-s.gif', title: 'td', provider: 'klipy' },
      { id: 'b', url: 'https://media.giphy.com/b.gif', previewUrl: 'https://media.giphy.com/b.gif', title: '', provider: 'giphy' },
      { id: 'c', url: 'https://cdn.unknown.test/c.gif', previewUrl: 'https://cdn.unknown.test/c.gif', title: '', provider: 'klipy' },
    ])
    expect(r).toMatchObject({ provider: 'klipy', searchProvider: 'klipy' })
  })

  it('never throws — a failed read is no GIFs and no provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await fetchGifs('td')).toEqual({ gifs: [], provider: null, searchProvider: null })
  })
})

describe('loadGifSearchProvider', () => {
  it('asks once per page', async () => {
    const f = vi.fn(async () => json({ gifs: [{ id: 'a', url: 'https://static.klipy.com/a.gif' }], searchProvider: 'klipy' }))
    vi.stubGlobal('fetch', f)
    expect(await loadGifSearchProvider()).toBe('klipy')
    expect(await loadGifSearchProvider()).toBe('klipy')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('retries after a failed read instead of remembering "none"', async () => {
    const f = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(json({ gifs: [], searchProvider: 'klipy' }))
    vi.stubGlobal('fetch', f)
    expect(await loadGifSearchProvider()).toBeNull()
    expect(await loadGifSearchProvider()).toBe('klipy')
  })
})

describe('the search box and the stored link', () => {
  it('says "Search KLIPY" exactly, as Klipy’s terms ask', () => {
    expect(gifSearchPlaceholder('klipy')).toBe('Search KLIPY')
    expect(gifSearchPlaceholder('giphy')).toBe('Search GIPHY')
    expect(gifSearchPlaceholder(null)).toBe('Search GIFs...')
  })

  it('accepts only https links from a GIF service it can name — by host, not substring', () => {
    expect(isAllowedGifUrl('https://static.klipy.com/a.gif')).toBe(true)
    expect(isAllowedGifUrl('https://media3.giphy.com/media/x/giphy.gif')).toBe(true)
    expect(isAllowedGifUrl('https://media.tenor.com/old.gif')).toBe(true)
    expect(isAllowedGifUrl('http://static.klipy.com/a.gif')).toBe(false)
    expect(isAllowedGifUrl('https://klipy.com.evil.test/a.gif')).toBe(false)
    expect(isAllowedGifUrl('https://evilmedia.test/pixel.gif')).toBe(false)
    expect(isAllowedGifUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedGifUrl('')).toBe(false)
    expect(isAllowedGifUrl(null)).toBe(false)
  })
})
