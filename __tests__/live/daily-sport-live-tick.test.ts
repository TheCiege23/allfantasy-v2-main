/** @vitest-environment node */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Phase 3.3d — NBA / NHL / MLB live scoring during games.
 *
 * The daily sports were scored from `player_game_stats`, and that table was only written by the
 * 07:00 UTC `import-player-game-stats?multiSport=1` sweep — so a matchup moved once a day while NFL
 * moved during games. `runDailySportLiveTick` is the in-game writer, folded into the existing
 * `live-score-tick` fast-tier cron with a configurable sport flag.
 *
 * The provider transport (`riFetchRows`) is NOT mocked: the 304 rule and the two-account iteration
 * are its behaviour, and the point of these tests is that the tick actually goes through them.
 * Only `fetch` is replaced, and its payload is the COMMITTED fixture `live.NBA.json`.
 */

const FIXTURE = path.join(process.cwd(), 'contracts', 'rolling-insights', 'fixtures', 'live.NBA.json')
const fixtureBody = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { data: { NBA: Array<Record<string, any>> } }

const h = vi.hoisted(() => ({
  cache: new Map<string, { data: unknown; expiresAt: Date }>(),
  games: [] as Array<{ sport: string; startTime: Date; status: string | null }>,
  identities: [] as Array<{ id: string; rollingInsightsId: string }>,
  seasons: [] as Array<{ id: string; sport: string; status: string }>,
  upsert: vi.fn(),
  sportsGameFindMany: vi.fn(),
  sync: vi.fn(),
  recalc: vi.fn(),
  resolveWeek: vi.fn(),
  sealed: vi.fn(),
  order: [] as string[],
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({
      $executeRaw: vi.fn(async () => 0),
      playerGameStat: {
        findMany: async () => [],
        upsert: (...a: unknown[]) => h.upsert(...a),
      },
    }),
    sportsGame: { findMany: (...a: unknown[]) => h.sportsGameFindMany(...a), upsert: vi.fn(async () => ({})) },
    sportsDataCache: {
      findUnique: async ({ where }: { where: { cacheKey: string } }) => {
        const row = h.cache.get(where.cacheKey)
        return row ? { cacheKey: where.cacheKey, ...row } : null
      },
      upsert: async ({ where, create, update }: any) => {
        const prev = h.cache.get(where.cacheKey)
        h.cache.set(where.cacheKey, prev ? { ...prev, ...update } : { data: create.data, expiresAt: create.expiresAt })
        return {}
      },
    },
    playerIdentityMap: { findMany: async () => h.identities },
    playerGameStat: { upsert: (...a: unknown[]) => h.upsert(...a) },
    redraftSeason: {
      findMany: async ({ where }: any) => {
        const wanted: string[] = JSON.stringify(where).match(/"(NBA|NHL|MLB|nba|nhl|mlb)"/g)?.map((s) => s.replace(/"/g, '').toUpperCase()) ?? []
        return h.seasons.filter((s) => wanted.includes(s.sport))
      },
    },
  },
}))
vi.mock('@/lib/redraft/playerWeeklyScoreService', () => ({
  syncPlayerWeeklyScoresForRedraftSeason: (...a: unknown[]) => h.sync(...a),
}))
vi.mock('@/lib/redraft/scoringEngine', () => ({
  recalculateMatchupsForSeasonWeek: (...a: unknown[]) => h.recalc(...a),
}))
vi.mock('@/lib/season-week', () => ({
  resolveSeasonWeekForRedraftSeason: (...a: unknown[]) => h.resolveWeek(...a),
}))
vi.mock('@/lib/redraft/weekSealed', () => ({
  isRedraftWeekSealed: (...a: unknown[]) => h.sealed(...a),
}))

import {
  DAILY_LIVE_STATE_PREFIX,
  __resetDailyLiveIdentityCache,
  liveGameEasternDates,
  resolveDailyLiveSports,
  rotateDailyLiveSports,
  runDailySportLiveTick,
} from '@/lib/live/dailySportLiveTick'

const PRIMARY = 'tok-primary-SECRET-aaaa'
const SECONDARY = 'tok-secondary-SECRET-bbbb'
const TOKEN_ENV = [
  'ROLLING_INSIGHTS_RSC_TOKEN',
  'RSC_TOKEN',
  'ROLLING_INSIGHTS_CLIENT_SECRET',
  'ROLLING_INSIGHTS_API_KEY',
  'ROLLING_INSIGHTS_KEY',
  'ROLLING_INSIGHTS_RSC_TOKEN2',
  'ROLLING_INSIGHTS_CLIENT_SECRET2',
  'ROLLING_INSIGHTS_PRIMARY_SPORTS',
]

/** 21:30 ET on Tue 2026-10-20 is 01:30 UTC on 10-21 — the UTC date is the WRONG one for /live. */
const TIPOFF = new Date('2026-10-21T01:30:00Z')
const NOW = new Date('2026-10-21T03:00:00Z')

type Call = { path: string; token: string | null; buster: string | null }
let calls: Call[] = []

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
function notModified(): Response {
  return new Response(null, { status: 304 })
}

/** A fetch whose answer depends on which credential presented. */
function fetchBy(answer: (token: string, n: number) => Response | Promise<Response>): typeof fetch {
  let n = 0
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    const token = url.searchParams.get('RSC_token')
    calls.push({ path: url.pathname, token, buster: url.searchParams.get('_') })
    n += 1
    return answer(token ?? '', n)
  }) as typeof fetch
}

