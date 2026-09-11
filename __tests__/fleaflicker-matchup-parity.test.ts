// @vitest-environment node
/**
 * Guards `lib/import-os/collector/fleaflickerMatchupParity.ts` — the writer
 * Fleaflicker leagues never had.
 *
 * 🛑 WHAT WAS BROKEN. Every WeeklyMatchup-backed surface (current week,
 * scoreboard, power board, season outlook) reads `WeeklyMatchup`, and nothing
 * wrote it for Fleaflicker. Sleeper has `ensureMatchupsCached`, ESPN/Yahoo got
 * `externalMatchupParity`, Fantrax got `fantraxMatchupParity`; Fleaflicker got
 * nothing.
 *
 * ⚠ `global.fetch` IS MOCKED, NOT THE FETCH SERVICE, AND THAT IS THE POINT OF
 * THIS FILE. The two behaviours most worth guarding — the silent season clamp
 * and the omitted-false boolean — both live in the boundary between the raw
 * JSON body and `fetchFleaflickerScoreboard`. Mocking that service would mock
 * away the very code under test and leave a suite that passes with the guard
 * deleted, which is the "test double that stopped doubling anything" shape
 * CLAUDE.md records.
 *
 * Bodies here are cut down from the committed fixtures
 * (`contracts/fleaflicker/fixtures/scoreboard.NFL.2021.week1.json` and
 * `...week16.json`), including the flag-omission pattern those fixtures prove.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const leagueFindMany = vi.fn()
const leagueTeamFindMany = vi.fn()
const cacheFindUnique = vi.fn()
const cacheUpsert = vi.fn()
const weeklyFindMany = vi.fn()
const weeklyDeleteMany = vi.fn()
const weeklyCreateMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: (...a: unknown[]) => leagueFindMany(...a) },
    leagueTeam: { findMany: (...a: unknown[]) => leagueTeamFindMany(...a) },
    sportsDataCache: {
      findUnique: (...a: unknown[]) => cacheFindUnique(...a),
      upsert: (...a: unknown[]) => cacheUpsert(...a),
    },
    weeklyMatchup: {
      findMany: (...a: unknown[]) => weeklyFindMany(...a),
      deleteMany: (...a: unknown[]) => weeklyDeleteMany(...a),
      createMany: (...a: unknown[]) => weeklyCreateMany(...a),
    },
  },
}))

import { runFleaflickerMatchupParity } from '@/lib/import-os/collector/fleaflickerMatchupParity'

const NOW = new Date('2026-10-01T12:00:00Z')
const LEAGUE_ID = '206154'
const SEASON = 2026

/** Real team ids from the committed fixture's league. */
const HOME = '1373501'
const AWAY = '1373393'
const HOME_2 = '1373394'
const AWAY_2 = '1373395'

function period(ordinal: number, season: number) {
  return { ordinal, value: ordinal, low: { ordinal, season, startEpochMilli: '1631008800000' } }
}

/**
 * A game row in the provider's real shape.
 *
 * ⚠ `final: false` OMITS `isFinalScore` ENTIRELY rather than setting it to
 * `false`, because that is what Fleaflicker actually does — proven per-row in
 * `contracts/fleaflicker/fixtures/scoreboard.NFL.2021.week16.json`. A fixture
 * that wrote `isFinalScore: false` would be testing a response shape the
 * provider never sends, and would let an `!== false` implementation pass.
 */
function game(
  homeId: string,
  awayId: string,
  homePts: number | null,
  awayPts: number | null,
  opts: { final?: boolean; id?: number } = {},
) {
  const row: Record<string, unknown> = {
    id: opts.id ?? 47213760,
    home: { id: Number(homeId), name: `Team ${homeId}` },
    away: { id: Number(awayId), name: `Team ${awayId}` },
  }
  if (homePts != null) row.homeScore = { score: { value: homePts, formatted: String(homePts) } }
  if (awayPts != null) row.awayScore = { score: { value: awayPts, formatted: String(awayPts) } }
  if (opts.final !== false) row.isFinalScore = true
  return row
}

type Body = Record<string, unknown>

