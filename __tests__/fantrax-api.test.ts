import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getFantraxLeagues,
  getFantraxLeagueInfo,
  getFantraxPlayerIds,
  getFantraxStandings,
  flattenFantraxSchedule,
  getFantraxTeamRosters,
  getFantraxMatchupScores,
  resolveFantraxSeasonPosition,
  applyFantraxScores,
  fetchFantraxScheduleWithScores,
  resolveRosters,
} from '@/lib/league-import/fantrax/fantraxApi'

/**
 * ⚠ FANTRAX ANSWERS HTTP 200 FOR ERRORS. A missing league returns
 * `200 {"error":{"message":"Invalid 'leagueId' parameter - league ID: x not found"}}`,
 * so `res.ok` is TRUE and a client that checks only the status imports an empty
 * league and reports success. Every shape below is one this API actually
 * produced against the live service on 2026-08-26.
 */

const NOT_FOUND_BODY = JSON.stringify({
  error: { onScreen: false, code: 'WARNING', message: "Invalid 'leagueId' parameter - league ID: nope not found" },
})

function resp(status: number, body: string) {
  return { ok: status >= 200 && status < 300, status, text: async () => body }
}

afterEach(() => vi.unstubAllGlobals())

async function loadIsolated() {
  return import('@/lib/league-import/fantrax/fantraxApi')
}


describe('a 200 carrying an error is not a league', () => {
  it('treats the 200-with-error body as not_found, not as success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, NOT_FOUND_BODY)))
    const res = await getFantraxLeagueInfo('nope')

    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.failure.kind).toBe('not_found')
    expect(res.failure.message).toMatch(/not found/i)
  })

  /**
   * ⚠ An uppercased id returns HTTP 400 with a web page, so JSON.parse throws
   * rather than yielding an error object. League ids are case-sensitive.
   */
  it('an HTML response is reported as such, and names the case-sensitivity', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(400, '<!DOCTYPE html>\n<html>...')))
    const res = await getFantraxLeagueInfo('V2KZEDYPMM8JP61B')

    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.failure.kind).toBe('not_json')
    expect(res.failure.message).toMatch(/case-sensitive/i)
  })

  it('a real league resolves', async () => {
    const body = JSON.stringify({ leagueName: 'My C2C League', seasonYear: 2026, teamInfo: { a: { id: 'a', name: 'T' } } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, body)))
    const res = await getFantraxLeagueInfo('v2kzedypmm8jp61b')

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.leagueName).toBe('My C2C League')
  })

  it('a network failure is reported rather than swallowed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))
    const res = await getFantraxLeagueInfo('x')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.failure.kind).toBe('network')
  })
})

describe('rosters', () => {
  const ROSTERS = {
    t1: { teamName: 'Ciege82', rosterItems: [{ id: '05z2o', position: 'WR', status: 'ACTIVE' }] },
  }

  it('accepts both the nested and flat payload shapes', async () => {
    for (const body of [JSON.stringify({ rosters: ROSTERS }), JSON.stringify(ROSTERS)]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, body)))
      const res = await getFantraxTeamRosters('v2kzedypmm8jp61b')
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(Object.keys(res.data)).toEqual(['t1'])
    }
  })

  /**
   * ⚠ Guessing one shape and getting {} back would look exactly like a league
   * with no rosters, which is why empty is an explicit failure.
   */
  it('no teams is a failure, not an empty league', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, '{}')))
    const res = await getFantraxTeamRosters('v2kzedypmm8jp61b')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.failure.message).toMatch(/no team rosters/i)
  })
})

describe('player map', () => {
  it('an empty map is a failure rather than a league of unknown players', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, '{}')))
    const res = await getFantraxPlayerIds('CFB')
    expect(res.ok).toBe(false)
  })

  it('resolves a populated map', async () => {
    const map = { '05z2o': { fantraxId: '05z2o', name: 'Sparks, Beau', team: 'TxSt', position: 'WR' } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, JSON.stringify(map))))
    const res = await getFantraxPlayerIds('CFB')
    expect(res.ok).toBe(true)
  })
})

