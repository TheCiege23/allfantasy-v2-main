/**
 * `weather/refresh-cron` must stop before the platform edge does.
 *
 * WHAT HAPPENED
 * Measured 2026-08-23 at 18:04 UTC: HTTP 502 at 300,084ms. The route declares `maxDuration = 60`.
 *
 * ⚠ THE DECLARATION IS NOT A CONTROL ON THIS HOST. `maxDuration` is a Vercel primitive; production
 * runs on Railway, which does not enforce it. That is not a theory — this route ran FIVE TIMES its
 * own declared limit before the platform edge severed the connection at 300s and answered 502
 * itself. Every `maxDuration` in the repo is currently a statement of intent, nothing more.
 *
 * So the wall-clock budget is the real control, and it is set BELOW the declared maxDuration on
 * purpose: 45s is under Railway's 300s edge today AND under the 60s Vercel would enforce if
 * production moves back. A 240s budget would pass on Railway and 504 on Vercel — correct only on
 * the host you happened to test.
 *
 * WHAT IS PINNED
 *   1. The budget stops the loop.
 *   2. Deferred games are COUNTED. "Refreshed 12" from a truncated run and "refreshed 12" from a
 *      run that found only 12 to do are otherwise identical numbers.
 *   3. The budget is below maxDuration, so one number is right on both hosts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { findManyMock, findUniqueMock, getWeatherMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  findUniqueMock: vi.fn(async () => null),
  getWeatherMock: vi.fn(async () => ({ cacheHit: false })),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsGame: { findMany: findManyMock },
    weatherCache: { findUnique: findUniqueMock },
  },
}))
vi.mock('@/lib/weather/weatherService', () => ({
  getWeatherForEvent: getWeatherMock,
  MLB_VENUE_COORDS: { 'Test Park': { lat: 1, lng: 2 } },
  /*
   * ⚠ THE REAL BUILDER, NOT A STUB. The cron used to invent its own key format
   * — `lat_lng_hour`, underscores — which matched none of the four builders in
   * this module, so its cache lookup could never hit and every game was
   * refetched on every run. Mocking this with a fake would hide a repeat of
   * exactly that: the point is that the route and the writer agree.
   */
  buildWeatherGameCacheKey: (sport: string, gameId: string) =>
    `weather:game:${sport.toLowerCase()}:${gameId}`,
}))
vi.mock('@/lib/openweathermap', () => ({
  NFL_VENUE_COORDS: { 'Test Park': { lat: 1, lng: 2 } },
}))
vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))

