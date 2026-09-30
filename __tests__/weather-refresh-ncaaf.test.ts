import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * College football in `weather/refresh-cron`: stadiums from the CFBD directory, placed on the
 * key My Team reads, OFF by default, and measured while off.
 *
 * Measured 2026-09-29: 544 of 600 scanned rows were NCAAF and none could be placed. Since
 * 2026-09-30 the stadium comes from CFBD `/teams` → `location`, carried on the college team
 * directory (664 of 1,933 teams, all 138 FBS). Every placed game is a paid provider call on
 * nearly every run, and that spend is the owner's decision — so the default refreshes nothing.
 *
 * 🛑 THE CONTRACT IS DRIVEN FROM BOTH ENDS. The cron's key is captured from its call to the
 * provider, and My Team's key from the REAL `getGameWeather` reading the cache. A test that
 * computed both with one helper would pass while the two call sites disagreed — which is how
 * this pair drifted before ("Tennessee" was TENN on one side and TEN on the other).
 */

const rowsMock = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }))
const findManyMock = vi.hoisted(() =>
  vi.fn(async (args?: { take?: number }) => rowsMock.rows.slice(0, args?.take ?? rowsMock.rows.length)),
)
const findUniqueMock = vi.hoisted(() => vi.fn())
const cacheFindManyMock = vi.hoisted(() => vi.fn(async () => []))
const getWeatherMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsGame: { findMany: findManyMock },
    weatherCache: { findUnique: findUniqueMock, findMany: cacheFindManyMock },
  },
}))
vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))
vi.mock('@/lib/weather/weatherService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/weather/weatherService')>()
  return { ...actual, getWeatherForEvent: getWeatherMock }
})

const directory = vi.hoisted(() => ({ withVenues: true }))
vi.mock('@/lib/sport-teams/collegeTeamIndexStore', async () => {
  const { buildCollegeTeamIndex } = await import('@/lib/sport-teams/collegeTeamIdentity')
  const venue = (name: string, latitude: number, longitude: number, dome = false) =>
    directory.withVenues ? { name, latitude, longitude, dome } : null
  return {
    loadCollegeTeamIndex: vi.fn(async () =>
      buildCollegeTeamIndex([
        { id: 61, school: 'Georgia', mascot: 'Bulldogs', abbreviation: 'UGA', venue: venue('Sanford Stadium', 33.9498, -83.3733) },
        { id: 2633, school: 'Tennessee', mascot: 'Volunteers', abbreviation: 'TENN', venue: venue('Neyland Stadium', 35.955, -83.925) },
        { id: 333, school: 'Alabama', mascot: 'Crimson Tide', abbreviation: 'ALA', venue: venue('Bryant-Denny Stadium', 33.2083, -87.5504) },
        { id: 2390, school: 'Miami', mascot: 'Hurricanes', abbreviation: 'MIA', venue: venue('Hard Rock Stadium', 25.9579665, -80.2388604) },
        { id: 2567, school: 'SMU', mascot: 'Mustangs', abbreviation: 'SMU', venue: venue('Gerald J. Ford Stadium', 32.8375, -96.7832) },
        { id: 2, school: 'Domed U', abbreviation: 'DOME', venue: venue('Big Roof Dome', 40.0, -90.0, true) },
      ]),
    ),
  }
})

const HOUR = 60 * 60 * 1000
const FLAG = 'WEATHER_REFRESH_NCAAF'
let savedFlag: string | undefined

async function runCron() {
  const { GET } = await import('@/app/api/weather/refresh-cron/route')
  const res = await GET({ url: 'http://localhost/api/weather/refresh-cron' } as never)
  return res.json()
}

/** The keys My Team's real reader looks up for a college game hosted by `hostTeam`. */
async function readerKeys(hostTeam: string, kickoff: Date): Promise<string[]> {
  cacheFindManyMock.mockClear()
  const { getGameWeather } = await import('@/lib/core-app/gameWeather')
  await getGameWeather({ sport: 'NCAAF', games: new Map([['p1', { hostTeam, kickoff }]]) })
  const call = cacheFindManyMock.mock.calls[0] as unknown as [{ where: { cacheKey: { in: string[] } } }] | undefined
  return call?.[0].where.cacheKey.in ?? []
}

function writtenKey(): string {
  return getWeatherMock.mock.calls[0]![0].cacheKey
}