describe('joining rosters to the player map', () => {
  const rosters = {
    t1: {
      teamName: 'Ciege82',
      rosterItems: [
        { id: 'known', position: 'WR', status: 'ACTIVE' },
        { id: 'missing', position: 'RB', status: 'RESERVE' },
      ],
    },
  }
  const map = { known: { fantraxId: 'known', name: 'Sparks, Beau', team: 'TxSt', position: 'WR' } }

  /**
   * ⚠ Measured 96% (447/466) on the real league — about one player in twenty is
   * not in the map. Dropping them would silently shrink every roster.
   */
  it('keeps an unresolved player with a null name rather than dropping him', () => {
    const [team] = resolveRosters(rosters, map)
    expect(team.players).toHaveLength(2)
    expect(team.players[1].name).toBeNull()
    expect(team.players[1].fantraxId).toBe('missing')
  })

  it('reports how many it could name, so partial resolution is visible', () => {
    const [team] = resolveRosters(rosters, map)
    expect(team.resolved).toBe(1)
    expect(team.total).toBe(2)
    expect(team.teamName).toBe('Ciege82')
  })

  /**
   * ⚠ College rosters resolved against the NFL map returned 0 of 38 on the real
   * league. Wrong map looks exactly like an empty league.
   */
  it('the wrong sport map resolves nothing, which must stay visible', () => {
    const [team] = resolveRosters(rosters, {})
    expect(team.resolved).toBe(0)
    expect(team.total).toBe(2)
  })
})

describe('league discovery from a Secret ID', () => {
  /**
   * ⚠ THE THIRD FAILURE SHAPE. getLeagueInfo answers 200-with-error for a bad
   * league id and 400-with-HTML for a miscased one. getLeagues answers
   * `HTTP 200 {}` for a bad Secret ID — no error object at all. Verified against
   * the live service with an unknown, a fake and an empty id: all three.
   *
   * So an empty result must NOT be reported as "you own no leagues", which would
   * tell a user with a typo that their account is empty.
   */
  it('an empty response is reported as ambiguous, not as an empty account', async () => {
    const { getFantraxLeagues } = await loadIsolated()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, '{}')))
    const res = await getFantraxLeagues('probably-wrong')

    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.failure.message).toMatch(/either the Secret ID is wrong or the account owns no leagues/i)
    expect(res.failure.message).toMatch(/cannot tell which/i)
  })

  it('never echoes the Secret ID back in a failure message', async () => {
    const SECRET = 'my-secret-id-value'
    const { getFantraxLeagues } = await loadIsolated()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, '{}')))
    const res = await getFantraxLeagues(SECRET)
    if (res.ok) return
    expect(res.failure.message).not.toContain(SECRET)
  })

  it('requires a Secret ID before making any request', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const { getFantraxLeagues } = await loadIsolated()
    const res = await getFantraxLeagues('   ')
    expect(res.ok).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it('parses leagues from the flat, nested and array shapes', async () => {
    const one = { leagueId: 'abc123', leagueName: 'Cream Bowl', teamIds: ['t1'], teamNames: ['Ciege82'] }
    for (const body of [
      JSON.stringify({ k: one }),
      JSON.stringify({ leagues: [one] }),
      JSON.stringify([one]),
    ]) {
      const { getFantraxLeagues } = await loadIsolated()
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, body)))
      const res = await getFantraxLeagues('ok')
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(res.data[0].leagueId).toBe('abc123')
      expect(res.data[0].teamNames).toEqual(['Ciege82'])
    }
  })

  it('drops entries with no league id rather than emitting a blank row', async () => {
    const { getFantraxLeagues } = await loadIsolated()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, JSON.stringify({
      a: { leagueId: 'good', leagueName: 'Real' },
      b: { leagueName: 'No id here' },
    }))))
    const res = await getFantraxLeagues('ok')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.map((l) => l.leagueId)).toEqual(['good'])
  })
})


/**
 * ⚠ THE RANK WAS ARRAY POSITION UNTIL THIS ENDPOINT WAS WIRED UP. `getStandings`
 * was in the documented endpoint list and never called, so teams were numbered
 * 1..N in whatever order `getTeamRosters` returned them and every record was
 * hardcoded 0-0. Measured on a real league: Fantrax ranks Connor0488 first and
 * roster order ranked Scorescotty first — the table looked authoritative and
 * disagreed with the league it described.
 *
 * The bodies below are the live shape, captured 2026-08-27.
 */
const STANDINGS_BODY = JSON.stringify([
  { teamName: 'Connor0488', totalPointsFor: 0.0, teamId: 'i28mu4homm8jp61f', gamesBack: 0.0, rank: 1, points: '0-0-0', winPercentage: 0.0 },
  { teamName: 'loganhall', totalPointsFor: 812.5, teamId: '08i745zzmm8jp61f', gamesBack: 1.0, rank: 2, points: '9-4-1', winPercentage: 0.679 },
])

