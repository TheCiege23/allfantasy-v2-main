import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * College football in `weather/refresh-cron`: placed on the key My Team reads, OFF by default,
 * and measured while off.
 *
 * Measured 2026-09-29: 544 of 600 scanned rows were NCAAF and none could be placed. Every placed
 * game is a paid provider call on nearly every run, and that spend is the owner's decision — so
 * the default state refreshes nothing and reports what enabling would cost.
 *
 * Tables and `resolveVenueForTeam` are REAL: the contract under test is that the cron writes the
 * key `getGameWeather` builds for an NCAAF league, through `resolveVenueForTeam({ sport: 'NCAAF' })`.
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
vi.mock('@/lib/weather/weatherService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/weather/weatherService')>()
  return { ...actual, getWeatherForEvent: getWeatherMock }
})

import { buildWeatherCoordsCacheKey } from '@/lib/weather/weatherService'
import { resolveVenueForTeam } from '@/lib/weather/venueResolver'

const HOUR = 60 * 60 * 1000
const FLAG = 'WEATHER_REFRESH_NCAAF'
let savedFlag: string | undefined

/** The key My Team's `getGameWeather` looks up for an NCAAF league's host team. */
function readerKey(teamAbbrev: string, when: Date): string {
  const v = resolveVenueForTeam({ sport: 'NCAAF', teamAbbrev })
  if (v.kind !== 'coords') throw new Error(`no NCAAF coords for ${teamAbbrev}`)
  return buildWeatherCoordsCacheKey(v.lat, v.lng, when)
}

async function run() {
  const { GET } = await import('@/app/api/weather/refresh-cron/route')
  const res = await GET({ url: 'http://localhost/api/weather/refresh-cron' } as never)
  return res.json()
}

function game(over: Record<string, unknown>) {
  return { externalId: 'c1', sport: 'NCAAF', venue: 'Sanford Stadium', homeTeam: 'UGA', ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  savedFlag = process.env[FLAG]
  delete process.env[FLAG]
  rowsMock.rows = []
  findUniqueMock.mockResolvedValue(null)
  getWeatherMock.mockResolvedValue({ cacheHit: false })
})
afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG]
  else process.env[FLAG] = savedFlag
})

describe('NCAAF weather prewarm', () => {
  it('🛑 is OFF by default: no provider call, but it reports what enabling would cost', async () => {
    rowsMock.rows = [game({ startTime: new Date(Date.now() + 30 * HOUR) })]

    const body = await run()

    expect(getWeatherMock).not.toHaveBeenCalled()
    expect(body.refreshed).toBe(0)
    expect(body.ncaaf).toMatchObject({ enabled: false, placeable: 1, estCallsPerDay: 8 })
  })

  it('⚠ only the exact string "true" enables it', async () => {
    rowsMock.rows = [game({ startTime: new Date(Date.now() + 30 * HOUR) })]
    for (const v of ['1', 'TRUE', 'yes', ' true ']) {
      process.env[FLAG] = v
      const body = await run()
      expect(body.ncaaf.enabled, `value=${JSON.stringify(v)}`).toBe(false)
    }
    expect(getWeatherMock).not.toHaveBeenCalled()
  })

  it('when enabled, refreshes onto the key My Team reads for the host team', async () => {
    process.env[FLAG] = 'true'
    const kickoff = new Date(Date.now() + 30 * HOUR)
    rowsMock.rows = [game({ startTime: kickoff })]

    const body = await run()

    expect(body.ncaaf.enabled).toBe(true)
    expect(body.refreshed).toBe(1)
    expect(getWeatherMock.mock.calls[0]![0].cacheKey).toBe(readerKey('UGA', kickoff))
  })

  it('accepts a row with no venue on the home team alone', async () => {
    process.env[FLAG] = 'true'
    const kickoff = new Date(Date.now() + 30 * HOUR)
    rowsMock.rows = [game({ venue: null, startTime: kickoff })]

    const body = await run()

    expect(body.refreshed).toBe(1)
    expect(getWeatherMock.mock.calls[0]![0].cacheKey).toBe(readerKey('UGA', kickoff))
  })

  it('⚠ does NOT forecast the home campus for a neutral-site game', async () => {
    process.env[FLAG] = 'true'
    rowsMock.rows = [game({ homeTeam: 'ALA', venue: 'Camping World Stadium', startTime: new Date(Date.now() + 30 * HOUR) })]

    const body = await run()

    expect(getWeatherMock).not.toHaveBeenCalled()
    expect(body.ncaaf.venueMismatch).toBe(1)
    expect(body.ncaaf.venueMismatchSamples[0]).toContain('Camping World Stadium')
    expect(body.ncaaf.venueMismatchSamples[0]).toContain('Bryant-Denny Stadium')
  })

  it('names the host teams the stadium table does not know', async () => {
    process.env[FLAG] = 'true'
    rowsMock.rows = [game({ homeTeam: 'Vanderbilt', venue: 'FirstBank Stadium', startTime: new Date(Date.now() + 30 * HOUR) })]

    const body = await run()

    expect(getWeatherMock).not.toHaveBeenCalled()
    expect(body.ncaaf.unknownTeam).toBe(1)
    expect(body.ncaaf.unknownTeamSamples).toEqual(['Vanderbilt'])
  })

  it('counts one placeable game once, however many sources store it', async () => {
    const kickoff = new Date(Date.now() + 30 * HOUR)
    rowsMock.rows = ['a', 'b', 'c'].map((s) => game({ externalId: s, startTime: kickoff }))

    const body = await run()

    expect(body.ncaaf.placeable).toBe(1)
  })

  it('a Miami home game at Hard Rock lands on the key the NCAAF reader builds', async () => {
    // Hard Rock Stadium resolves through the NFL table first. The NCAAF table used to hold the
    // Coral Gables campus under this label, so the two keys never met.
    const kickoff = new Date(Date.now() + 30 * HOUR)
    rowsMock.rows = [game({ homeTeam: 'MIA', venue: 'Hard Rock Stadium', startTime: kickoff })]

    const body = await run()

    expect(body.refreshed).toBe(1)
    expect(getWeatherMock.mock.calls[0]![0].cacheKey).toBe(readerKey('MIA', kickoff))
  })
})