/** Fixture lines, with every player resolvable through the identity map. */
function identitiesFromFixture() {
  const ids = new Set<string>()
  for (const g of fixtureBody.data.NBA) {
    for (const side of ['home_team', 'away_team']) {
      for (const id of Object.keys(g.player_box?.[side] ?? {})) ids.add(id)
    }
  }
  return [...ids].map((id) => ({ id: `pim-${id}`, rollingInsightsId: id }))
}

/** The fixture with one player's points bumped — a single changed box line. */
function fixtureWithOneChange() {
  const copy = JSON.parse(JSON.stringify(fixtureBody)) as typeof fixtureBody
  const game = copy.data.NBA[0]!
  const side = game.player_box.home_team as Record<string, Record<string, unknown>>
  const firstId = Object.keys(side)[0]!
  side[firstId] = { ...side[firstId], points: Number(side[firstId].points ?? 0) + 2 }
  return copy
}

let nowMs = 1_000
const clock = () => (nowMs += 1)

beforeEach(() => {
  vi.clearAllMocks()
  calls = []
  h.cache.clear()
  h.order = []
  __resetDailyLiveIdentityCache()
  for (const k of TOKEN_ENV) delete process.env[k]
  delete process.env.DAILY_SPORT_LIVE_SCORING
  process.env.ROLLING_INSIGHTS_RSC_TOKEN = PRIMARY
  process.env.ROLLING_INSIGHTS_RSC_TOKEN2 = SECONDARY

  h.games = [{ sport: 'NBA', startTime: TIPOFF, status: 'scheduled' }]
  h.sportsGameFindMany.mockImplementation(async ({ where }: any) => {
    const keys: string[] = where.sport.in
    const gte: Date = where.startTime.gte
    const lte: Date = where.startTime.lte
    return h.games.filter((g) => keys.includes(g.sport) && g.startTime >= gte && g.startTime <= lte)
  })
  h.identities = identitiesFromFixture()
  h.seasons = [
    { id: 'season-nba', sport: 'NBA', status: 'in_season' },
    { id: 'season-nhl', sport: 'NHL', status: 'in_season' },
  ]
  h.upsert.mockImplementation(async () => {
    h.order.push('upsert')
    return {}
  })
  h.resolveWeek.mockResolvedValue({ ok: true, phase: 'regular', fantasyWeek: 1 })
  h.sealed.mockResolvedValue(false)
  h.sync.mockImplementation(async ({ seasonId, week }: { seasonId: string; week: number }) => {
    h.order.push(`sync:${seasonId}`)
    return { seasonId, week, scoresUpserted: 4, dailyScoresUpserted: 4 }
  })
  h.recalc.mockImplementation(async (seasonId: string) => {
    h.order.push(`recalc:${seasonId}`)
    return { updated: 3, incomplete: 0, summaries: [] }
  })
})

afterEach(() => {
  for (const k of TOKEN_ENV) delete process.env[k]
  delete process.env.DAILY_SPORT_LIVE_SCORING
})