describe('standings', () => {
  it('reads the real rank rather than the order teams arrived in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, STANDINGS_BODY)))
    const res = await getFantraxStandings('abc')

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.map((r) => [r.teamName, r.rank])).toEqual([
      ['Connor0488', 1],
      ['loganhall', 2],
    ])
  })

  /**
   * ⚠ THE RECORD ARRIVES AS ONE STRING IN A FIELD CALLED `points`. Reading it as
   * a number gives NaN; reading `winPercentage` instead loses the count.
   */
  it('splits the "W-L-T" string out of the field called points', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, STANDINGS_BODY)))
    const res = await getFantraxStandings('abc')

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data[1]).toMatchObject({ wins: 9, losses: 4, ties: 1, pointsFor: 812.5 })
  })

  /** The durable id, so a team rename does not create a new team. */
  it("keeps Fantrax's own team id", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, STANDINGS_BODY)))
    const res = await getFantraxStandings('abc')
    expect(res.ok && res.data[0].teamId).toBe('i28mu4homm8jp61f')
  })

  it('reports an empty table as a failure rather than as a league with no teams', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, '[]')))
    const res = await getFantraxStandings('abc')
    expect(res.ok).toBe(false)
  })

  /** Same 200-carrying-an-error trap as every other endpoint. */
  it('treats a 200 error body as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, NOT_FOUND_BODY)))
    const res = await getFantraxStandings('nope')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.failure.kind).toBe('not_found')
  })
})


/**
 * ⚠ THE WHOLE SEASON SCHEDULE WAS SITTING IN A RESPONSE THE IMPORT ALREADY MADE.
 * `getLeagueInfo` was read for the league name and the team list and everything
 * else discarded, so every Fantrax league imported with no schedule and no
 * playoff structure while the data was in the same object.
 *
 * Shape captured live 2026-08-27: 13 periods, `playoffs.firstPlayoffPeriod` 11,
 * `lastRegularSeasonPeriod` 10. Verified end to end on that league — 60
 * fixtures, 12 teams, 10 games each, all resolving to real rosters.
 */
function infoWith(overrides: Record<string, unknown>) {
  return {
    leagueName: 'Cream Bowl',
    seasonYear: 2026,
    draftType: null,
    ppr: null,
    startDate: null,
    endDate: null,
    teamInfo: {},
    playerInfo: {},
    rosterInfo: {},
    ...overrides,
  } as Parameters<typeof flattenFantraxSchedule>[0]
}

const TWO_PERIODS = [
  {
    period: 1,
    matchupList: [
      { away: { name: 'loganhall', id: 'a' }, home: { name: 'Yourdyinggrandpa', id: 'b' } },
      { away: { name: 'Team JMasc', id: 'c' }, home: { name: 'Connor0488', id: 'd' } },
    ],
  },
  {
    period: 11,
    matchupList: [{ away: { name: 'Ciege82', id: 'e' }, home: { name: 'rfasti', id: 'f' } }],
  },
]

