import { describe, expect, it } from 'vitest'
import { RollingInsightsLiveProvider } from '@/lib/live/rollingInsightsLiveProvider'

const PAYLOAD = {
  data: {
    NFL: [
      {
        game_ID: 'G1',
        game_status: 'In Progress',
        // Required: the provider defaults to preseason-only scope.
        season_type: 'Preseason',
        away_team_name: 'Washington Commanders',
        home_team_name: 'Miami Dolphins',
        full_box: {
          current: { Quarter: 'Q2', RedZone: true },
          away_team: { abbrv: 'WAS', score: 13, team_stats: { sacks: 3, defense_touchdowns: 1, points_against_defense_special_teams: 16 } },
          home_team: { abbrv: 'MIA', score: 10, team_stats: { sacks: 1, defense_touchdowns: 0, points_against_defense_special_teams: 13 } },
        },
        player_box: {
          away_team: { '8735': { player: 'RB One', position: 'RB', rushing_touchdowns: 1, rushing_yards: 58 } },
          home_team: { '143': { player: 'QB One', position: 'QB', passing_yards: 213 } },
        },
      },
    ],
  },
}

function providerWith(responses: Array<{ status: number; body?: unknown }>) {
  let i = 0
  const calls: string[] = []
  const p = new RollingInsightsLiveProvider({
    token: 'test-token',
    fetchImpl: async (url: string) => {
      calls.push(url)
      const r = responses[Math.min(i++, responses.length - 1)]
      return { status: r.status, json: async () => r.body ?? null }
    },
  })
  return { p, calls }
}

const Q = { sport: 'NFL', season: 2026, week: 1 }

