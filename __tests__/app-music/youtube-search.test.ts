import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))

// The DB counter: a real little store, so the limits are tested by behaviour, not by mock calls.
const counters = new Map<string, number>()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    apiRateLimitRecord: {
      upsert: vi.fn(async ({ where }: { where: { uniq_api_rate_limits_window: { endpoint: string } } }) => {
        const key = where.uniq_api_rate_limits_window.endpoint
        const next = (counters.get(key) ?? 0) + 1
        counters.set(key, next)
        return { callsMade: next }
      }),
      updateMany: vi.fn(async ({ where }: { where: { endpoint: string } }) => {
        const n = counters.get(where.endpoint) ?? 0
        if (n > 0) counters.set(where.endpoint, n - 1)
        return { count: n > 0 ? 1 : 0 }
      }),
    },
  },
}))

// The cache: also real, in memory, honouring shouldCache.
const cache = new Map<string, unknown>()
vi.mock('@/lib/api-cache', () => ({
  cachedFetch: vi.fn(
    async <T,>(key: string, _ttl: number, fetcher: () => Promise<T>, shouldCache: (d: T) => boolean = () => true) => {
      if (cache.has(key)) return cache.get(key) as T
      const data = await fetcher()
      if (shouldCache(data)) cache.set(key, data)
      return data
    },
  ),
}))

import {
  APP_DAILY,
  PER_USER_DAILY,
  decodeEntities,
  normalizeMusicQuery,
  parseSearchResponse,
  searchYouTubeMusic,
  userBudgetKey,
} from '@/lib/app-music/youtubeSearch'

const okBody = (ids: string[]) => ({
  items: ids.map((id) => ({
    id: { kind: 'youtube#video', videoId: id },
    snippet: {
      title: `Song &amp; ${id}`,
      channelTitle: 'Artist',
      liveBroadcastContent: 'none',
      thumbnails: { medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` } },
    },
  })),
})

const fetchMock = vi.fn()

beforeEach(() => {
  counters.clear()
  cache.clear()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(okBody(['aaaaaaaaaaa'])), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('YOUTUBE_API_KEY', 'test-key')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('normalizeMusicQuery', () => {
  it('folds case and spacing so near-identical searches share one cache row', () => {
    expect(normalizeMusicQuery('  Game   DAY  hype ')).toBe('game day hype')
  })
  it('refuses a one-letter search and caps length', () => {
    expect(normalizeMusicQuery(' a ')).toBeNull()
    expect(normalizeMusicQuery('x'.repeat(200))).toHaveLength(80)
  })
})

describe('parseSearchResponse', () => {
  it('decodes titles and keeps only YouTube thumbnails', () => {
    const [hit] = parseSearchResponse(okBody(['bbbbbbbbbbb']))
    expect(hit).toEqual({
      videoId: 'bbbbbbbbbbb',
      title: 'Song & bbbbbbbbbbb',
      channel: 'Artist',
      thumb: 'https://i.ytimg.com/vi/bbbbbbbbbbb/mqdefault.jpg',
    })
  })
  it('drops channels, playlists, upcoming streams and malformed ids', () => {
    const hits = parseSearchResponse({
      items: [
        { id: { kind: 'youtube#channel' }, snippet: { title: 'A channel' } },
        { id: { videoId: 'ccccccccccc' }, snippet: { liveBroadcastContent: 'upcoming' } },
        { id: { videoId: 'dddddddddddd' } }, // 12 chars: not a video id
        { id: { videoId: 'eeeeeeeeeee' }, snippet: { thumbnails: { default: { url: 'https://evil.example/x.jpg' } } } },
      ],
    })
    expect(hits.map((h) => h.videoId)).toEqual([])
  })
  it('returns nothing for a body that is not a search response', () => {
    expect(parseSearchResponse({ error: { code: 403 } })).toEqual([])
    expect(parseSearchResponse(null)).toEqual([])
  })
  it('decodes numeric entities', () => {
    expect(decodeEntities('Don&#39;t Stop &#x1F525;')).toBe('Don\'t Stop 🔥')
  })
})

describe('searchYouTubeMusic — limits', () => {
  it('sends the key in a header, never in the URL', async () => {
    await searchYouTubeMusic('game day', 'u1')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).not.toContain('test-key')
    expect(String(url)).toContain('videoEmbeddable=true')
    expect((init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('test-key')
  })

  it('answers a repeated search from the cache without spending anything', async () => {
    const a = await searchYouTubeMusic('Game Day', 'u1')
    const b = await searchYouTubeMusic('  game   day', 'u2')
    expect(a).toEqual(b)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(counters.get('app')).toBe(1)
    expect(counters.get(userBudgetKey('u2'))).toBeUndefined()
  })

  it(`stops one person after ${PER_USER_DAILY} fresh searches, without touching the app budget`, async () => {
    for (let i = 0; i < PER_USER_DAILY; i++) {
      expect((await searchYouTubeMusic(`song ${i}`, 'u1')).status).toBe('ok')
    }
    expect(await searchYouTubeMusic('one more', 'u1')).toEqual({ status: 'limit', scope: 'user' })
    expect(counters.get(userBudgetKey('u1'))).toBe(PER_USER_DAILY) // the refused one was handed back
    expect(counters.get('app')).toBe(PER_USER_DAILY)
    expect(fetchMock).toHaveBeenCalledTimes(PER_USER_DAILY)
    // …and a cached search still works for them.
    expect((await searchYouTubeMusic('song 0', 'u1')).status).toBe('ok')
  })

  it(`stops everyone after ${APP_DAILY} fresh searches, and gives the person their search back`, async () => {
    counters.set('app', APP_DAILY)
    expect(await searchYouTubeMusic('anything', 'u9')).toEqual({ status: 'limit', scope: 'app' })
    expect(counters.get('app')).toBe(APP_DAILY)
    expect(counters.get(userBudgetKey('u9'))).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats YouTube’s own quota refusal as the app limit and does not cache it', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 403 }))
    expect(await searchYouTubeMusic('quota', 'u1')).toEqual({ status: 'limit', scope: 'app' })
    expect(cache.size).toBe(0)
    expect(counters.get(userBudgetKey('u1'))).toBe(0)
  })

  it('does not remember an empty answer for a day', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ items: [] }), { status: 200 }))
    expect(await searchYouTubeMusic('nothing here', 'u1')).toEqual({ status: 'ok', results: [] })
    expect(cache.size).toBe(0)
  })

  it('fails closed when the budget cannot be read', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.apiRateLimitRecord.upsert).mockRejectedValueOnce(new Error('db down'))
    expect(await searchYouTubeMusic('db down', 'u1')).toEqual({ status: 'unavailable' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says unavailable, spending nothing, when no key is configured', async () => {
    vi.stubEnv('YOUTUBE_API_KEY', '')
    expect(await searchYouTubeMusic('no key', 'u1')).toEqual({ status: 'unavailable' })
    expect(counters.size).toBe(0)
  })

  it('never puts the raw user id in the counter table', () => {
    expect(userBudgetKey('user-123')).not.toContain('user-123')
    expect(userBudgetKey('user-123').length).toBeLessThanOrEqual(128)
  })
})
