// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

/*
 * Security cleanup (2026-11-15): request paths stop calling vendors inline.
 *   - /api/music/*: TheAudioDB's v1 key is a URL path segment. The URL is now built in ONE adapter
 *     (lib/music/theAudioDbFetch.ts), never returned or thrown, and read through a 30-day durable cache.
 *   - /api/league/live-roster: every viewer polled Sleeper every 20s, uncached. Now a short shared cache
 *     (rosters 60s, picks 10s, one in-flight call per key, failures never cached).
 */

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

describe('the TheAudioDB adapter never lets its key out', () => {
  const SECRET = 'sekret-premium-key-123'
  beforeEach(() => {
    vi.resetModules()
    process.env.THEAUDIODB_API_KEY = SECRET
  })
  afterEach(() => {
    delete process.env.THEAUDIODB_API_KEY
    vi.unstubAllGlobals()
  })

  it('uses the key in the URL it fetches, and returns only the data', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ artists: [{ idArtist: '1', strArtist: 'Queen' }] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchAudioDbArtists } = await import('@/lib/music/theAudioDbFetch')
    const out = await fetchAudioDbArtists('Queen')
    expect(out).toEqual([{ idArtist: '1', strArtist: 'Queen' }])
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain(`/json/${SECRET}/search.php?s=Queen`)
    expect(JSON.stringify(out)).not.toContain(SECRET)
  })

  it('🛑 every failure is a bare null — no message that could carry the URL', async () => {
    const { fetchAudioDbArtists, fetchAudioDbTopTracks } = await import('@/lib/music/theAudioDbFetch')
    // An error that carries the key in its message, as a fetch error carrying the URL would.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError(`fetch failed for /api/v1/json/${SECRET}/x`) }))
    await expect(fetchAudioDbArtists('Queen')).resolves.toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })))
    await expect(fetchAudioDbTopTracks('Queen')).resolves.toBeNull()
  })
})

describe('the music catalog reads through the durable cache', () => {
  const NOW = new Date('2026-11-15T12:00:00Z')
  const DAY = 86_400_000
  const fetchers = vi.hoisted(() => ({ artists: vi.fn(), top10: vi.fn() }))
  beforeEach(() => {
    vi.resetModules()
    fetchers.artists.mockReset()
    fetchers.top10.mockReset()
    vi.doMock('@/lib/music/theAudioDbFetch', () => ({ fetchAudioDbArtists: fetchers.artists, fetchAudioDbTopTracks: fetchers.top10 }))
  })
  const db = (row: { data: unknown; expiresAt: Date } | null) => ({
    sportsDataCache: { findUnique: vi.fn(async () => row), upsert: vi.fn(async () => ({})) },
  })

  it('a fresh cached answer costs no vendor call', async () => {
    const { searchArtistsCached } = await import('@/lib/music/musicCatalog')
    const d = db({ data: [{ strArtist: 'Queen' }], expiresAt: new Date(NOW.getTime() + DAY) })
    expect(await searchArtistsCached('Queen', { db: d as never, now: NOW })).toEqual([{ strArtist: 'Queen' }])
    expect(fetchers.artists).not.toHaveBeenCalled()
  })

  it('a miss fetches once and keeps a found answer 30 days, an empty one 1 day', async () => {
    const { searchArtistsCached, topTracksCached, musicCacheKey } = await import('@/lib/music/musicCatalog')
    fetchers.artists.mockResolvedValue([{ strArtist: 'Queen' }])
    const d1 = db(null)
    await searchArtistsCached('  Queen ', { db: d1 as never, now: NOW })
    const up1 = (d1.sportsDataCache.upsert.mock.calls[0] as unknown as [{ where: { cacheKey: string }; create: { expiresAt: Date } }])[0]
    expect(up1.where.cacheKey).toBe(musicCacheKey('artists', 'queen'))
    expect(up1.create.expiresAt.getTime() - NOW.getTime()).toBe(30 * DAY)
    fetchers.top10.mockResolvedValue([])
    const d2 = db(null)
    await topTracksCached('Nobody', { db: d2 as never, now: NOW })
    const up2 = (d2.sportsDataCache.upsert.mock.calls[0] as unknown as [{ create: { expiresAt: Date } }])[0]
    expect(up2.create.expiresAt.getTime() - NOW.getTime()).toBe(DAY)
  })

  it('🛑 a failure is never cached; a stale answer beats nothing', async () => {
    const { searchArtistsCached } = await import('@/lib/music/musicCatalog')
    fetchers.artists.mockResolvedValue(null)
    const empty = db(null)
    expect(await searchArtistsCached('Queen', { db: empty as never, now: NOW })).toBeNull()
    expect(empty.sportsDataCache.upsert).not.toHaveBeenCalled()
    const stale = db({ data: [{ strArtist: 'Queen' }], expiresAt: new Date(NOW.getTime() - DAY) })
    expect(await searchArtistsCached('Queen', { db: stale as never, now: NOW })).toEqual([{ strArtist: 'Queen' }])
    expect(stale.sportsDataCache.upsert).not.toHaveBeenCalled()
  })
})

