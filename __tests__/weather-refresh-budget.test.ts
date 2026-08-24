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
})
