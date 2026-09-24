import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }))

import {
  buildPlayerGameLogContext,
  buildPlayerSeasonStatsContext,
  buildRealStandingsContext,
  buildSeasonLeadersContext,
  LEADER_STATS,
  nameToken,
  normalizeStatsSport,
} from '@/lib/chimmy/tools/realStatsTools'

type Sql = { text: string; values: unknown[] }

/** A db whose answers are chosen by what the SQL asks for — so a wrong clause returns nothing. */
function fakeDb(route: (sql: Sql) => unknown[]) {
  const calls: Sql[] = []
  return {
    calls,
    db: {
      $queryRaw: async (s: Sql) => {
        calls.push(s)
        return route(s)
      },
    } as never,
  }
}

const CHASE_2026 = {
  playerId: 'pim-1',
  season: '2026',
  team: null,
  fetchedAt: new Date('2026-09-23T18:38:00Z'),
  stats: {
    riTeam: 'Cincinnati Bengals',
    position: 'WR',
    riPlayerName: "Ja'Marr Chase",
    postseason: null,
    regular_season: {
      targets: 13,
      receptions: 9,
      games_played: 2,
      receiving_yards: 87,
      receiving_touchdowns: 2,
      DK_fantasy_points: 89.1,
    },
  },
}

describe('normalizeStatsSport / nameToken', () => {
  it('maps the ways people name college football, and refuses other sports', () => {
    expect(normalizeStatsSport(undefined)).toBe('NFL')
    expect(normalizeStatsSport('college football')).toBe('NCAAF')
    expect(normalizeStatsSport('NCAAFB')).toBe('NCAAF')
    expect(normalizeStatsSport('MLB')).toBeNull()
  })

  it('takes the longest letter run, so apostrophes and suffixes do not break the prefilter', () => {
    expect(nameToken("Ja'Marr Chase")).toBe('Chase')
    expect(nameToken('Kenneth Walker III')).toBe('Kenneth')
  })
})

describe('get_player_season_stats', () => {
  it('reads the RI season total by name, exactly matched, with its refresh time — and hides DK points', async () => {
    const { db, calls } = fakeDb((s) => {
      if (s.text.includes('max(season)')) return [{ season: '2026' }]
      return [CHASE_2026, { ...CHASE_2026, stats: { ...CHASE_2026.stats, riPlayerName: 'Chase Young' } }]
    })

    const out = await buildPlayerSeasonStatsContext({ playerName: "Ja'Marr Chase", sport: 'NFL' }, db)

    expect(out).toContain("Ja'Marr Chase, WR, Cincinnati Bengals — NFL 2026")
    expect(out).toContain('Receiving yards: 87')
    expect(out).toContain('Receiving TDs: 2')
    expect(out).toContain('2026-09-23 18:38 UTC')
    expect(out).not.toContain('Chase Young')
    expect(out).not.toMatch(/DK|89\.1/)
    // The name reaches SQL only as a bound ILIKE parameter, against the RI name key.
    const q = calls.find((c) => c.text.includes('ILIKE'))!
    expect(q.values).toEqual(expect.arrayContaining(['NFL', 'rolling_insights', '2026', 'riPlayerName', '%Chase%']))
  })

  it('reads the CFBD `name` key for college football', async () => {
    const { db, calls } = fakeDb((s) => (s.text.includes('max(season)') ? [{ season: '2026' }] : []))
    await buildPlayerSeasonStatsContext({ playerName: 'Arch Manning', sport: 'NCAAF' }, db)
    const q = calls.find((c) => c.text.includes('ILIKE'))!
    expect(q.values).toEqual(expect.arrayContaining(['NCAAF', 'cfbd', 'name', '%Manning%']))
  })

  it('says a miss is not a zero, and offers near names rather than picking', async () => {
    const { db } = fakeDb((s) =>
      s.text.includes('max(season)') ? [{ season: '2026' }] : [{ ...CHASE_2026, stats: { ...CHASE_2026.stats, riPlayerName: 'Chase Young' } }],
    )
    const out = await buildPlayerSeasonStatsContext({ playerName: 'Chase Brown', sport: 'NFL' }, db)
    expect(out).toMatch(/No NFL 2026 season line is stored/)
    expect(out).toContain('Chase Young')
    expect(out).toMatch(/NOT evidence/)
  })

  it('separates "nothing stored for the sport" from "nothing for this player"', async () => {
    const { db } = fakeDb(() => [{ season: null }])
    const out = await buildPlayerSeasonStatsContext({ playerName: 'Anyone', sport: 'NFL' }, db)
    expect(out).toMatch(/NO NFL SEASON STATS ARE STORED AT ALL/)
  })

  it('refuses an unsupported sport without querying', async () => {
    const { db, calls } = fakeDb(() => [])
    const out = await buildPlayerSeasonStatsContext({ playerName: 'Shohei Ohtani', sport: 'MLB' }, db)
    expect(out).toMatch(/only NFL and college football/)
    expect(calls).toHaveLength(0)
  })
})

