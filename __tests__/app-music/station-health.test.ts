import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  STALE_AFTER_DAYS,
  checkStations,
  needsAttention,
  summarize,
  youtubeGet,
  type YouTubeGet,
} from '@/lib/app-music/stationHealth'
import { YOUTUBE_STATIONS, type YouTubeStation } from '@/lib/draft-music/youtube'

const NOW = new Date('2026-11-16T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

const pl = (id: string, listId: string): YouTubeStation => ({ id, label: id, channel: 'c', source: { kind: 'playlist', listId } })
const vid = (id: string, videoId: string): YouTubeStation => ({ id, label: id, channel: 'c', source: { kind: 'video', videoId } })

/** A fake YouTube: playlists map to items, videos map to status; anything else 404s. */
function fakeYouTube(opts: {
  playlists?: Record<string, { status?: number; items?: { videoId: string; at: string }[] }>
  videos?: Record<string, { embeddable?: boolean }>
  videosStatus?: number
}) {
  const calls: { endpoint: string; params: Record<string, string> }[] = []
  const get: YouTubeGet = async (endpoint, params) => {
    calls.push({ endpoint, params })
    if (endpoint === 'playlistItems') {
      const p = opts.playlists?.[params.playlistId]
      if (!p) return { status: 404, json: { error: { code: 404 } } }
      if (p.status && p.status !== 200) return { status: p.status, json: {} }
      return {
        status: 200,
        json: { items: (p.items ?? []).map((i) => ({ contentDetails: { videoId: i.videoId, videoPublishedAt: i.at } })) },
      }
    }
    if (opts.videosStatus && opts.videosStatus !== 200) return { status: opts.videosStatus, json: {} }
    const ids = params.id.split(',')
    return {
      status: 200,
      json: { items: ids.filter((id) => opts.videos?.[id]).map((id) => ({ id, status: opts.videos![id] })) },
    }
  }
  return { get, calls }
}

describe('checkStations', () => {
  it('passes a podcast whose newest episode is inside its window, using the NEWEST of the list', async () => {
    const { get } = fakeYouTube({
      playlists: {
        UULFnfl: { items: [{ videoId: 'old', at: daysAgo(90) }, { videoId: 'new', at: daysAgo(3) }] },
      },
      videos: { new: { embeddable: true } },
    })
    const [c] = await checkStations(get, [pl('ff-podcast', 'UULFnfl')], NOW)
    expect(c).toMatchObject({ status: 'ok', ageDays: 3 })
  })

  it('flags a podcast that has gone quiet past its window', async () => {
    const { get } = fakeYouTube({
      playlists: { UULFq: { items: [{ videoId: 'v', at: daysAgo(STALE_AFTER_DAYS['ff-podcast'] + 1) }] } },
      videos: { v: { embeddable: true } },
    })
    const [c] = await checkStations(get, [pl('ff-podcast', 'UULFq')], NOW)
    expect(c.status).toBe('stale')
    expect(c.detail).toMatch(/Nothing new in \d+ days/)
  })

  it('gives seasonal sports a longer window, so an off-season is not an alarm', async () => {
    const { get } = fakeYouTube({
      playlists: { UULFc: { items: [{ videoId: 'v', at: daysAgo(150) }] } },
      videos: { v: { embeddable: true } },
    })
    const [c] = await checkStations(get, [pl('cricket-podcast', 'UULFc')], NOW)
    expect(c.status).toBe('ok')
  })

  it('never judges a music playlist on age', async () => {
    const { get } = fakeYouTube({
      playlists: { PLhits: { items: [{ videoId: 'v', at: daysAgo(900) }] } },
      videos: { v: { embeddable: true } },
    })
    const [c] = await checkStations(get, [pl('hiphop-hype', 'PLhits')], NOW)
    expect(c.status).toBe('ok')
  })

  it('reports a YouTube Music list the API cannot read as UNCHECKED, but any other missing list as BROKEN', async () => {
    const { get } = fakeYouTube({})
    const checks = await checkStations(get, [pl('rock', 'RDCLAK5uy_abc'), pl('gone', 'PLgone')], NOW)
    expect(checks.map((c) => c.status)).toEqual(['unchecked', 'broken'])
    expect(needsAttention(checks).map((c) => c.id)).toEqual(['gone'])
  })

  it('flags an empty playlist', async () => {
    const { get } = fakeYouTube({ playlists: { PLempty: { items: [] } } })
    const [c] = await checkStations(get, [pl('x', 'PLempty')], NOW)
    expect(c.status).toBe('broken')
  })

  it('flags a playlist whose newest video no longer plays outside YouTube, or is gone', async () => {
    const { get } = fakeYouTube({
      playlists: {
        PLa: { items: [{ videoId: 'blocked', at: daysAgo(1) }] },
        PLb: { items: [{ videoId: 'deleted', at: daysAgo(1) }] },
      },
      videos: { blocked: { embeddable: false } },
    })
    const checks = await checkStations(get, [pl('a', 'PLa'), pl('b', 'PLb')], NOW)
    expect(checks.map((c) => c.status)).toEqual(['broken', 'broken'])
    expect(checks[0].detail).toMatch(/no longer plays outside YouTube/)
    expect(checks[1].detail).toMatch(/gone/)
  })

  it('checks single-video stations too', async () => {
    const { get } = fakeYouTube({ videos: { live: { embeddable: true } } })
    const checks = await checkStations(get, [vid('lofi', 'live'), vid('dead', 'missing')], NOW)
    expect(checks.map((c) => c.status)).toEqual(['ok', 'broken'])
  })

  it('makes ONE video lookup for every station together (quota)', async () => {
    const { get, calls } = fakeYouTube({
      playlists: {
        PL1: { items: [{ videoId: 'a', at: daysAgo(1) }] },
        PL2: { items: [{ videoId: 'b', at: daysAgo(1) }] },
      },
      videos: { a: { embeddable: true }, b: { embeddable: true }, c: { embeddable: true } },
    })
    await checkStations(get, [pl('x', 'PL1'), pl('y', 'PL2'), vid('z', 'c')], NOW)
    expect(calls.filter((c) => c.endpoint === 'videos')).toHaveLength(1)
    expect(calls.filter((c) => c.endpoint === 'playlistItems')).toHaveLength(2)
  })

  it('never calls a station broken because YouTube refused or the video lookup failed', async () => {
    const quota = fakeYouTube({ playlists: { PLq: { status: 403 } } })
    expect((await checkStations(quota.get, [pl('x', 'PLq')], NOW))[0].status).toBe('unchecked')

    const lookupDown = fakeYouTube({
      playlists: { PLok: { items: [{ videoId: 'v', at: daysAgo(1) }] } },
      videosStatus: 500,
    })
    expect((await checkStations(lookupDown.get, [pl('x', 'PLok')], NOW))[0].status).toBe('ok')

    const thrown: YouTubeGet = async () => {
      throw new Error('network')
    }
    expect((await checkStations(thrown, [pl('x', 'PLz')], NOW))[0].status).toBe('unchecked')
  })

  it('summarizes by status', async () => {
    const { get } = fakeYouTube({})
    const checks = await checkStations(get, [pl('rock', 'RDCLAK5uy_x'), pl('gone', 'PLgone')], NOW)
    expect(summarize(checks)).toEqual({ ok: 0, stale: 0, broken: 1, unchecked: 1 })
  })
})

describe('station rules', () => {
  it('gives every podcast station a staleness window (a new podcast must choose one)', () => {
    const podcasts = YOUTUBE_STATIONS.filter((s) => s.id.endsWith('-podcast')).map((s) => s.id)
    expect(podcasts.length).toBeGreaterThan(5)
    expect(podcasts.filter((id) => STALE_AFTER_DAYS[id] === undefined)).toEqual([])
  })
})

describe('youtubeGet', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the key in a header, never in the URL', async () => {
    const fetchMock = vi.fn(async () => new Response('{"items":[]}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await youtubeGet('secret-key')('playlistItems', { playlistId: 'PLx' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).not.toContain('secret-key')
    expect((init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('secret-key')
  })
})