describe('the live roster feed is shared and short-lived', () => {
  beforeEach(() => vi.resetModules())

  it('every viewer of a league inside a minute shares one Sleeper call', async () => {
    const { liveLeagueRosters, resetLiveLeagueFeed } = await import('@/lib/sleeper/liveLeagueFeed')
    resetLiveLeagueFeed()
    let t = 0
    const fetcher = vi.fn(async () => [{ roster_id: 1, owner_id: 'u' }]) as never
    await liveLeagueRosters('123', { fetcher, now: () => t })
    t = 59_000
    await liveLeagueRosters('123', { fetcher, now: () => t })
    expect((fetcher as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1)
    t = 61_000
    await liveLeagueRosters('123', { fetcher, now: () => t })
    expect((fetcher as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2)
  })

  it('draft picks refresh inside the panel’s 20s poll', async () => {
    const { liveDraftPicks, resetLiveLeagueFeed, PICKS_TTL_MS } = await import('@/lib/sleeper/liveLeagueFeed')
    resetLiveLeagueFeed()
    expect(PICKS_TTL_MS).toBeLessThan(20_000)
    let t = 0
    const fetcher = vi.fn(async () => []) as never
    await liveDraftPicks('d1', { fetcher, now: () => t })
    t = PICKS_TTL_MS + 1
    await liveDraftPicks('d1', { fetcher, now: () => t })
    expect((fetcher as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2)
  })

  it('concurrent requests share one in-flight call; a failure is not cached; a bad id never reaches Sleeper', async () => {
    const { liveLeagueDrafts, resetLiveLeagueFeed } = await import('@/lib/sleeper/liveLeagueFeed')
    resetLiveLeagueFeed()
    let release!: (v: unknown) => void
    const slow = vi.fn(() => new Promise((r) => { release = r })) as never
    const a = liveLeagueDrafts('L9', { fetcher: slow })
    const b = liveLeagueDrafts('L9', { fetcher: slow })
    release([{ draft_id: 'd', status: 'drafting' }])
    expect(await a).toEqual(await b)
    expect((slow as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1)

    resetLiveLeagueFeed()
    const failing = vi.fn(async () => null) as never
    await liveLeagueDrafts('L9', { fetcher: failing })
    await liveLeagueDrafts('L9', { fetcher: failing })
    expect((failing as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2)

    const never = vi.fn() as never
    expect(await liveLeagueDrafts('../../etc', { fetcher: never })).toBeNull()
    expect((never as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0)
  })
})

describe('the request paths no longer build vendor URLs', () => {
  it('the music routes read the catalog, and never see the key', () => {
    for (const p of ['app/api/music/artists/route.ts', 'app/api/music/track-info/route.ts']) {
      const src = readFileSync(p, 'utf8')
      expect(src).not.toMatch(/https:\/\/www\.theaudiodb\.com/)
      expect(src).not.toMatch(/getTheAudioDbApiKey/)
      expect(src).toMatch(/from '@\/lib\/music\/musicCatalog'/)
    }
  })

  it('the live roster route reads the shared feed', () => {
    const src = readFileSync('app/api/league/live-roster/route.ts', 'utf8')
    expect(src).not.toMatch(/api\.sleeper\.app/)
    expect(src).toMatch(/from '@\/lib\/sleeper\/liveLeagueFeed'/)
  })

  it('each adapter is allowlisted by exact path, and nothing broader', () => {
    const guard = readFileSync('scripts/check-db-first-api-boundary.mjs', 'utf8')
    expect(guard).toContain(String.raw`/^lib\/music\/theAudioDbFetch\.ts$/`)
    expect(guard).toContain(String.raw`/^lib\/sleeper\/liveLeagueFetch\.ts$/`)
    expect(guard).not.toMatch(/\^lib\\\/music\\\/\.\*/)
  })
})