/** Games inside 48h, so every one is force-refreshed and hits the expensive path. */
function games(n: number) {
  const soon = Date.now() + 60 * 60 * 1000
  return Array.from({ length: n }, (_, i) => ({
    externalId: `g${i}`,
    sport: 'NFL',
    venue: 'Test Park',
    startTime: new Date(soon + i * 1000),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  findUniqueMock.mockResolvedValue(null)
  getWeatherMock.mockResolvedValue({ cacheHit: false })
})

describe('weather refresh budget', () => {
  it('stops refreshing once the budget is spent and reports what it skipped', async () => {
    const { GET } = await import('@/app/api/weather/refresh-cron/route')
    findManyMock.mockResolvedValue(games(120))

    // Each weather call burns 5s of wall clock against a 45s budget.
    let t = Date.now()
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => t)
    getWeatherMock.mockImplementation(async () => {
      t += 5_000
      return { cacheHit: false }
    })

    const res = await GET(new Request('http://localhost/api/weather/refresh-cron') as never)
    const body = await res.json()
    spy.mockRestore()

    expect(body.ok).toBe(true)
    // The 502 came from never stopping. Stopping is the fix; saying so is the other half.
    expect(body.deferred).toBeGreaterThan(0)
    expect(body.refreshed).toBeLessThan(120)
    expect(body.refreshed + body.deferred).toBe(120)
    expect(body.budgetExhausted).toBe(true)
  })

  it('refreshes everything when the work fits, and defers nothing', async () => {
    const { GET } = await import('@/app/api/weather/refresh-cron/route')
    findManyMock.mockResolvedValue(games(5))

    const res = await GET(new Request('http://localhost/api/weather/refresh-cron') as never)
    const body = await res.json()

    expect(body.refreshed).toBe(5)
    expect(body.deferred).toBe(0)
    expect(body.budgetExhausted).toBe(false)
  })

  it('keeps the budget below the declared maxDuration, so it holds on both hosts', async () => {
    const mod = await import('@/app/api/weather/refresh-cron/route')
    // Railway ignores maxDuration (this route ran 300s against a declared 60s), but Vercel would
    // enforce it. A budget above it would never engage there — green here, 504 there.
    expect(mod.maxDuration * 1000).toBeGreaterThan(mod.WEATHER_REFRESH_BUDGET_MS)
  })

  it('⚠ SKIPS a game whose cached forecast is still fresh', async () => {
    /*
     * THE BUG THIS EXISTS FOR. The freshness gate built its key as
     * `lat_lng_hour` while every writer used `weather:game:{sport}:{eventId}`,
     * so findUnique could never hit, `stale` was always true, and
     * `if (!force) continue` was unreachable. Combined with an unconditional
     * `forceRefresh: true` — which bypasses the cache check inside the service
     * as well — every game in the window hit the provider every three hours.
     */
    const fresh = new Date()
    findUniqueMock.mockResolvedValue({
      cacheKey: 'weather:game:nfl:g0',
      // Comfortably unexpired and fetched moments ago.
      expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
      fetchedAt: fresh,
    })
    // Far enough out that proximity to kickoff is not a reason to refresh.
    findManyMock.mockResolvedValue([
      {
        externalId: 'g0',
        sport: 'NFL',
        venue: 'Test Park',
        startTime: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      },
    ])

    const { GET } = await import('@/app/api/weather/refresh-cron/route')
    const res = await GET(new Request('http://localhost/api/weather/refresh-cron') as never)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.refreshed).toBe(0)
    expect(body.skipped).toBe(1)
    // The whole point: no provider call at all.
    expect(getWeatherMock).not.toHaveBeenCalled()
  })

  it('still refreshes a fresh row when kickoff is close, because the forecast moves', async () => {
    findUniqueMock.mockResolvedValue({
      cacheKey: 'weather:game:nfl:g0',
      expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
      fetchedAt: new Date(),
    })
    findManyMock.mockResolvedValue([
      {
        externalId: 'g0',
        sport: 'NFL',
        venue: 'Test Park',
        startTime: new Date(Date.now() + 60 * 60 * 1000),
      },
    ])

    const { GET } = await import('@/app/api/weather/refresh-cron/route')
    const res = await GET(new Request('http://localhost/api/weather/refresh-cron') as never)
    const body = await res.json()
    expect(body.refreshed).toBe(1)
    expect(getWeatherMock).toHaveBeenCalled()
  })

  it('⚠ does NOT force past the service cache unless the row is genuinely stale', async () => {
    // Near kickoff with a fresh row: call it, but let the service's own cache
    // answer. `forceRefresh: true` there means a paid provider request.
    findUniqueMock.mockResolvedValue({
      cacheKey: 'weather:game:nfl:g0',
      expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
      fetchedAt: new Date(),
    })
    findManyMock.mockResolvedValue([
      {
        externalId: 'g0',
        sport: 'NFL',
        venue: 'Test Park',
        startTime: new Date(Date.now() + 60 * 60 * 1000),
      },
    ])

    const { GET } = await import('@/app/api/weather/refresh-cron/route')
    await GET(new Request('http://localhost/api/weather/refresh-cron') as never)
    expect(getWeatherMock.mock.calls[0][0].forceRefresh).toBe(false)
  })
})