describe('RollingInsightsLiveProvider', () => {
  it('refuses to construct without the NFL token', () => {
    const prev = process.env.ROLLING_INSIGHTS_RSC_TOKEN
    delete process.env.ROLLING_INSIGHTS_RSC_TOKEN
    // Failing loudly beats silently 304-ing forever on the wrong credential.
    expect(() => new RollingInsightsLiveProvider({})).toThrow(/RSC_TOKEN/)
    if (prev) process.env.ROLLING_INSIGHTS_RSC_TOKEN = prev
  })

  it('always calls https, never cleartext', () => {
    const { p, calls } = providerWith([{ status: 200, body: PAYLOAD }])
    return p.fetchActiveGames(Q).then(() => {
      expect(calls[0]).toMatch(/^https:\/\//)
    })
  })

  it('returns active games from a 200', async () => {
    const { p } = providerWith([{ status: 200, body: PAYLOAD }])
    const games = await p.fetchActiveGames(Q)
    expect(games).toHaveLength(1)
    expect(games[0].gameId).toBe('G1')
  })

  it('serves the cached read on 304 instead of an empty slate', async () => {
    // An empty result would read as "no games" and silently stall scoring —
    // the opposite of what 304 means.
    const { p } = providerWith([{ status: 200, body: PAYLOAD }, { status: 304 }])
    const first = await p.fetchActiveGames(Q)
    expect(first).toHaveLength(1)
    const second = await p.fetchActiveGames(Q)
    expect(second).toHaveLength(1)
  })

  it('falls back to the last good read on a provider error', async () => {
    const { p } = providerWith([{ status: 200, body: PAYLOAD }, { status: 500 }])
    await p.fetchActiveGames(Q)
    const afterError = await p.fetchActiveGames(Q)
    expect(afterError).toHaveLength(1)
  })

  it.skip('returns NO player stats — superseded by the crosswalk', async () => {
    // Verified in production: RI 8735 is Ollie Gordon II, our sleeper:8735 is
    // Jairon McVea. RI 143 is Marcus Mariota, our sleeper:143 is John Carlson.
    // Keying stats by RI id would credit a QB's yards to a TE, silently.
    // Empty is visible; wrong is not.
    const { p } = providerWith([{ status: 200, body: PAYLOAD }])
    const games = await p.fetchActiveGames(Q)
    const stats = await p.fetchPlayerStatsForGames({ ...Q, games, playerIds: ['8735'] })
    expect(stats.size).toBe(0)
  })

  it('returns REAL team defence from full_box.team_stats', async () => {
    // This previously returned an empty map because only player_box had been
    // inspected. DEF slots would have scored zero behind a comment saying that
    // was intentional.
    const { p } = providerWith([{ status: 200, body: PAYLOAD }])
    const games = await p.fetchActiveGames(Q)
    const def = await p.fetchTeamDefenseStatsForGames({ ...Q, games })
    expect(def.size).toBe(2)
    expect(def.get('nfl:def:WAS')?.sacks).toBe(3)
    expect(def.get('nfl:def:WAS')?.defense_touchdowns).toBe(1)
    expect(def.get('nfl:def:MIA')?.points_against_defense_special_teams).toBe(13)
  })

  it('fills real team abbreviations from full_box', async () => {
    const { p } = providerWith([{ status: 200, body: PAYLOAD }])
    const games = await p.fetchActiveGames(Q)
    expect(games[0].awayTeam).toBe('WAS')
    expect(games[0].homeTeam).toBe('MIA')
  })
})

describe('preseason scope — the safe rollout lane', () => {
  const mixed = {
    data: {
      NFL: [
        {
          game_ID: 'PRE1', game_status: 'In Progress', season_type: 'Preseason',
          full_box: {
            away_team: { abbrv: 'DAL', score: 7, team_stats: { sacks: 1 } },
            home_team: { abbrv: 'SEA', score: 3, team_stats: { sacks: 2 } },
          },
          player_box: { away_team: { '1': { player: 'Pre Guy', rushing_touchdowns: 1 } } },
        },
        {
          game_ID: 'REG1', game_status: 'In Progress', season_type: 'Regular Season',
          full_box: {
            away_team: { abbrv: 'KC', score: 21, team_stats: { sacks: 4 } },
            home_team: { abbrv: 'BUF', score: 17, team_stats: { sacks: 3 } },
          },
          player_box: { away_team: { '2': { player: 'Reg Guy', rushing_touchdowns: 2 } } },
        },
      ],
    },
  }

  it('defaults to preseason only — a regular-season game is invisible', () => {
    const { p } = providerWith([{ status: 200, body: mixed }])
    return p.fetchActiveGames(Q).then((games) => {
      expect(games.map((g) => g.gameId)).toEqual(['PRE1'])
    })
  })

  it.skip('returns no player stats while the crosswalk is missing — superseded', async () => {
    const { p } = providerWith([{ status: 200, body: mixed }])
    const games = await p.fetchActiveGames(Q)
    const stats = await p.fetchPlayerStatsForGames({ ...Q, games, playerIds: ['1', '2'] })
    expect(stats.size).toBe(0)
  })

  it('will not leak regular-season TEAM defence', async () => {
    const { p } = providerWith([{ status: 200, body: mixed }])
    const games = await p.fetchActiveGames(Q)
    const def = await p.fetchTeamDefenseStatsForGames({ ...Q, games })
    expect([...def.keys()].sort()).toEqual(['nfl:def:DAL', 'nfl:def:SEA'])
  })

  it('scopes BEFORE caching, so 304 cannot serve an out-of-scope game', async () => {
    // If filtering happened after the cache, the fallback path would replay
    // regular-season games the gate was supposed to exclude.
    const { p } = providerWith([{ status: 200, body: mixed }, { status: 304 }])
    await p.fetchActiveGames(Q)
    const cached = await p.fetchActiveGames(Q)
    expect(cached.map((g) => g.gameId)).toEqual(['PRE1'])
  })

  it('scope "all" opts in explicitly', async () => {
    const { p } = providerWith([{ status: 200, body: mixed }])
    const all = new (p.constructor as any)({ token: 't', scope: 'all', fetchImpl: async () => ({ status: 200, json: async () => mixed }) })
    const games = await all.fetchActiveGames(Q)
    expect(games).toHaveLength(2)
  })
})