describe('get_player_game_log', () => {
  const chaseId = [{ sleeperId: '7564', canonicalName: "Ja'Marr Chase", position: 'WR', currentTeam: 'CIN' }]
  const week18 = {
    playerId: '7564',
    season: 2025,
    week: 18,
    team: 'CIN',
    opponent: 'CLE',
    gameDate: new Date('2026-01-04T05:00:00Z'),
    statPayload: { rec: 8, rec_tgt: 10, rec_yd: 96, rec_td: 1, pts_ppr: 23.6, pts_half_ppr: 19.6, pts_std: 15.6, rush_yd: 0 },
  }

  it('bridges the name to the Sleeper id and renders a box-score line', async () => {
    const { db, calls } = fakeDb((s) => {
      if (s.text.includes('PlayerIdentityMap')) return chaseId
      if (s.text.includes('max(season)')) return [{ season: 2025 }]
      return [week18]
    })

    const out = await buildPlayerGameLogContext({ playerName: "Ja'Marr Chase", season: 2025 }, db)

    expect(out).toContain('Week 18 vs CLE (2026-01-04): 10 tgt, 8 rec, 96 rec yds, 1 rec TD')
    expect(out).toContain('23.6 PPR')
    expect(out).not.toContain('0 rush yds') // zeros are not listed as stats
    const q = calls.find((c) => c.text.includes('stat_payload'))!
    expect(q.values).toContain('7564')
  })

  it('REGRESSION (measured live): warns loudly when his newest lines trail the current season', async () => {
    const { db } = fakeDb((s) => {
      if (s.text.includes('PlayerIdentityMap')) return chaseId
      if (s.text.includes('max(season)') && s.text.includes('"playerId"')) return [{ season: 2025 }]
      if (s.text.includes('max(season)')) return [{ season: 2026 }]
      return [week18]
    })

    const out = await buildPlayerGameLogContext({ playerName: "Ja'Marr Chase" }, db)

    expect(out.split('\n')[0]).toMatch(/NO 2026 GAME LINES ARE STORED FOR HIM YET/)
    expect(out).toMatch(/NOT this season/)
  })

  it('says a missing week is not a zero', async () => {
    const { db } = fakeDb((s) => {
      if (s.text.includes('PlayerIdentityMap')) return chaseId
      if (s.text.includes('max(season)')) return [{ season: 2026 }]
      return []
    })
    const out = await buildPlayerGameLogContext({ playerName: "Ja'Marr Chase", week: 3 }, db)
    expect(out).toMatch(/No line is stored for week 3/)
    expect(out).toMatch(/do NOT report it as zero/)
  })

  it('asks rather than picks when two players share the name', async () => {
    const { db } = fakeDb((s) =>
      s.text.includes('PlayerIdentityMap')
        ? [
            { sleeperId: '1', canonicalName: 'Josh Allen', position: 'QB', currentTeam: 'BUF' },
            { sleeperId: '2', canonicalName: 'Josh Allen', position: 'LB', currentTeam: 'JAX' },
          ]
        : [],
    )
    const out = await buildPlayerGameLogContext({ playerName: 'Josh Allen' }, db)
    expect(out).toMatch(/2 NFL players are named "Josh Allen"/)
  })

  it('college: finds the player by his CFBD season row and reads his CFBD-id game lines', async () => {
    const { db, calls } = fakeDb((s) => {
      if (s.text.includes('fantasy_stat_lines')) {
        return [{ playerId: '5158948', name: 'Jared Curtis', team: 'Vanderbilt', position: 'QB', season: '2026' }]
      }
      if (s.text.includes('max(season)')) return [{ season: 2026 }]
      return [
        {
          playerId: '5158948',
          season: 2026,
          week: 3,
          team: null,
          opponent: null,
          gameDate: new Date('2026-09-19T23:30:00Z'),
          statPayload: { 'passing.COMPLETIONS': 20, 'passing.ATT': 34, 'passing.YDS': 277, 'rushing.YDS': 64, _opponent: 'NC State', _homeAway: 'home' },
        },
      ]
    })

    const out = await buildPlayerGameLogContext({ playerName: 'Jared Curtis', sport: 'NCAAF' }, db)

    expect(out).toContain('Week 3 vs NC State (2026-09-19): 20 cmp, 34 att, 277 pass yds, 64 rush yds')
    const q = calls.find((c) => c.text.includes('stat_payload'))!
    expect(q.text).toContain(`"sportType" = 'NCAAF'`)
    expect(q.values).toContain('5158948') // the CFBD athlete id, straight from the season row
  })

  it('college: says plainly when no game lines are stored yet, instead of inventing one', async () => {
    const { db } = fakeDb((s) => {
      if (s.text.includes('fantasy_stat_lines')) return [{ playerId: '1', name: 'Arch Manning', team: 'Texas', position: 'QB', season: '2026' }]
      return [{ season: null }]
    })
    const out = await buildPlayerGameLogContext({ playerName: 'Arch Manning', sport: 'NCAAF' }, db)
    expect(out).toMatch(/NO college football game lines are stored yet/)
  })
})