/** Queue of responses keyed by `scoring_period` (`null` = the unparameterised head call). */
let responses: Map<number | null, Body>
let fetchCalls: string[]

function scoreboard(opts: {
  season?: number
  current?: number
  eligible?: number[]
  games?: unknown[] | undefined
}): Body {
  const season = opts.season ?? SEASON
  const current = opts.current ?? 1
  const eligible = opts.eligible ?? [1]
  const body: Body = {
    schedulePeriod: period(current, season),
    eligibleSchedulePeriods: eligible.map((o) => period(o, season)),
  }
  // `games` ABSENT, not empty, is the real pre-schedule shape — so only set it when given.
  if (opts.games !== undefined) body.games = opts.games
  return body
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchCalls = []
  responses = new Map()

  leagueFindMany.mockResolvedValue([
    { platformLeagueId: LEAGUE_ID, season: SEASON, sport: 'NFL' },
  ])
  leagueTeamFindMany.mockResolvedValue([
    { externalId: HOME },
    { externalId: AWAY },
    { externalId: HOME_2 },
    { externalId: AWAY_2 },
  ])
  cacheFindUnique.mockResolvedValue(null) // always due
  cacheUpsert.mockResolvedValue({})
  weeklyFindMany.mockResolvedValue([])
  weeklyDeleteMany.mockResolvedValue({ count: 0 })
  weeklyCreateMany.mockResolvedValue({ count: 0 })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetchCalls.push(String(url))
      const m = /scoring_period=(\d+)/.exec(String(url))
      const key = m ? Number(m[1]) : null
      const body = responses.get(key) ?? responses.get(null)
      return {
        ok: true,
        status: 200,
        json: async () => body,
      } as unknown as Response
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Every row handed to `createMany` across all calls. */
function writtenRows(): Array<Record<string, unknown>> {
  return weeklyCreateMany.mock.calls.flatMap(
    (c) => (c[0] as { data: Array<Record<string, unknown>> }).data,
  )
}

describe('fleaflicker matchup parity — writing a played week', () => {
  it('writes both sides of a final game, keyed on the provider team id', async () => {
    responses.set(
      null,
      scoreboard({ current: 1, eligible: [1], games: [game(HOME, AWAY, 120.5, 98.25)] }),
    )

    const result = await runFleaflickerMatchupParity({ now: NOW })

    expect(result.synced).toBe(1)
    expect(result.failed).toBe(0)
    const rows = writtenRows()
    expect(rows).toHaveLength(2)
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          leagueId: LEAGUE_ID,
          seasonYear: SEASON,
          week: 1,
          rosterId: HOME,
          pointsFor: 120.5,
          pointsAgainst: 98.25,
          win: 1,
        }),
        expect.objectContaining({ rosterId: AWAY, pointsFor: 98.25, pointsAgainst: 120.5, win: 0 }),
      ]),
    )
  })

  it('drops a game whose team is not in LeagueTeam rather than writing it on trust', async () => {
    responses.set(
      null,
      scoreboard({
        current: 1,
        eligible: [1],
        games: [
          game(HOME, AWAY, 120.5, 98.25),
          game(HOME_2, '999999', 100, 90, { id: 47213761 }), // 999999 is not an imported team
        ],
      }),
    )

    const result = await runFleaflickerMatchupParity({ now: NOW })

    expect(result.synced).toBe(1)
    const rosterIds = writtenRows().map((r) => r.rosterId)
    expect(rosterIds).toEqual(expect.arrayContaining([HOME, AWAY]))
    expect(rosterIds).not.toContain('999999')
    // ⚠ And the MAPPABLE half of that pairing is dropped too — a one-sided row
    // would render a matchup against nobody.
    expect(rosterIds).not.toContain(HOME_2)
  })
})