describe('resolveDailyLiveSports — all supported sports default on; explicit off is respected', () => {
  it('enables all sports when unset or empty and respects explicit off', () => {
    expect(resolveDailyLiveSports({})).toEqual(['NBA', 'NHL', 'MLB'])
    expect(resolveDailyLiveSports({ DAILY_SPORT_LIVE_SCORING: '' })).toEqual(['NBA', 'NHL', 'MLB'])
    expect(resolveDailyLiveSports({ DAILY_SPORT_LIVE_SCORING: '0' })).toEqual([])
    expect(resolveDailyLiveSports({ DAILY_SPORT_LIVE_SCORING: 'false' })).toEqual([])
  })

  it('"1" enables all three; a list enables only the named, known sports', () => {
    expect(resolveDailyLiveSports({ DAILY_SPORT_LIVE_SCORING: '1' })).toEqual(['NBA', 'NHL', 'MLB'])
    expect(resolveDailyLiveSports({ DAILY_SPORT_LIVE_SCORING: 'nba, mlb' })).toEqual(['NBA', 'MLB'])
    // NFL already has its own live path, and SOCCER is not part of this phase.
    expect(resolveDailyLiveSports({ DAILY_SPORT_LIVE_SCORING: 'NFL,SOCCER' })).toEqual([])
  })
})

describe('game window — read from the schedule in the DB', () => {
  it('rotates the first sport over consecutive cadence windows', () => {
    const sports = ['NBA', 'NHL', 'MLB'] as const
    expect([0, 1, 2].map((tick) => rotateDailyLiveSports(sports, tick * 180_000, 180_000)[0])).toEqual(['NBA', 'NHL', 'MLB'])
  })
  it('no polling outside a game window: no provider call, no write, no rescore', async () => {
    h.games = [{ sport: 'NBA', startTime: new Date('2026-10-21T23:00:00Z'), status: 'scheduled' }] // tonight, not yet
    const fetchImpl = fetchBy(() => json(fixtureBody))
    const out = await runDailySportLiveTick({ sports: ['NBA'], now: NOW, fetchImpl, clock })

    expect(calls).toHaveLength(0)
    expect(h.upsert).not.toHaveBeenCalled()
    expect(h.sync).not.toHaveBeenCalled()
    expect(out.sports.NBA?.status).toBe('no-live-games')
  })

  it('a game marked final is not a live game', async () => {
    h.games = [{ sport: 'NBA', startTime: TIPOFF, status: 'Final' }]
    const out = await runDailySportLiveTick({ sports: ['NBA'], now: NOW, fetchImpl: fetchBy(() => json(fixtureBody)), clock })
    expect(calls).toHaveLength(0)
    expect(out.sports.NBA?.status).toBe('no-live-games')
  })

  it('polling during one: fetches /live, writes the box lines, rescores the sport', async () => {
    const out = await runDailySportLiveTick({ sports: ['NBA'], now: NOW, fetchImpl: fetchBy(() => json(fixtureBody)), clock })

    expect(calls).toHaveLength(1)
    expect(h.upsert).toHaveBeenCalled()
    expect(out.sports.NBA?.status).toBe('written')
    expect(out.sports.NBA?.linesWritten).toBe(h.upsert.mock.calls.length)
    // Every row the scorer reads is keyed on the identity map id, never the raw provider id.
    for (const [arg] of h.upsert.mock.calls as any[]) expect(arg.where.playerId_sportType_gameId.playerId).toMatch(/^pim-/)
  })

  it.each(['NHL', 'MLB'] as const)('writes and rescores a %s live-box fixture', async (sport) => {
    const fixture = JSON.parse(readFileSync(path.join(process.cwd(), 'contracts', 'rolling-insights', 'fixtures', `live.${sport}.json`), 'utf8'))
    const ids = new Set<string>()
    for (const game of fixture.data[sport]) {
      for (const side of ['home_team', 'away_team']) {
        for (const group of Object.values(game.player_box?.[side] ?? {})) {
          for (const id of Object.keys(group as object)) ids.add(id)
        }
      }
    }
    h.identities = [...ids].map((id) => ({ id: `pim-${id}`, rollingInsightsId: id }))
    h.games = [{ sport, startTime: TIPOFF, status: 'scheduled' }]
    h.seasons = [{ id: `season-${sport.toLowerCase()}`, sport, status: 'in_season' }]
    const out = await runDailySportLiveTick({ sports: [sport], now: NOW, fetchImpl: fetchBy(() => json(fixture)), clock })
    expect(out.sports[sport]?.status).toBe('written')
    expect(out.sports[sport]?.linesWritten).toBeGreaterThan(0)
    expect(h.sync).toHaveBeenCalledWith(expect.objectContaining({ seasonId: `season-${sport.toLowerCase()}` }))
    expect(h.recalc).toHaveBeenCalled()
  })

  it('respects the cadence between invocations (state is in the DB, so it holds across replicas)', async () => {
    const fetchImpl = fetchBy(() => json(fixtureBody))
    await runDailySportLiveTick({ sports: ['NBA'], now: NOW, fetchImpl, clock, intervalMs: 180_000 })
    const again = await runDailySportLiveTick({
      sports: ['NBA'],
      now: new Date(NOW.getTime() + 60_000),
      fetchImpl,
      clock,
      intervalMs: 180_000,
    })
    expect(calls).toHaveLength(1)
    expect(again.sports.NBA?.status).toBe('cadence')

    await runDailySportLiveTick({ sports: ['NBA'], now: new Date(NOW.getTime() + 181_000), fetchImpl, clock, intervalMs: 180_000 })
    expect(calls).toHaveLength(2)
  })

  it('stops at the shared run budget before starting the next sport', async () => {
    h.games.push({ sport: 'NHL', startTime: TIPOFF, status: 'scheduled' })
    let spent = false
    const out = await runDailySportLiveTick({
      sports: ['NBA', 'NHL'],
      now: NOW,
      fetchImpl: fetchBy(() => {
        spent = true
        return json(fixtureBody)
      }),
      clock,
      shouldStop: () => spent,
    })
    expect(out.sports.NHL?.status).toBe('deferred')
    expect(calls.every((c) => c.path.endsWith('/NBA'))).toBe(true)
  })
})

