import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `weather/refresh-cron` must spend its 120-game window on games it can actually place.
 *
 * 🛑 WHAT HAPPENED. The query took the first 120 rows by kickoff across NFL, NCAAF, MLB and
 * SOCCER, and only then resolved coordinates. Measured 2026-09-29: every run from 01:06Z
 * answered `{"refreshed":0,"skipped":0,"deferred":0}` with HTTP 200 while `WeatherCache` went
 * stale. A run with nothing it could place read exactly like a run with nothing to do.
 *
 * ⚠ THE `findMany` MOCK HONOURS `take`. Without that, the old query's `take: 120` is invisible
 * to the suite and the first test passes against the bug it exists for.
 */

const rowsMock = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }))
const findManyMock = vi.hoisted(() =>
  vi.fn(async (args?: { take?: number }) => rowsMock.rows.slice(0, args?.take ?? rowsMock.rows.length)),
)
const findUniqueMock = vi.hoisted(() => vi.fn())
const getWeatherMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsGame: { findMany: findManyMock },
    weatherCache: { findUnique: findUniqueMock },
  },
}))
vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))
// Key builders stay REAL, as in weather-cron-consumer-key-agreement: the key is the contract.
vi.mock('@/lib/weather/weatherService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/weather/weatherService')>()
  return { ...actual, getWeatherForEvent: getWeatherMock }
})

import { buildWeatherCoordsCacheKey } from '@/lib/weather/weatherService'
import { resolveVenueForTeam } from '@/lib/weather/venueResolver'

const HOUR = 60 * 60 * 1000

function consumerKey(teamAbbrev: string, when: Date): string {
  const v = resolveVenueForTeam({ sport: 'NFL', teamAbbrev })
  if (v.kind !== 'coords') throw new Error(`no coords for ${teamAbbrev}`)
  return buildWeatherCoordsCacheKey(v.lat, v.lng, when)
}

async function run() {
  const { GET } = await import('@/app/api/weather/refresh-cron/route')
  const res = await GET({ url: 'http://localhost/api/weather/refresh-cron' } as never)
  return res.json()
}

function soccer(n: number, start: Date) {
  return Array.from({ length: n }, (_, i) => ({
    externalId: `s${i}`,
    sport: 'SOCCER',
    venue: `Estadio Numero ${i}`,
    homeTeam: 'XYZ',
    startTime: new Date(start.getTime() + i * 60_000),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  rowsMock.rows = []
  findUniqueMock.mockResolvedValue(null)
  getWeatherMock.mockResolvedValue({ cacheHit: false })
})

describe('weather refresh window', () => {
  it('🛑 reaches an NFL game behind 200 unplaceable rows', async () => {
    const kickoff = new Date(Date.now() + 50 * HOUR)
    rowsMock.rows = [
      ...soccer(200, new Date(Date.now() + HOUR)),
      { externalId: 'n1', sport: 'NFL', venue: 'Lambeau Field', homeTeam: 'GB', startTime: kickoff },
    ]

    const body = await run()

    expect(body.ok).toBe(true)
    expect(body.refreshed).toBe(1)
    expect(body.unresolved).toBe(200)
    expect(body.unresolvedBySport).toEqual({ SOCCER: 200 })
    expect(getWeatherMock.mock.calls[0]![0].cacheKey).toBe(consumerKey('GB', kickoff))
  })

  it('refreshes one game once when several sources store it', async () => {
    const kickoff = new Date(Date.now() + 30 * HOUR)
    rowsMock.rows = ['rolling_insights', 'thesportsdb', 'espn'].map((source) => ({
      externalId: `${source}-1`,
      sport: 'NFL',
      venue: 'Lambeau Field',
      homeTeam: 'GB',
      startTime: kickoff,
    }))

    const body = await run()

    expect(body.refreshed).toBe(1)
    expect(body.duplicates).toBe(2)
    expect(getWeatherMock).toHaveBeenCalledTimes(1)
  })

  it('places an NFL game with NO venue at the home team stadium', async () => {
    const kickoff = new Date(Date.now() + 30 * HOUR)
    rowsMock.rows = [{ externalId: 'n1', sport: 'NFL', venue: null, homeTeam: 'GB', startTime: kickoff }]

    const body = await run()

    expect(body.refreshed).toBe(1)
    expect(getWeatherMock.mock.calls[0]![0].cacheKey).toBe(consumerKey('GB', kickoff))
  })

  it('⚠ does NOT fall back to the home stadium when a named venue is unknown', async () => {
    // A neutral or international site. Forecasting Jacksonville for a London game would be a
    // confident wrong answer written where My Team reads it.
    rowsMock.rows = [
      {
        externalId: 'n1',
        sport: 'NFL',
        venue: 'Tottenham Hotspur Stadium',
        homeTeam: 'JAX',
        startTime: new Date(Date.now() + 30 * HOUR),
      },
    ]

    const body = await run()

    expect(body.refreshed).toBe(0)
    expect(body.unresolved).toBe(1)
    expect(getWeatherMock).not.toHaveBeenCalled()
    // Named, so the table can be fixed from what providers actually send.
    expect(body.unresolvedNflVenues).toEqual(['Tottenham Hotspur Stadium'])
  })

  it('places the Browns under their stadium name since 2024, on the key My Team reads', async () => {
    const kickoff = new Date(Date.now() + 30 * HOUR)
    rowsMock.rows = [
      { externalId: 'c1', sport: 'NFL', venue: 'Huntington Bank Field', homeTeam: 'CLE', startTime: kickoff },
    ]

    const body = await run()

    expect(body.refreshed).toBe(1)
    expect(body.unresolvedNflVenues).toEqual([])
    expect(getWeatherMock.mock.calls[0]![0].cacheKey).toBe(consumerKey('CLE', kickoff))
  })

  it('caps placeable games and reports the overflow', async () => {
    const { WEATHER_REFRESH_MAX_GAMES } = await import('@/app/api/weather/refresh-cron/route')
    const start = Date.now() + HOUR
    // One Lambeau game a day, so every row is its own coords/day key.
    rowsMock.rows = Array.from({ length: WEATHER_REFRESH_MAX_GAMES + 5 }, (_, i) => ({
      externalId: `n${i}`,
      sport: 'NFL',
      venue: 'Lambeau Field',
      homeTeam: 'GB',
      startTime: new Date(start + i * 24 * HOUR),
    }))

    const body = await run()

    expect(body.refreshed).toBe(WEATHER_REFRESH_MAX_GAMES)
    expect(body.overCap).toBe(5)
  })
})