describe('the schedule that was being thrown away', () => {
  it('flattens every period into one row per pairing', () => {
    const rows = flattenFantraxSchedule(infoWith({ matchups: TWO_PERIODS }))
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ week: 1, awayTeam: 'loganhall', homeTeam: 'Yourdyinggrandpa' })
  })

  /** Real structure, not "which weeks happen to carry a flag". */
  it("flags playoff weeks from the league's own first playoff period", () => {
    const rows = flattenFantraxSchedule(
      infoWith({ matchups: TWO_PERIODS, playoffs: { used: true, firstPlayoffPeriod: 11 } }),
    )
    expect(rows.filter((r) => r.isPlayoff).map((r) => r.week)).toEqual([11])
  })

  /**
   * ⚠ A LEAGUE WITH PLAYOFFS TURNED OFF HAS NO PLAYOFF WEEKS, however late the
   * period number runs.
   */
  it('flags nothing when the league does not use playoffs', () => {
    const rows = flattenFantraxSchedule(
      infoWith({ matchups: TWO_PERIODS, playoffs: { used: false, firstPlayoffPeriod: 11 } }),
    )
    expect(rows.some((r) => r.isPlayoff)).toBe(false)
  })

  /**
   * ⚠ A BYE IS SKIPPED, NOT HALF-STORED. Writing a pairing with one empty side
   * resolves to no team and reads as a corrupt fixture.
   */
  it('skips a pairing missing a side', () => {
    const rows = flattenFantraxSchedule(
      infoWith({
        matchups: [
          { period: 1, matchupList: [{ away: { name: 'loganhall' }, home: null }, { away: {}, home: { name: 'rfasti' } }] },
        ],
      }),
    )
    expect(rows).toEqual([])
  })

  /**
   * ⚠ NO SCORES FROM THIS CALL, AND NO ZEROS STANDING IN FOR THEM.
   * getLeagueInfo carries fixtures, not results; a stored 0-0 is
   * indistinguishable from a real scoreless tie, so the score fields exist and
   * are NULL rather than being absent or defaulted.
   */
  it('leaves scores null rather than zero', () => {
    const rows = flattenFantraxSchedule(infoWith({ matchups: TWO_PERIODS }))
    for (const row of rows) {
      expect(row.awayScore).toBeNull()
      expect(row.homeScore).toBeNull()
      expect(row.played).toBe(false)
    }
  })

  /**
   * ⚠ THE NAMES ARE NOT A KEY. Scores come from a different endpoint and are
   * matched back on team id, so the ids have to survive the flatten.
   */
  it('carries the team ids the results endpoint keys on', () => {
    const rows = flattenFantraxSchedule(infoWith({ matchups: TWO_PERIODS }))
    expect(rows[0]).toMatchObject({ awayTeamId: 'a', homeTeamId: 'b' })
  })

  it('returns nothing rather than throwing when the league has no schedule', () => {
    expect(flattenFantraxSchedule(infoWith({}))).toEqual([])
    expect(flattenFantraxSchedule(infoWith({ matchups: null }))).toEqual([])
  })
})

/**
 * The results endpoint that was listed and never implemented.
 *
 * `getMatchupScores` sat in FANTRAX_ENDPOINTS with nothing calling it, so every
 * Fantrax league imported a full fixture list carrying no score anywhere. That
 * is the single cause of "no week has been scored yet", "we cannot tell which
 * week this league is in yet", and a standings table where every record is 0-0.
 *
 * Every shape below was captured live against Cream Bowl (v2kzedypmm8jp61b) on
 * 2026-08-30 — two days before its period 1 opens, which is exactly the state
 * that makes the bug invisible.
 */
describe('getMatchupScores — the endpoint nothing called', () => {
  /** Live shape, trimmed of the `categories` array the reader does not use. */
  const PERIOD_1 = JSON.stringify({
    period: 1,
    matchups: [
      {
        away: { teamName: 'loganhall', score: 0.0, gamesPlayed: 0, teamId: 'a' },
        categories: [{ name: 'Passing Yards', away: {}, home: {} }],
        home: { teamName: 'Yourdyinggrandpa', score: 0.0, gamesPlayed: 0, teamId: 'b' },
      },
    ],
  })

  it('parses a period into id-keyed sides', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, PERIOD_1)))
    const res = await getFantraxMatchupScores('v2kzedypmm8jp61b', 1)

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.period).toBe(1)
    expect(res.data.matchups).toHaveLength(1)
    expect(res.data.matchups[0].away).toEqual({
      teamId: 'a',
      teamName: 'loganhall',
      score: 0,
      gamesPlayed: 0,
    })
  })

  /**
   * ⚠ OMITTING `period` ASKS FOR THE CURRENT ONE AND THE ANSWER SAYS WHICH.
   * Assuming the response is period 1 because that is what came back today
   * would silently mis-file every result once the season is under way.
   */
  it('reads the period back from the response rather than assuming it', async () => {
    const body = JSON.stringify({ period: 7, matchups: [] })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, body)))
    const res = await getFantraxMatchupScores('v2kzedypmm8jp61b')

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.period).toBe(7)
  })

  /**
   * ⚠ AN OUT-OF-RANGE PERIOD IS AN HTTP 200 WITH AN ERROR BODY. Live:
   * "Invalid 'period' parameter - period 99 not found". Reported as a failure,
   * never as a period that legitimately holds no matchups — which is what a
   * status-only check would have made of it.
   */
  it('a 200-with-error period is a failure, not an empty week', async () => {
    const body = JSON.stringify({
      error: {
        onScreen: false,
        code: 'WARNING',
        message: "Invalid 'period' parameter - period 99 not found.",
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, body)))
    const res = await getFantraxMatchupScores('v2kzedypmm8jp61b', 99)

    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.failure.message).toMatch(/period 99 not found/i)
  })

  it('drops a half-read pairing rather than storing it against one side', async () => {
    const body = JSON.stringify({
      period: 1,
      matchups: [{ away: { teamName: 'x', score: 10, gamesPlayed: 1, teamId: 'a' }, home: null }],
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, body)))
    const res = await getFantraxMatchupScores('v2kzedypmm8jp61b', 1)

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.matchups).toEqual([])
  })
})

