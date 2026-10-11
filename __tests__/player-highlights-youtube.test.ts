import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-cache', () => ({ cachedFetch: vi.fn(async (_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()) }))
const id = 'abcdefghijk'
const resource = (over: Record<string, unknown> = {}) => ({
  id, snippet: { title: 'Josh Allen highlights', channelTitle: 'NFL', channelId: 'official', publishedAt: new Date().toISOString(), liveBroadcastContent: 'none' },
  status: { embeddable: true, privacyStatus: 'public', uploadStatus: 'processed' }, contentDetails: {}, ...over,
})
const response = (body: unknown) => ({ ok: true, json: async () => body })
beforeEach(() => { vi.resetModules(); vi.stubEnv('YOUTUBE_API_KEY', 'test-youtube-key') })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('official NFL YouTube catalog', () => {
  it('resolves the official handle, checks embeddability, and shares a feed across players', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ items: [{ id: 'official', contentDetails: { relatedPlaylists: { uploads: 'uploads' } } }] }))
      .mockResolvedValueOnce(response({ items: [{ contentDetails: { videoId: id } }] }))
      .mockResolvedValueOnce(response({ items: [resource()] }))
    vi.stubGlobal('fetch', fetcher)
    const { getPlayerHighlights } = await import('@/lib/highlights/youtube')
    const first = await getPlayerHighlights({ sport: 'NFL', name: 'Josh Allen', team: 'BUF' })
    expect(first.videos[0]?.videoId).toBe(id)
    await getPlayerHighlights({ sport: 'NFL', name: 'Jahmyr Gibbs', team: 'DET' })
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('forHandle')).toBe('@NFL')
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).not.toContain('test-youtube-key')
      expect(String(url)).not.toContain('/search')
      expect(init.headers['X-Goog-Api-Key']).toBe('test-youtube-key')
    }
  })
  it('excludes private, restricted, and non-embeddable videos', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ items: [{ id: 'official', contentDetails: { relatedPlaylists: { uploads: 'uploads' } } }] }))
      .mockResolvedValueOnce(response({ items: [{ contentDetails: { videoId: id } }] }))
      .mockResolvedValueOnce(response({ items: [
        resource({ status: { embeddable: false, privacyStatus: 'public', uploadStatus: 'processed' } }),
        resource({ status: { embeddable: true, privacyStatus: 'private', uploadStatus: 'processed' } }),
        resource({ contentDetails: { regionRestriction: { blocked: ['US'] } } }),
        resource({ snippet: { title: 'Josh Allen highlights', channelTitle: 'Fake NFL', channelId: 'unapproved', publishedAt: new Date().toISOString(), liveBroadcastContent: 'none' } }),
        resource({ snippet: { title: 'Josh Allen highlights', channelTitle: 'NFL', channelId: 'official', publishedAt: '2000-01-01T00:00:00Z', liveBroadcastContent: 'none' } }),
      ] }))
    vi.stubGlobal('fetch', fetcher)
    const { getPlayerHighlights } = await import('@/lib/highlights/youtube')
    const out = await getPlayerHighlights({ sport: 'NFL', name: 'Josh Allen', team: 'BUF' })
    expect(out.status).toBe('ready')
    expect(out.videos).toEqual([])
  })
  it('coalesces simultaneous requests for different players into one provider refresh', async () => {
    let release!: (value: unknown) => void
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
      .mockResolvedValueOnce(response({ items: [{ contentDetails: { videoId: id } }] }))
      .mockResolvedValueOnce(response({ items: [resource()] }))
    vi.stubGlobal('fetch', fetcher)
    const { getPlayerHighlights } = await import('@/lib/highlights/youtube')
    const first = getPlayerHighlights({ sport: 'NFL', name: 'Josh Allen', team: 'BUF' })
    const second = getPlayerHighlights({ sport: 'NFL', name: 'Jahmyr Gibbs', team: 'DET' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    release(response({ items: [{ id: 'official', contentDetails: { relatedPlaylists: { uploads: 'uploads' } } }] }))
    expect((await first).videos).toHaveLength(1)
    expect((await second).videos).toHaveLength(0)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('does not spend quota with no key or unsupported sport and cools down failures', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('Contains provider secrets'))
    vi.stubGlobal('fetch', fetcher)
    const { getPlayerHighlights } = await import('@/lib/highlights/youtube')
    expect((await getPlayerHighlights({ sport: 'NBA', name: 'Test', team: null })).status).toBe('unsupported')
    vi.stubEnv('YOUTUBE_API_KEY', '')
    expect((await getPlayerHighlights({ sport: 'NFL', name: 'Test', team: null })).status).toBe('unavailable')
    expect(fetcher).not.toHaveBeenCalled()
    vi.stubEnv('YOUTUBE_API_KEY', 'test')
    const out = await getPlayerHighlights({ sport: 'NFL', name: 'Test Player', team: null })
    expect(out.status).toBe('unavailable')
    expect(JSON.stringify(out)).not.toContain('secrets')
    await getPlayerHighlights({ sport: 'NFL', name: 'Another Player', team: null })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
