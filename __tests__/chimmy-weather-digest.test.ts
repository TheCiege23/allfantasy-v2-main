import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The weather pipeline was running the whole time — /api/weather/refresh-cron
 * every three hours, an OpenWeatherMap key verified live, NCAAF stadium
 * coordinates on file — and nothing in the Chimmy path ever read it.
 *
 * It was also expired most of the day: the team-window TTL was 60 minutes
 * against a 3-hour refresh, so 229 cached rows had ZERO unexpired among them at
 * the time of the measurement. Both halves are covered here — the digest reads
 * weather, and it reads only forecasts that are still valid.
 */

const weatherCache = vi.fn()
const sportsGame = vi.fn()

vi.mock('@/lib/injuries/injuryReadPort', () => ({
  listInjuryFacts: async () => ({ facts: [], newestFetchedAt: null, feedStale: true }),
}))
vi.mock('@/lib/data/news', () => ({ getLatestNews: async () => [] }))
vi.mock('@/lib/news/newsapi-cache', () => ({ getNewsApiEverythingDbFirst: async () => ({ articles: [] }) }))
vi.mock('@/lib/prisma', () => {
  const empty = new Proxy({}, { get: () => async () => [] })
  return {
    prisma: new Proxy(
      {},
      {
        get: (_t, model: string) => {
          if (model === 'weatherCache') return { findMany: (...a: unknown[]) => weatherCache(...a) }
          if (model === 'sportsGame') return { findMany: (...a: unknown[]) => sportsGame(...a) }
          return empty
        },
      }
    ),
  }
})

const outdoor = {
  cacheKey: 'weather:team-window:BUF:2026-09-07',
  forecastForTime: new Date('2026-09-07T17:00:00Z'),
  fetchedAt: new Date('2026-09-07T12:00:00Z'),
  temperatureF: 54.4,
  conditionLabel: 'Rain',
  windSpeedMph: 21.6,
  precipChancePct: 80,
  isIndoor: false,
  isDome: false,
  roofClosed: false,
}

const indoor = { ...outdoor, cacheKey: 'weather:team-window:DET:2026-09-07', isDome: true }

async function digest(sport: 'NFL' | 'NCAAF' = 'NFL') {
  const { buildChimmySportDataDigest } = await import('@/lib/chimmy/chimmy-sport-data-digest')
  return buildChimmySportDataDigest({ sport, question: 'any games today? weather?', includeNewsApi: false })
}

beforeEach(() => {
  vi.resetModules()
  weatherCache.mockReset().mockResolvedValue([])
  sportsGame.mockReset().mockResolvedValue([])
})
afterEach(() => vi.restoreAllMocks())

describe('Chimmy can see the forecast', () => {
  it('renders conditions, wind and precipitation', async () => {
    weatherCache.mockResolvedValue([outdoor])
    const d = await digest()
    expect(d.text).toContain('Game weather')
    expect(d.text).toContain('54F')
    expect(d.text).toContain('Rain')
    expect(d.text).toContain('wind 22mph')
    expect(d.text).toContain('precip 80%')
  })

  it('says indoors instead of quoting a temperature', async () => {
    // An indoor game has no weather effect. Printing a number invites the model
    // to reason about wind in a dome.
    weatherCache.mockResolvedValue([indoor])
    const d = await digest()
    expect(d.text).toContain('indoors — weather not a factor')
    expect(d.text).not.toContain('wind 22mph')
  })
})

describe('an expired forecast is not a forecast', () => {
  it('only asks for rows that are still valid', async () => {
    weatherCache.mockResolvedValue([outdoor])
    await digest()
    const where = weatherCache.mock.calls[0]?.[0]?.where ?? {}
    // The TTL/cadence mismatch meant every row was expired most of the day. The
    // fix was to raise the TTL, NOT to start reading lapsed forecasts.
    expect(where.expiresAt?.gt).toBeInstanceOf(Date)
    expect(where.sport).toBe('NFL')
  })

  it('renders no weather section when nothing is unexpired', async () => {
    weatherCache.mockResolvedValue([])
    const d = await digest()
    expect(d.text).not.toContain('Game weather')
  })
})
