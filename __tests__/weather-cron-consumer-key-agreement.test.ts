import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The prewarm cron and the surface that reads it must agree on the cache key.
 *
 * 🛑 THEY DID NOT, AND NOTHING SAID SO. `/api/weather/refresh-cron` wrote
 * `weather:game:{sport}:{externalId}` every three hours; `getGameWeather` — the
 * My Team surface — reads `weather:coords:{lat}:{lng}:{utcDay}`. Every prewarmed
 * row was unreachable, and because `getGameWeather` does a bare `findMany` with
 * no fetch on miss, My Team showed no weather at all.
 *
 * ⚠ AND THE EXISTING SUITE COULD NOT CATCH IT. `weather-refresh-budget` proves
 * the cron's gate agrees with the cron's WRITE — internal consistency — which is
 * precisely what let this hide: the cron reported accurate cache hits on rows
 * nobody could find. A test of one side against itself is not a test of a
 * contract.
 *
 * ⚠ AND NEITHER DID THE FIRST VERSION OF THIS FILE. It computed the route's key
 * and the consumer's key with the SAME builder and asserted they matched — which
 * they did, because the coordinates agree. Re-running it with the original bug
 * reinstated: 8 passed. It proved the two coordinate TABLES agree and said
 * nothing about which key the cron actually writes.
 *
 * So this drives the real route and captures the key it looks up.
 */

const findManyMock = vi.hoisted(() => vi.fn())
const findUniqueMock = vi.hoisted(() => vi.fn())
const getWeatherMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsGame: { findMany: findManyMock },
    weatherCache: { findUnique: findUniqueMock },
  },
}))
vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))

/*
 * ⚠ PARTIAL MOCK ON PURPOSE — the key builders must stay REAL.
 *
 * Stubbing them is what would turn this back into a test of itself: the point is
 * that the route and the consumer reach the same string through the module that
 * actually defines it.
 */
vi.mock('@/lib/weather/weatherService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/weather/weatherService')>()
  return { ...actual, getWeatherForEvent: getWeatherMock }
})

// `@/lib/openweathermap` and `@/lib/weather/venueResolver` are deliberately REAL:
// the defect lived in what the real tables produce.
import { buildWeatherCoordsCacheKey } from '@/lib/weather/weatherService'
import { resolveVenueForTeam } from '@/lib/weather/venueResolver'
import { NFL_TEAM_VENUES, NFL_VENUE_COORDS } from '@/lib/openweathermap'

/** What the My Team surface will look up for this team and kickoff. */
function consumerKey(teamAbbrev: string, when: Date): string {
  const v = resolveVenueForTeam({ sport: 'NFL', teamAbbrev })
  if (v.kind !== 'coords') throw new Error(`no coords for ${teamAbbrev}`)
  return buildWeatherCoordsCacheKey(v.lat, v.lng, when)
}

const KICKOFF = new Date(Date.now() + 60 * 60 * 1000)

function req() {
  return { url: 'http://localhost/api/weather/refresh-cron' } as never
}

describe('weather prewarm: the cron writes the key the consumer reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findUniqueMock.mockResolvedValue(null)
    getWeatherMock.mockResolvedValue({ cacheHit: false })
  })

  /*
   * Lambeau because it is outdoors. A dome short-circuits before the cache in
   * both paths, so a dome fixture would pass without exercising the key at all.
   */
  it('looks up the consumer key for an outdoor NFL venue', async () => {
    findManyMock.mockResolvedValue([
      { externalId: 'g0', sport: 'NFL', venue: 'Lambeau Field', startTime: KICKOFF },
    ])

    const { GET } = await import('@/app/api/weather/refresh-cron/route')
    await GET(req())

    expect(findUniqueMock).toHaveBeenCalled()
    const used = findUniqueMock.mock.calls[0]![0].where.cacheKey
    // The assertion the earlier version was missing: the ROUTE's key, not a
    // key recomputed the way the route is supposed to compute it.
    expect(used).toBe(consumerKey('GB', KICKOFF))
    expect(used).toMatch(/^weather:coords:/)
  })

  it('passes that same key through to the writer, so the row lands where it was sought', async () => {
    findManyMock.mockResolvedValue([
      { externalId: 'g0', sport: 'NFL', venue: 'Lambeau Field', startTime: KICKOFF },
    ])

    const { GET } = await import('@/app/api/weather/refresh-cron/route')
    await GET(req())

    expect(getWeatherMock).toHaveBeenCalled()
    /*
     * Without an explicit `cacheKey`, `getWeatherForEvent` derives its own — and
     * because the route passes `eventId` and `sport`, it would pick the game key
     * and write somewhere nobody reads. Reading the gate and writing elsewhere is
     * the original bug in miniature.
     */
    expect(getWeatherMock.mock.calls[0]![0].cacheKey).toBe(consumerKey('GB', KICKOFF))
  })

  it('every NFL team maps to a venue that exists in the coords table', () => {
    const orphans = Object.entries(NFL_TEAM_VENUES)
      .filter(([, venueName]) => !NFL_VENUE_COORDS[venueName])
      .map(([abbrev, venueName]) => `${abbrev} -> ${venueName}`)
    // An orphan is a team whose prewarmed weather can never be found, silently.
    expect(orphans).toEqual([])
  })

  it('separates games on different days', () => {
    const sun = consumerKey('GB', new Date('2026-09-13T17:00:00Z'))
    const mon = consumerKey('GB', new Date('2026-09-14T17:00:00Z'))
    expect(sun).not.toBe(mon)
  })
})