describe('get_season_stat_leaders', () => {
  it('ranks by a WHITELISTED key only — model text never becomes an identifier', async () => {
    const { db, calls } = fakeDb((s) =>
      s.text.includes('max(season)')
        ? [{ season: '2026' }]
        : [
            { name: 'Kenneth Walker III', team: 'Kansas City Chiefs', position: 'RB', value: '290', games: '2', fetchedAt: new Date('2026-09-23T18:38:00Z') },
            { name: 'Derrick Henry', team: 'Baltimore Ravens', position: 'RB', value: '212', games: '2', fetchedAt: new Date('2026-09-22T18:38:00Z') },
          ],
    )

    const out = await buildSeasonLeadersContext({ stat: 'rushing_yards', sport: 'NFL' }, db)

    expect(out).toContain('1. Kenneth Walker III (RB, Kansas City Chiefs) — 290 in 2 games')
    expect(out).toContain('refreshed 2026-09-23 18:38 UTC') // the NEWEST refresh, by time
    const q = calls.find((c) => c.text.includes('ORDER BY'))!
    expect(q.values).toContain('rushing_yards')
    expect(q.text).not.toContain('rushing_yards') // bound, not interpolated

    const bad = await buildSeasonLeadersContext({ stat: "x'); DROP TABLE users;--", sport: 'NFL' }, db)
    expect(bad).toMatch(/not a NFL stat I can rank/)
  })

  it('maps the friendly stat to the college dotted key and notes FCS', async () => {
    const { db, calls } = fakeDb((s) =>
      s.text.includes('max(season)') ? [{ season: '2026' }] : [{ name: 'Kaden Anderson', team: 'Tarleton State', position: 'QB', value: '1200', games: '4', fetchedAt: null }],
    )
    const out = await buildSeasonLeadersContext({ stat: 'passing_yards', sport: 'NCAAF' }, db)
    expect(calls.find((c) => c.text.includes('ORDER BY'))!.values).toContain(LEADER_STATS.passing_yards.NCAAF)
    expect(out).toMatch(/FCS included/)
  })

  it('refuses a stat the sport does not carry', async () => {
    const { db } = fakeDb(() => [{ season: '2026' }])
    const out = await buildSeasonLeadersContext({ stat: 'targets', sport: 'NCAAF' }, db)
    expect(out).toMatch(/not a NCAAF stat I can rank/)
  })
})

describe('get_real_standings', () => {
  const row = (abbr: string, data: Record<string, unknown>) => ({ key: `NFL:standings:2026:${abbr}`, data })

  it('reads ONE season, groups by conference, orders by win % — and a null-conference duplicate cannot win', async () => {
    const { db, calls } = fakeDb((s) => {
      if (s.text.includes('max(split_part')) return [{ season: '2026' }]
      return [
        row('CIN', { teamName: 'Cincinnati Bengals', won: 2, lost: 0, tied: 0, pointsFor: 53, pointsAgainst: 33, conference: null }),
        row('BUF', { teamName: 'Buffalo Bills', won: 2, lost: 0, tied: 0, pointsFor: 77, pointsAgainst: 62, conference: 'American Football Conference' }),
        row('MIA', { teamName: 'Miami Dolphins', won: 0, lost: 2, tied: 0, pointsFor: 26, pointsAgainst: 62, conference: 'American Football Conference' }),
        row('CIN2', { teamName: 'Cincinnati Bengals', won: 2, lost: 0, tied: 0, pointsFor: 53, pointsAgainst: 33, conference: 'American Football Conference' }),
      ]
    })

    const out = await buildRealStandingsContext({ sport: 'NFL', group: 'AFC' }, db)

    expect(out).not.toContain('Other')
    const lines = out.split('\n')
    expect(lines.indexOf('- Cincinnati Bengals 2-0 (PF 53, PA 33)')).toBeGreaterThan(-1)
    expect(lines.findIndex((l) => l.includes('Bills'))).toBeLessThan(lines.findIndex((l) => l.includes('Dolphins')))
    const q = calls.find((c) => c.text.includes('SELECT key, data'))!
    expect(q.values).toContain('NFL:standings:2026:%')
    expect(out).not.toMatch(/refreshed/) // createdAt is not a refresh time
  })

  it('understands conference abbreviations people type', async () => {
    const { db } = fakeDb((s) =>
      s.text.includes('max(split_part')
        ? [{ season: '2026' }]
        : [{ key: 'NCAAF:standings:2026:UGA', data: { teamName: 'Georgia Bulldogs', won: 3, lost: 0, conference: 'Southeastern Conference' } }],
    )
    const out = await buildRealStandingsContext({ sport: 'college football', group: 'SEC' }, db)
    expect(out).toContain('Georgia Bulldogs 3-0')
  })
})
