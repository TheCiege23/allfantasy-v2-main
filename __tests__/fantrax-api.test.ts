import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getFantraxLeagues,
  getFantraxLeagueInfo,
  getFantraxPlayerIds,
  getFantraxStandings,
  flattenFantraxSchedule,
  getFantraxTeamRosters,
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
   * ⚠ NO SCORES, AND NO ZEROS STANDING IN FOR THEM. getLeagueInfo carries
   * fixtures, not results; a stored 0-0 is indistinguishable from a real
   * scoreless tie.
   */
  it('carries no score fields at all', () => {
    const rows = flattenFantraxSchedule(infoWith({ matchups: TWO_PERIODS }))
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['awayTeam', 'homeTeam', 'isPlayoff', 'week'])
    }
  })

  it('returns nothing rather than throwing when the league has no schedule', () => {
    expect(flattenFantraxSchedule(infoWith({}))).toEqual([])
    expect(flattenFantraxSchedule(infoWith({ matchups: null }))).toEqual([])
  })
})