describe('fleaflicker matchup parity — the omitted-false boolean', () => {
  /*
   * 🛑 THE CONTROL THIS WHOLE BLOCK EXISTS FOR. Fleaflicker omits a false
   * boolean, so an unplayed game has NO `isFinalScore` key. An implementation
   * testing `isFinalScore !== false` would treat every such game as final and
   * write the entire future season as placeholder rows. The two tests below are
   * the same payload differing ONLY in whether that key is present, so a
   * regression to `!== false` turns the first one red.
   */
  /*
   * ⚠ THIS FIXTURE CARRIES REAL SCORES ON PURPOSE, AND THE FIRST VERSION DID
   * NOT — it passed `null, null`, so the missing-score check dropped the game
   * and the test went green with the `isFinalScore` guard MUTATED AWAY. It was
   * asserting the right outcome for the wrong reason: a check that cannot fail.
   * Caught by mutating `!== true` to `=== false` and seeing 12/12 still pass.
   *
   * An IN-PROGRESS game is the case that actually matters — a live week has
   * points on the board and no `isFinalScore` key — and it is the one an
   * `!== false` implementation would write as though the week had finished.
   */
  it('does NOT write an in-progress game (scores present, isFinalScore key absent)', async () => {
    responses.set(
      null,
      scoreboard({ current: 1, eligible: [1], games: [game(HOME, AWAY, 64.2, 51.8, { final: false })] }),
    )

    const result = await runFleaflickerMatchupParity({ now: NOW })

    expect(writtenRows()).toHaveLength(0)
    expect(result.synced).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.results[0]?.note).toMatch(/no final week/i)
  })

  it('positive control: the identical payload WITH isFinalScore: true is written', async () => {
    responses.set(
      null,
      scoreboard({ current: 1, eligible: [1], games: [game(HOME, AWAY, 111, 99, { final: true })] }),
    )

    const result = await runFleaflickerMatchupParity({ now: NOW })

    expect(result.synced).toBe(1)
    expect(writtenRows()).toHaveLength(2)
  })

  it('does not write a final game that carries no readable score', async () => {
    // Final, but both score objects absent — never observed, and inventing 0-0 would fabricate a result.
    responses.set(
      null,
      scoreboard({ current: 1, eligible: [1], games: [game(HOME, AWAY, null, null, { final: true })] }),
    )

    await runFleaflickerMatchupParity({ now: NOW })

    expect(writtenRows()).toHaveLength(0)
  })
})

describe('fleaflicker matchup parity — the silent season clamp', () => {
  /*
   * 🛑 THE BEHAVIOUR THAT MAKES THIS COLLECTOR DANGEROUS WITHOUT A GUARD.
   * Asking for a season past a league's last returns that league's LAST season
   * in full, under HTTP 200, with real final scores. Measured on league 206154
   * (last season 2021), which answers 2024, 2025, 2026 and 2099 identically.
   */
  it('refuses a body whose season is not the one requested, and writes NOTHING', async () => {
    responses.set(
      null,
      // Requested 2026; the provider answers with 2021 — a complete, plausible, played week.
      scoreboard({ season: 2021, current: 1, eligible: [1], games: [game(HOME, AWAY, 263.49, 150.2)] }),
    )

    const result = await runFleaflickerMatchupParity({ now: NOW })

    expect(writtenRows()).toHaveLength(0)
    expect(result.synced).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.failed).toBe(0) // a dormant league is a normal state, not an outage
    expect(result.results[0]?.note).toMatch(/2021/)
    expect(result.results[0]?.note).toMatch(/clamped/i)
  })

  it('positive control: the identical payload labelled with the REQUESTED season is written', async () => {
    responses.set(
      null,
      scoreboard({ season: SEASON, current: 1, eligible: [1], games: [game(HOME, AWAY, 263.49, 150.2)] }),
    )

    const result = await runFleaflickerMatchupParity({ now: NOW })

    expect(result.synced).toBe(1)
    expect(writtenRows()).toHaveLength(2)
    expect(writtenRows()[0]).toMatchObject({ seasonYear: SEASON })
  })
})

