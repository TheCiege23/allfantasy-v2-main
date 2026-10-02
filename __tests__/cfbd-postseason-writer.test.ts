import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * CFBD's postseason slate — bowls and the College Football Playoff — written beside the regular
 * season by the import-scores cron (Phase 2 of the CFP bracket, 2026-10-02).
 *
 * What these pin:
 *   1. The college season is chosen by US Eastern month, and January belongs to the PREVIOUS year.
 *      The 2025 title game was played 2026-01-19 and CFBD files it under 2025; asking for the
 *      calendar year would fetch nothing at exactly the moment the Playoff is decided.
 *   2. Postseason rows carry `seasonType: 'post'` and `week: null`. CFBD restarts postseason weeks
 *      at 1, and readers keyed on (season, week) without a season type would join a bowl to
 *      regular-season week 1.
 *   3. One CFBD entry, two calls, one result — and a failure names the half that failed.
 */
const ORIGINAL_ENV = { ...process.env }

function cfbdResponse(rows: unknown[]): Response {
  const text = JSON.stringify(rows)
  return { ok: true, status: 200, json: async () => rows, text: async () => text, headers: new Map() } as unknown as Response
}

function quotaWall(): Response {
  const text = JSON.stringify({ message: 'Monthly call quota exceeded.' })
  return { ok: false, status: 429, json: async () => JSON.parse(text), text: async () => text, headers: new Map() } as unknown as Response
}

const bowl = (over: Record<string, unknown> = {}) => ({
  id: 401_769_000,
  homeTeam: 'Indiana',
  awayTeam: 'Miami',
  startDate: '2026-01-20T00:30:00.000Z',
  season: 2025,
  seasonType: 'postseason',
  week: 1,
  completed: true,
  homePoints: 27,
  awayPoints: 21,
  ...over,
})

const regular = (over: Record<string, unknown> = {}) => ({
  id: 401_700_001,
  homeTeam: 'Alabama',
  awayTeam: 'Auburn',
  startDate: '2026-11-28T20:30:00.000Z',
  season: 2026,
  seasonType: 'regular',
  week: 14,
  completed: false,
  homePoints: null,
  awayPoints: null,
  ...over,
})

describe('cfbPostseasonSeason', () => {
  const load = async () => (await import('@/lib/scores/gameScoreProviders')).cfbPostseasonSeason

  it('December is that year’s season', async () => {
    const f = await load()
    expect(f(new Date('2026-12-20T18:00:00Z'))).toBe(2026)
  })

  it('January is the PREVIOUS year’s season — the title game is filed under the year it began', async () => {
    const f = await load()
    expect(f(new Date('2027-01-19T23:00:00Z'))).toBe(2026)
  })

  it('is null outside December and January', async () => {
    const f = await load()
    expect(f(new Date('2026-11-28T18:00:00Z'))).toBeNull()
    expect(f(new Date('2027-02-02T18:00:00Z'))).toBeNull()
    expect(f(new Date('2026-09-05T18:00:00Z'))).toBeNull()
  })

  it('reads the month in US Eastern, not UTC', async () => {
    const f = await load()
    // 04:30 UTC on Dec 1 is still the evening of Nov 30 in New York.
    expect(f(new Date('2026-12-01T04:30:00Z'))).toBeNull()
    // 03:00 UTC on Jan 1 is still New Year's Eve in New York — the 2026 season, by December's rule.
    expect(f(new Date('2027-01-01T03:00:00Z'))).toBe(2026)
    // 03:00 UTC on Feb 1 is still Jan 31 in New York.
    expect(f(new Date('2027-02-01T03:00:00Z'))).toBe(2026)
  })
})

describe('CFBD postseason fetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    process.env.CFBD_KEY = 'test-key'
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
  })

  const urls = () => fetchMock.mock.calls.map((c) => String(c[0]))

  it('asks for the postseason of the season it was given, with no week', async () => {
    fetchMock.mockResolvedValue(cfbdResponse([bowl()]))
    const { fetchCfbdPostseasonGames } = await import('@/lib/scores/gameScoreProviders')

    await fetchCfbdPostseasonGames(2025)

    expect(urls()).toHaveLength(1)
    expect(urls()[0]).toContain('/games?year=2025&seasonType=postseason')
    expect(urls()[0]).not.toContain('week=')
  })

  it('writes post / null-week rows, keeping the vendor week only in raw', async () => {
    fetchMock.mockResolvedValue(cfbdResponse([bowl()]))
    const { fetchCfbdPostseasonGames } = await import('@/lib/scores/gameScoreProviders')

    const { source, games, error } = await fetchCfbdPostseasonGames(2025)

    expect(source).toBe('cfbd')
    expect(error).toBeNull()
    expect(games).toHaveLength(1)
    expect(games[0]).toMatchObject({
      externalId: '401769000',
      homeTeam: 'Indiana',
      awayTeam: 'Miami',
      homeScore: 27,
      awayScore: 21,
      status: 'final',
      seasonType: 'post',
      week: null,
      season: 2025,
    })
    expect((games[0]!.raw as { week: number }).week).toBe(1)
  })

  it('keeps the requested COLLEGE season when a row omits it — never the calendar year', async () => {
    fetchMock.mockResolvedValue(cfbdResponse([bowl({ season: null })]))
    const { fetchCfbdPostseasonGames } = await import('@/lib/scores/gameScoreProviders')

    const { games } = await fetchCfbdPostseasonGames(2025)
    expect(games[0]!.season).toBe(2025)
  })

  it('applies the both-halves final rule to bowls too', async () => {
    fetchMock.mockResolvedValue(cfbdResponse([bowl({ homePoints: 27, awayPoints: null })]))
    const { fetchCfbdPostseasonGames } = await import('@/lib/scores/gameScoreProviders')

    const { games } = await fetchCfbdPostseasonGames(2025)
    expect(games[0]!.status).toBe('scheduled')
    expect(games[0]!.homeScore).toBeNull()
  })

  it('leaves the regular fetch exactly as it was — week kept, regular type, week param sent', async () => {
    // POSITIVE CONTROL for the refactor: the regular path now shares the slate fetcher.
    fetchMock.mockResolvedValue(cfbdResponse([regular()]))
    const { fetchCfbdGames } = await import('@/lib/scores/gameScoreProviders')

    const { games } = await fetchCfbdGames(2026, 14)
    expect(urls()[0]).toContain('/games?year=2026&seasonType=regular&week=14')
    expect(games[0]).toMatchObject({ seasonType: 'regular', week: 14, season: 2026 })
  })
})