/**
 * ⚠ THE LEAGUE'S OWN CALENDAR ANSWERS THIS, NOT THE SPORT'S. This repo has
 * already shipped "you are here · week 3" read off the next real-world kickoff,
 * which happened to be NFL preseason.
 */
describe('where the league is in its own season', () => {
  const PERIODS = [
    { number: 1, startDate: '2026-09-01T12:00:00.0-0400', endDate: '2026-09-08T11:59:59.0-0400' },
    { number: 2, startDate: '2026-09-08T12:00:00.0-0400', endDate: '2026-09-15T11:59:59.0-0400' },
    { number: 3, startDate: '2026-09-15T12:00:00.0-0400', endDate: '2026-09-22T11:59:59.0-0400' },
  ]

  it('before the first period opens there is no current week, and nothing to score', () => {
    const at = resolveFantraxSeasonPosition(
      infoWith({ scoringPeriods: PERIODS }),
      new Date('2026-08-30T12:00:00Z'),
    )
    expect(at).toEqual({ period: 1, state: 'preseason', scoredThrough: 0 })
  })

  it('inside a period, that period is current', () => {
    const at = resolveFantraxSeasonPosition(
      infoWith({ scoringPeriods: PERIODS }),
      new Date('2026-09-10T12:00:00Z'),
    )
    expect(at).toMatchObject({ period: 2, state: 'in_progress', scoredThrough: 2 })
  })

  it('after the last period the season is complete, not stuck on week 1', () => {
    const at = resolveFantraxSeasonPosition(
      infoWith({ scoringPeriods: PERIODS }),
      new Date('2027-01-01T12:00:00Z'),
    )
    expect(at).toMatchObject({ period: 3, state: 'complete', scoredThrough: 3 })
  })

  it('reports nothing rather than guessing when the league publishes no calendar', () => {
    expect(resolveFantraxSeasonPosition(infoWith({}), new Date())).toBeNull()
  })
})

/**
 * 🛑 THE ONE THAT MATTERS. Fantrax reports `score: 0.0` for a period that has
 * not been played, byte-identical to a genuine scoreless week — `gamesPlayed`
 * is the only thing separating them. Writing the unplayed one as 0-0 produces
 * exactly the "every record is 0-0" table this repo has already been burnt by.
 */
describe('merging results onto fixtures', () => {
  const FIXTURES = [
    {
      week: 1,
      awayTeam: 'loganhall',
      homeTeam: 'Yourdyinggrandpa',
      awayTeamId: 'a',
      homeTeamId: 'b',
      awayScore: null,
      homeScore: null,
      played: false,
      isPlayoff: false,
    },
  ]

  it('leaves an unplayed period unscored rather than writing 0-0', () => {
    const merged = applyFantraxScores(FIXTURES, [
      {
        period: 1,
        matchups: [
          {
            away: { teamId: 'a', teamName: 'loganhall', score: 0, gamesPlayed: 0 },
            home: { teamId: 'b', teamName: 'Yourdyinggrandpa', score: 0, gamesPlayed: 0 },
          },
        ],
      },
    ])
    expect(merged[0]).toMatchObject({ awayScore: null, homeScore: null, played: false })
  })

  /** A real scoreless tie IS stored — that is the whole point of the split. */
  it('stores a genuine 0-0 once games have been played', () => {
    const merged = applyFantraxScores(FIXTURES, [
      {
        period: 1,
        matchups: [
          {
            away: { teamId: 'a', teamName: 'loganhall', score: 0, gamesPlayed: 3 },
            home: { teamId: 'b', teamName: 'Yourdyinggrandpa', score: 0, gamesPlayed: 2 },
          },
        ],
      },
    ])
    expect(merged[0]).toMatchObject({ awayScore: 0, homeScore: 0, played: true })
  })

  it('carries real scores through', () => {
    const merged = applyFantraxScores(FIXTURES, [
      {
        period: 1,
        matchups: [
          {
            away: { teamId: 'a', teamName: 'loganhall', score: 118.4, gamesPlayed: 8 },
            home: { teamId: 'b', teamName: 'Yourdyinggrandpa', score: 96.2, gamesPlayed: 8 },
          },
        ],
      },
    ])
    expect(merged[0]).toMatchObject({ awayScore: 118.4, homeScore: 96.2, played: true })
  })

  /**
   * ⚠ ORIENTATION IS NOT GUARANTEED TO MATCH. Fantrax may report the pairing
   * home/away the other way round from the fixture; attaching the scores by
   * position would swap both teams' weeks.
   */
  it('matches a flipped pairing and keeps each score on its own team', () => {
    const merged = applyFantraxScores(FIXTURES, [
      {
        period: 1,
        matchups: [
          {
            away: { teamId: 'b', teamName: 'Yourdyinggrandpa', score: 96.2, gamesPlayed: 8 },
            home: { teamId: 'a', teamName: 'loganhall', score: 118.4, gamesPlayed: 8 },
          },
        ],
      },
    ])
    expect(merged[0]).toMatchObject({ awayScore: 118.4, homeScore: 96.2 })
  })

  it('leaves a fixture alone when no period was read for its week', () => {
    expect(applyFantraxScores(FIXTURES, [])).toEqual(FIXTURES)
  })
})