describe('fleaflicker matchup parity — periods and pre-schedule leagues', () => {
  it('reads every period up to the current one and never beyond it', async () => {
    /*
     * ⚠ THE HEAD CALL CARRIES THE CURRENT PERIOD'S OWN GAMES. Omitting
     * `scoring_period` is not a metadata-only request — it returns the current
     * period, byte-identical to asking for that period explicitly. The collector
     * reuses it instead of spending a second request, so this fixture has to
     * carry period 3's game or the test would be asserting against a response
     * shape the provider never sends.
     */
    responses.set(
      null,
      scoreboard({
        current: 3,
        eligible: [1, 2, 3, 4, 5],
        games: [game(HOME, AWAY, 103, 93, { id: 47213763 })],
      }),
    )
    for (const p of [1, 2, 3]) {
      responses.set(
        p,
        scoreboard({
          current: 3,
          eligible: [1, 2, 3, 4, 5],
          games: [game(HOME, AWAY, 100 + p, 90 + p, { id: 47213760 + p })],
        }),
      )
    }

    const result = await runFleaflickerMatchupParity({ now: NOW })

    const requested = fetchCalls
      .map((u) => /scoring_period=(\d+)/.exec(u)?.[1])
      .filter((v): v is string => v != null)
      .map(Number)
    expect(requested.sort()).toEqual([1, 2])
    // Period 3 is the current one and is served by the unparameterised head call — not re-fetched.
    expect(requested).not.toContain(3)
    // Periods 4 and 5 are in the future; a future week cannot hold a final game.
    expect(requested).not.toContain(4)
    expect(requested).not.toContain(5)
    expect(result.synced).toBe(1)
    expect(new Set(writtenRows().map((r) => r.week))).toEqual(new Set([1, 2, 3]))
  })

  it('treats a league with no games key as "nothing to write yet", not a failure', async () => {
    // The real pre-draft shape: schedulePeriod present, `games` ABSENT (not []).
    responses.set(null, scoreboard({ current: 1, eligible: [1], games: undefined }))

    const result = await runFleaflickerMatchupParity({ now: NOW })

    expect(result.failed).toBe(0)
    expect(result.skipped).toBe(1)
    expect(writtenRows()).toHaveLength(0)
  })

  it('skips a league with no LeagueTeam rows instead of writing unnameable teams', async () => {
    leagueTeamFindMany.mockResolvedValue([])
    responses.set(null, scoreboard({ current: 1, eligible: [1], games: [game(HOME, AWAY, 1, 2)] }))

    const result = await runFleaflickerMatchupParity({ now: NOW })

    expect(result.skipped).toBe(1)
    expect(writtenRows()).toHaveLength(0)
    expect(result.results[0]?.note).toMatch(/LeagueTeam/i)
    // And it never even asked the provider — the cheap check comes first.
    expect(fetchCalls).toHaveLength(0)
  })
})

describe('fleaflicker matchup parity — idempotency', () => {
  it('leaves a week untouched when the stored rows already match', async () => {
    responses.set(
      null,
      scoreboard({ current: 1, eligible: [1], games: [game(HOME, AWAY, 120.5, 98.25)] }),
    )
    weeklyFindMany.mockResolvedValue([
      { rosterId: HOME, matchupId: 1, pointsFor: 120.5, pointsAgainst: 98.25, win: 1 },
      { rosterId: AWAY, matchupId: 1, pointsFor: 98.25, pointsAgainst: 120.5, win: 0 },
    ])

    const result = await runFleaflickerMatchupParity({ now: NOW })

    expect(weeklyDeleteMany).not.toHaveBeenCalled()
    expect(weeklyCreateMany).not.toHaveBeenCalled()
    expect(result.results[0]).toMatchObject({ status: 'synced', weeksWritten: 0, weeksUnchanged: 1 })
  })

  it('rewrites the week when a score has changed', async () => {
    responses.set(
      null,
      scoreboard({ current: 1, eligible: [1], games: [game(HOME, AWAY, 121.5, 98.25)] }),
    )
    weeklyFindMany.mockResolvedValue([
      { rosterId: HOME, matchupId: 1, pointsFor: 120.5, pointsAgainst: 98.25, win: 1 },
      { rosterId: AWAY, matchupId: 1, pointsFor: 98.25, pointsAgainst: 120.5, win: 0 },
    ])

    await runFleaflickerMatchupParity({ now: NOW })

    expect(weeklyDeleteMany).toHaveBeenCalledTimes(1)
    expect(writtenRows()).toHaveLength(2)
  })
})