function game(over: Record<string, unknown>) {
  return { externalId: 'c1', sport: 'NCAAF', venue: 'Sanford Stadium', homeTeam: 'UGA', ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  savedFlag = process.env[FLAG]
  delete process.env[FLAG]
  directory.withVenues = true
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
    const body = await runCron()
    expect(getWeatherMock).not.toHaveBeenCalled()
    expect(body.refreshed).toBe(0)
    expect(body.ncaaf).toMatchObject({ enabled: false, placeable: 1, estCallsPerDay: 8 })
  })

  it('⚠ only the exact string "true" enables it', async () => {
    rowsMock.rows = [game({ startTime: new Date(Date.now() + 30 * HOUR) })]
    for (const v of ['1', 'TRUE', 'yes', ' true ']) {
      process.env[FLAG] = v
      const body = await runCron()
      expect(body.ncaaf.enabled, `value=${JSON.stringify(v)}`).toBe(false)
    }
    expect(getWeatherMock).not.toHaveBeenCalled()
  })

  it('🛑 the cron writes the key My Team reads, from every feed spelling', async () => {
    process.env[FLAG] = 'true'
    const kickoff = new Date(Date.now() + 30 * HOUR)
    // Spellings measured on production: ESPN code, ESPN school + mascot, CFBD plain school.
    for (const home of ['UGA', 'Georgia Bulldogs', 'Georgia']) {
      getWeatherMock.mockClear()
      rowsMock.rows = [game({ homeTeam: home, startTime: kickoff })]
      const body = await runCron()
      expect(body.refreshed, home).toBe(1)
      // My Team hands the reader the canonical school collegeNextGame.ts resolved.
      expect(await readerKeys('Georgia', kickoff), home).toEqual([writtenKey()])
    }
  })

  it('⚠ "Tennessee" is the Volunteers on both sides, not the Titans', async () => {
    process.env[FLAG] = 'true'
    const kickoff = new Date(Date.now() + 30 * HOUR)
    rowsMock.rows = [game({ homeTeam: 'Tennessee', venue: 'Neyland Stadium', startTime: kickoff })]
    const body = await runCron()
    expect(body.refreshed).toBe(1)
    expect(writtenKey()).toMatch(/:35\.9\d:-83\.9\d:/) // Knoxville, not Nashville (36.17, -86.77)
    expect(await readerKeys('Tennessee', kickoff)).toEqual([writtenKey()])
  })

  it('places a school the old 15-team table never had (SMU)', async () => {
    process.env[FLAG] = 'true'
    const kickoff = new Date(Date.now() + 30 * HOUR)
    rowsMock.rows = [game({ homeTeam: 'SMU Mustangs', venue: 'Gerald J. Ford Stadium', startTime: kickoff })]
    const body = await runCron()
    expect(body.refreshed).toBe(1)
    expect(await readerKeys('SMU', kickoff)).toEqual([writtenKey()])
  })

  it('accepts a row with no venue on the home team alone', async () => {
    process.env[FLAG] = 'true'
    rowsMock.rows = [game({ venue: null, startTime: new Date(Date.now() + 30 * HOUR) })]
    const body = await runCron()
    expect(body.refreshed).toBe(1)
  })

  it('⚠ does NOT forecast the home campus for a neutral-site game', async () => {
    process.env[FLAG] = 'true'
    rowsMock.rows = [game({ homeTeam: 'ALA', venue: 'Camping World Stadium', startTime: new Date(Date.now() + 30 * HOUR) })]
    const body = await runCron()
    expect(getWeatherMock).not.toHaveBeenCalled()
    expect(body.ncaaf.venueMismatch).toBe(1)
    expect(body.ncaaf.venueMismatchSamples[0]).toContain('Camping World Stadium')
    expect(body.ncaaf.venueMismatchSamples[0]).toContain('Bryant-Denny Stadium')
  })

  it('🛑 an NCAAF game at an NFL stadium is flag-gated too, and lands on the reader key', async () => {
    // Miami at Hard Rock used to be placed through the NFL table first, and paid for with the flag off.
    const kickoff = new Date(Date.now() + 30 * HOUR)
    rowsMock.rows = [game({ homeTeam: 'MIA', venue: 'Hard Rock Stadium', startTime: kickoff })]
    const off = await runCron()
    expect(getWeatherMock).not.toHaveBeenCalled()
    expect(off.ncaaf.placeable).toBe(1)

    process.env[FLAG] = 'true'
    const on = await runCron()
    expect(on.refreshed).toBe(1)
    expect(await readerKeys('Miami', kickoff)).toEqual([writtenKey()])
  })

  it('names the host teams the directory does not know', async () => {
    process.env[FLAG] = 'true'
    rowsMock.rows = [game({ homeTeam: 'Nowhere Tech', venue: 'Somewhere Field', startTime: new Date(Date.now() + 30 * HOUR) })]
    const body = await runCron()
    expect(getWeatherMock).not.toHaveBeenCalled()
    expect(body.ncaaf.unknownTeam).toBe(1)
    expect(body.ncaaf.unknownTeamSamples).toEqual(['Nowhere Tech'])
  })

  it('counts one placeable game once, however many sources store it', async () => {
    const kickoff = new Date(Date.now() + 30 * HOUR)
    rowsMock.rows = ['UGA', 'Georgia Bulldogs', 'Georgia'].map((h, i) => game({ externalId: `s${i}`, homeTeam: h, startTime: kickoff }))
    const body = await runCron()
    expect(body.ncaaf.placeable).toBe(1)
  })

  it('before venues are ingested, falls back to the legacy table via the RECORD abbreviation', async () => {
    directory.withVenues = false
    process.env[FLAG] = 'true'
    const kickoff = new Date(Date.now() + 30 * HOUR)
    rowsMock.rows = [game({ homeTeam: 'Georgia Bulldogs', startTime: kickoff })]
    const body = await runCron()
    expect(body.refreshed).toBe(1) // UGA is in NCAAF_TEAM_STADIUM
    expect(await readerKeys('Georgia', kickoff)).toEqual([writtenKey()])
  })
})

describe('My Team college weather reader', () => {
  it('a domed college stadium reads as indoors without a cache lookup', async () => {
    const { getGameWeather } = await import('@/lib/core-app/gameWeather')
    const out = await getGameWeather({
      sport: 'NCAAF',
      games: new Map([['p1', { hostTeam: 'Domed U', kickoff: new Date(Date.now() + 30 * HOUR) }]]),
    })
    expect(out.get('p1')).toBeDefined()
    expect(cacheFindManyMock).not.toHaveBeenCalled()
  })
})