describe('the US Eastern date', () => {
  it('keys /live on the Eastern day of the game, not the UTC day of the poll', async () => {
    await runDailySportLiveTick({ sports: ['NBA'], now: NOW, fetchImpl: fetchBy(() => json(fixtureBody)), clock })
    expect(calls[0]!.path).toMatch(/\/live\/2026-10-20\/NBA$/)
    expect(calls[0]!.path).not.toContain('2026-10-21')
  })

  it('a slate that straddles Eastern midnight polls both Eastern days', () => {
    const dates = liveGameEasternDates(
      [
        { startTime: new Date('2026-10-21T02:30:00Z'), status: 'in progress' }, // 22:30 ET on 10-20
        { startTime: new Date('2026-10-21T04:05:00Z'), status: 'in progress' }, // 00:05 ET on 10-21
      ],
    )
    expect(dates).toEqual(['2026-10-20', '2026-10-21'])
  })
})

describe('the 304 rule — through the real transport', () => {
  it('retries a 304 once with a FRESH millisecond buster, then uses the 200', async () => {
    const out = await runDailySportLiveTick({
      sports: ['NBA'],
      now: NOW,
      fetchImpl: fetchBy((_t, n) => (n === 1 ? notModified() : json(fixtureBody))),
      clock,
    })
    expect(calls).toHaveLength(2)
    expect(calls[0]!.buster).not.toBe(calls[1]!.buster)
    expect(calls[0]!.token).toBe(calls[1]!.token)
    expect(out.sports.NBA?.status).toBe('written')
  })

  it('a 304 that survives every retry writes NOTHING and keeps the previous state', async () => {
    // First poll: real data, establishes state.
    await runDailySportLiveTick({ sports: ['NBA'], now: NOW, fetchImpl: fetchBy(() => json(fixtureBody)), clock })
    const key = `${DAILY_LIVE_STATE_PREFIX}NBA:2026-10-20`
    const before = JSON.stringify((h.cache.get(key)!.data as any).payloadHash)
    h.upsert.mockClear()
    h.sync.mockClear()

    const out = await runDailySportLiveTick({
      sports: ['NBA'],
      now: new Date(NOW.getTime() + 600_000),
      fetchImpl: fetchBy(() => notModified()),
      clock,
    })
    expect(out.sports.NBA?.status).toBe('not_modified')
    expect(h.upsert).not.toHaveBeenCalled()
    expect(h.sync).not.toHaveBeenCalled()
    // Not "no games": the hash is left alone, so the next 200 is compared with real data.
    expect(JSON.stringify((h.cache.get(key)!.data as any).payloadHash)).toBe(before)
  })
})

describe('both Rolling Insights accounts are tried', () => {
  it('NBA prefers TOKEN2, and falls through to the first account when TOKEN2 304s through its retry', async () => {
    const out = await runDailySportLiveTick({
      sports: ['NBA'],
      now: NOW,
      fetchImpl: fetchBy((token) => (token === SECONDARY ? notModified() : json(fixtureBody))),
      clock,
    })
    expect(calls.map((c) => c.token)).toEqual([SECONDARY, SECONDARY, PRIMARY])
    expect(out.sports.NBA?.status).toBe('written')
    expect(out.sports.NBA?.credential).toBe('primary')
  })

  it('with only the first token set, NBA is still attempted rather than reported unavailable', async () => {
    delete process.env.ROLLING_INSIGHTS_RSC_TOKEN2
    await runDailySportLiveTick({ sports: ['NBA'], now: NOW, fetchImpl: fetchBy(() => json(fixtureBody)), clock })
    expect(calls.map((c) => c.token)).toEqual([PRIMARY])
  })
})