describe('fetching fixtures and results together', () => {
  const PERIODS = [
    { number: 1, startDate: '2026-09-01T12:00:00.0-0400', endDate: '2026-09-08T11:59:59.0-0400' },
    { number: 2, startDate: '2026-09-08T12:00:00.0-0400', endDate: '2026-09-15T11:59:59.0-0400' },
  ]
  const MATCHUPS = [
    { period: 1, matchupList: [{ away: { name: 'loganhall', id: 'a' }, home: { name: 'Ydg', id: 'b' } }] },
    { period: 2, matchupList: [{ away: { name: 'Ydg', id: 'b' }, home: { name: 'loganhall', id: 'a' } }] },
  ]

  /**
   * ⚠ A PRESEASON LEAGUE COSTS ZERO EXTRA REQUESTS. getMatchupScores is one
   * round trip per period; asking a 13-period league for all of them in August
   * spends thirteen requests to learn thirteen times that nothing has happened.
   */
  it('asks for no periods at all before the season opens', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const out = await fetchFantraxScheduleWithScores(
      'v2kzedypmm8jp61b',
      infoWith({ matchups: MATCHUPS, scoringPeriods: PERIODS }),
      { now: new Date('2026-08-30T12:00:00Z') },
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(out.periodsRead).toBe(0)
    expect(out.position?.state).toBe('preseason')
    expect(out.rows).toHaveLength(2)
    expect(out.rows.every((r) => r.awayScore === null)).toBe(true)
  })

  it('asks only for periods that could have been played, and merges them', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      resp(
        200,
        JSON.stringify({
          period: 1,
          matchups: [
            {
              away: { teamId: 'a', teamName: 'loganhall', score: 101.5, gamesPlayed: 9 },
              home: { teamId: 'b', teamName: 'Ydg', score: 88.1, gamesPlayed: 9 },
            },
          ],
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const out = await fetchFantraxScheduleWithScores(
      'v2kzedypmm8jp61b',
      infoWith({ matchups: MATCHUPS, scoringPeriods: PERIODS }),
      { now: new Date('2026-09-03T12:00:00Z') },
    )

    /* Period 1 only — period 2 has not opened. */
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('period=1')
    expect(out.rows.find((r) => r.week === 1)).toMatchObject({
      awayScore: 101.5,
      homeScore: 88.1,
      played: true,
    })
    /* Week 2 was never asked for, so it stays unknown rather than 0-0. */
    expect(out.rows.find((r) => r.week === 2)).toMatchObject({ awayScore: null, played: false })
  })

  /**
   * ⚠ A PERIOD THAT FAILS TO READ IS SKIPPED, NEVER ZEROED. Reporting it as
   * 0-0 turns one transient outage into a permanently wrong week.
   */
  it('counts a failed period rather than scoring it zero', async () => {
    const body = JSON.stringify({ error: { message: 'Fantrax is having a moment' } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, body)))
    const out = await fetchFantraxScheduleWithScores(
      'v2kzedypmm8jp61b',
      infoWith({ matchups: MATCHUPS, scoringPeriods: PERIODS }),
      { now: new Date('2026-09-03T12:00:00Z') },
    )

    expect(out.periodsRead).toBe(0)
    expect(out.periodsFailed).toBe(1)
    expect(out.rows.every((r) => r.awayScore === null && r.played === false)).toBe(true)
  })
})
