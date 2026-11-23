// @vitest-environment node
/**
 * lib/api-sports.ts — apiSportsTeamKey, and the games sync that stores it.
 *
 * Measured 2026-11-22 on 2026 NCAAF `SportsGame` rows (source api_sports): schools named after an
 * NFL city were stored as that NFL club's code — Cincinnati as CIN, Pittsburgh as PIT, Chicago as
 * CHI, New England College as NE — because the NFL shortener ran on college names. Every other
 * school was stored by name. These tests pin the college path to the name and the NFL path to the
 * code, and drive the real sync so a call site reverting to the NFL shortener goes red.
 *
 * Provider access is stubbed at `global.fetch`; prisma is mocked. If the mock failed to intercept,
 * `vitest.setup.db-guard.ts` pins DATABASE_URL at 127.0.0.1:1 and the run fails loudly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sportsGameUpsert = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsGame: { upsert: (...a: unknown[]) => sportsGameUpsert(...a) },
  },
}))

vi.mock('@/lib/workers/rate-limit-manager', () => ({
  rateLimitManager: {
    canCall: async () => true,
    recordCall: async () => {},
    getFallback: async () => null,
  },
}))

const { apiSportsTeamKey, teamNameToAbbrev, syncAPISportsGamesToDb } = await import('@/lib/api-sports')

/** College schools whose names are also NFL cities or nicknames — all 11 seen collapsing. */
const NFL_CITY_SCHOOLS: Array<[string, string]> = [
  ['Cincinnati', 'CIN'],
  ['Houston', 'HOU'],
  ['Miami', 'MIA'],
  ['Minnesota', 'MIN'],
  ['Pittsburgh', 'PIT'],
  ['Tennessee', 'TEN'],
  ['Washington', 'WAS'],
  ['Arizona', 'ARI'],
  ['Chicago', 'CHI'],
  ['Indianapolis', 'IND'],
  ['New England', 'NE'],
]

describe('apiSportsTeamKey', () => {
  it('CONTROL: the NFL shortener really does collapse these college names', () => {
    // Without this, the college assertions below could pass against a shortener that never
    // collapsed anything, and would prove nothing about the fix.
    for (const [school, nflCode] of NFL_CITY_SCHOOLS) {
      expect(teamNameToAbbrev(school)).toBe(nflCode)
    }
  })

  it('stores a college school by its own name, never an NFL code', () => {
    const wrong: string[] = []
    for (const [school, nflCode] of NFL_CITY_SCHOOLS) {
      const key = apiSportsTeamKey(school, 'NCAAF')
      if (key !== school.toUpperCase() || key === nflCode) wrong.push(`${school} -> ${key}`)
    }
    expect(wrong).toEqual([])
  })

  it('leaves the form of other college names unchanged', () => {
    expect(apiSportsTeamKey('Ohio State', 'NCAAF')).toBe('OHIO STATE')
    expect(apiSportsTeamKey('Miami (OH)', 'NCAAF')).toBe('MIAMI (OH)')
    expect(apiSportsTeamKey('  Texas A&M ', 'NCAAF')).toBe('TEXAS A&M')
  })

  it('keeps the NFL path exactly as before', () => {
    expect(apiSportsTeamKey('Cincinnati Bengals', 'NFL')).toBe('CIN')
    expect(apiSportsTeamKey('Kansas City Chiefs', 'NFL')).toBe('KC')
    expect(apiSportsTeamKey('Cincinnati Bengals', 'nfl')).toBe('CIN')
  })

  it('returns null for an empty name, in either sport', () => {
    expect(apiSportsTeamKey(null, 'NCAAF')).toBeNull()
    expect(apiSportsTeamKey('', 'NCAAF')).toBeNull()
    expect(apiSportsTeamKey('   ', 'NCAAF')).toBeNull()
    expect(apiSportsTeamKey(null, 'NFL')).toBeNull()
  })
})

function okResponse(body: unknown) {
  return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, json: async () => body }
}

function fixture(home: string, away: string) {
  return {
    game: { id: 22612, date: { date: '2026-11-28', time: '16:00', timestamp: 1795881600 }, status: { short: 'NS' }, week: '14', stage: 'Regular Season', venue: { name: null } },
    league: { id: 2, name: 'NCAA', season: '2026' },
    teams: { home: { id: 128, name: home }, away: { id: 63, name: away } },
    scores: { home: { total: null }, away: { total: null } },
  }
}

describe('syncAPISportsGamesToDb stores the key per sport', () => {
  beforeEach(() => {
    sportsGameUpsert.mockReset()
    sportsGameUpsert.mockResolvedValue({})
    process.env.API_SPORTS_KEY = 'test-key-not-a-real-secret'
  })
  afterEach(() => vi.unstubAllGlobals())

  it('a college game is written with both school names, on create AND update', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ response: [fixture('Cincinnati', 'Pittsburgh')], errors: [] })))
    await syncAPISportsGamesToDb({ season: '2026', sport: 'NCAAF' })

    expect(sportsGameUpsert).toHaveBeenCalledTimes(1)
    const arg = sportsGameUpsert.mock.calls[0][0]
    expect(arg.create.homeTeam).toBe('CINCINNATI')
    expect(arg.create.awayTeam).toBe('PITTSBURGH')
    // The update path is what repairs rows already stored as CIN / PIT on the next sync.
    expect(arg.update.homeTeam).toBe('CINCINNATI')
    expect(arg.update.awayTeam).toBe('PITTSBURGH')
  })

  it('CONTROL: an NFL game is still written with club codes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ response: [fixture('Cincinnati Bengals', 'Pittsburgh Steelers')], errors: [] })))
    await syncAPISportsGamesToDb({ season: '2026', sport: 'NFL' })

    const arg = sportsGameUpsert.mock.calls[0][0]
    expect(arg.create.homeTeam).toBe('CIN')
    expect(arg.create.awayTeam).toBe('PIT')
  })
})