describe('fetchCfbdForTick — one CFBD entry, both slates', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    process.env.CFBD_KEY = 'test-key'
    fetchMock = vi.fn(async (url: string) =>
      String(url).includes('seasonType=postseason') ? cfbdResponse([bowl()]) : cfbdResponse([regular()]),
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
  })

  const urls = () => fetchMock.mock.calls.map((c) => String(c[0]))

  it('outside the postseason it is the regular call and nothing else', async () => {
    const { fetchCfbdForTick } = await import('@/lib/scores/gameScoreProviders')
    const out = await fetchCfbdForTick({ regularSeason: 2026, week: 14, postseasonSeason: null })

    expect(urls()).toHaveLength(1)
    expect(urls()[0]).toContain('seasonType=regular')
    expect(out.games.map((g) => g.seasonType)).toEqual(['regular'])
  })

  it('in the postseason it asks for both and returns them as one cfbd result', async () => {
    const { fetchCfbdForTick } = await import('@/lib/scores/gameScoreProviders')
    const out = await fetchCfbdForTick({ regularSeason: 2026, postseasonSeason: 2026 })

    expect(urls()).toHaveLength(2)
    expect(urls().some((u) => u.includes('year=2026&seasonType=postseason'))).toBe(true)
    expect(out.source).toBe('cfbd')
    expect(out.error).toBeNull()
    expect(out.games.map((g) => g.seasonType).sort()).toEqual(['post', 'regular'])
  })

  it('a postseason quota wall is reported AS the postseason, and the regular games survive', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('seasonType=postseason') ? quotaWall() : cfbdResponse([regular()]),
    )
    const { fetchCfbdForTick } = await import('@/lib/scores/gameScoreProviders')
    const out = await fetchCfbdForTick({ regularSeason: 2026, postseasonSeason: 2026 })

    expect(out.games).toHaveLength(1)
    expect(out.error).toMatch(/^postseason: provider monthly call quota exceeded/)
  })

  it('a postseason-only backfill does not touch the regular slate', async () => {
    const { fetchCfbdForTick } = await import('@/lib/scores/gameScoreProviders')
    const out = await fetchCfbdForTick({ regularSeason: null, postseasonSeason: 2025 })

    expect(urls()).toEqual([expect.stringContaining('year=2025&seasonType=postseason')])
    expect(out.games.map((g) => g.seasonType)).toEqual(['post'])
    // One half asked, so the error is not labelled — same shape as the regular call alone.
    expect(out.error).toBeNull()
  })

  it('a spent run budget skips the postseason call and says so', async () => {
    const { fetchCfbdForTick } = await import('@/lib/scores/gameScoreProviders')
    const out = await fetchCfbdForTick({ regularSeason: 2026, postseasonSeason: 2026, deadlineAt: Date.now() - 1 })

    expect(urls().every((u) => !u.includes('postseason'))).toBe(true)
    expect(out.error).toBe('postseason: skipped: run budget exhausted before this provider was reached')
  })

  it('fetchGamesForSport routes the cfbd option into the NCAAF chain, and only there', async () => {
    const { fetchGamesForSport } = await import('@/lib/scores/gameScoreProviders')

    await fetchGamesForSport('NCAAF', 2026, undefined, { cfbd: { postseasonSeason: 2026 } })
    expect(urls().filter((u) => u.includes('collegefootballdata')).length).toBe(2)

    fetchMock.mockClear()
    await fetchGamesForSport('NCAAF', 2026)
    const cfbdCalls = urls().filter((u) => u.includes('collegefootballdata'))
    expect(cfbdCalls).toHaveLength(1)
    expect(cfbdCalls[0]).toContain('seasonType=regular')
  })
})