describe('change detection by payload hash, never by HTTP status', () => {
  it('an identical 200 payload is a no-op: no upsert and no rescore', async () => {
    const fetchImpl = fetchBy(() => json(fixtureBody))
    await runDailySportLiveTick({ sports: ['NBA'], now: NOW, fetchImpl, clock })
    h.upsert.mockClear()
    h.sync.mockClear()
    h.recalc.mockClear()

    const out = await runDailySportLiveTick({ sports: ['NBA'], now: new Date(NOW.getTime() + 600_000), fetchImpl, clock })
    expect(calls).toHaveLength(2)
    expect(out.sports.NBA?.status).toBe('unchanged')
    expect(h.upsert).not.toHaveBeenCalled()
    expect(h.sync).not.toHaveBeenCalled()
    expect(h.recalc).not.toHaveBeenCalled()
  })

  it('a payload with ONE changed line writes exactly that line', async () => {
    await runDailySportLiveTick({ sports: ['NBA'], now: NOW, fetchImpl: fetchBy(() => json(fixtureBody)), clock })
    const firstWrite = h.upsert.mock.calls.length
    expect(firstWrite).toBeGreaterThan(1)
    h.upsert.mockClear()

    const out = await runDailySportLiveTick({
      sports: ['NBA'],
      now: new Date(NOW.getTime() + 600_000),
      fetchImpl: fetchBy(() => json(fixtureWithOneChange())),
      clock,
    })
    expect(out.sports.NBA?.status).toBe('written')
    expect(h.upsert).toHaveBeenCalledTimes(1)
  })
})

describe('matchup totals update from the new daily stats', () => {
  it('rescores only the changed sport, AFTER its stats are written: sync then matchup recalculation', async () => {
    const out = await runDailySportLiveTick({ sports: ['NBA'], now: NOW, fetchImpl: fetchBy(() => json(fixtureBody)), clock })

    expect(h.sync).toHaveBeenCalledTimes(1)
    expect(h.sync.mock.calls[0]![0]).toMatchObject({ seasonId: 'season-nba', week: 1 })
    expect(h.recalc).toHaveBeenCalledWith('season-nba', 1)
    // NHL had no game and no new rows — its season is not touched.
    expect(h.sync.mock.calls.some(([a]: any[]) => a.seasonId === 'season-nhl')).toBe(false)

    const lastUpsert = h.order.lastIndexOf('upsert')
    expect(h.order.indexOf('sync:season-nba')).toBeGreaterThan(lastUpsert)
    expect(h.order.indexOf('recalc:season-nba')).toBeGreaterThan(h.order.indexOf('sync:season-nba'))
    expect(out.seasonsRescored).toBe(1)
    expect(out.matchupsRecalculated).toBe(3)
  })

  it('a sealed week is not reopened by the live tick', async () => {
    h.sealed.mockResolvedValue(true)
    await runDailySportLiveTick({ sports: ['NBA'], now: NOW, fetchImpl: fetchBy(() => json(fixtureBody)), clock })
    expect(h.sync).not.toHaveBeenCalled()
    expect(h.recalc).not.toHaveBeenCalled()
  })
})

describe('the token never leaves the transport', () => {
  it('appears in no log line and no outcome, even when the provider fails', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const out = await runDailySportLiveTick({
      sports: ['NBA'],
      now: NOW,
      fetchImpl: (async (input: RequestInfo | URL) => {
        throw new Error(`connect ECONNREFUSED ${String(input)}`)
      }) as typeof fetch,
      clock,
    })
    const everything = JSON.stringify(out) + spies.map((s) => JSON.stringify(s.mock.calls)).join('')
    expect(everything).not.toContain(PRIMARY)
    expect(everything).not.toContain(SECONDARY)
    // No full request URL either, redacted or not — CLAUDE.md: never log a full request URL.
    expect(everything).not.toMatch(/https?:\/\//)
    expect(out.sports.NBA?.status).toBe('error')
    for (const s of spies) s.mockRestore()
  })
})
