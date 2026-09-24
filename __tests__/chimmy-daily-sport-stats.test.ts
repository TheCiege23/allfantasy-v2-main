import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }))

import {
  buildPlayerGameLogContext,
  buildPlayerSeasonStatsContext,
  buildRealStandingsContext,
  buildSeasonLeadersContext,
} from '@/lib/chimmy/tools/realStatsTools'

/*
 * MLB / NBA / NHL through the real-stats tools (Phase 3). Every stats shape below is copied from
 * production rows read on 2026-09-24, not invented — the units in particular (NBA minutes and NHL
 * time_on_ice season totals are SECONDS) were measured, and a test written from a guessed shape
 * would pin the guess.
 */

type Sql = { text: string; values: unknown[] }

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

const BEFORE_NBA_NHL_OPENERS = new Date('2026-09-24T12:00:00Z')
const AFTER_NBA_OPENER = new Date('2026-10-25T12:00:00Z')

// ── season totals ────────────────────────────────────────────────────────────────────────────

const OHTANI_2026 = {
  playerId: 'pim-ohtani',
  season: '2026',
  team: null,
  fetchedAt: new Date('2026-09-24T01:06:00Z'),
  stats: {
    riTeam: 'Los Angeles Dodgers',
    position: 'TWP',
    riPlayerName: 'Shohei Ohtani',
    postseason: null,
    regular_season: {
      PO: 0,
      games_played: 150,
      batting: { H: 160, R: 120, '2B': 25, '3B': 5, AB: 560, BB: 90, HR: 50, RBI: 110, SB: 20, SO: 160 },
      pitching: { W: 8, L: 4, S: 0, IP: '120.1', ERA: '2.95', K: 150, BB: 35, H: 95, ER: 40, HR: 12 },
    },
  },
}

const DONCIC_2025 = {
  playerId: 'pim-luka',
  season: '2025',
  team: null,
  fetchedAt: new Date('2026-09-24T01:06:00Z'),
  stats: {
    riTeam: 'Los Angeles Lakers',
    position: 'G',
    riPlayerName: 'Luka Doncic',
    postseason: null,
    regular_season: {
      points: 2143, assists: 530, total_rebounds: 495, steals: 105, blocks: 34, turnovers: 255,
      minutes: 137319, games_played: 64, field_goals_made: 693, field_goals_attempted: 1457,
      free_throws_made: 503, free_throws_attempted: 645, three_points_made: 254, three_points_attempted: 694,
    },
  },
}

const VEJMELKA_2025 = {
  playerId: 'pim-vej',
  season: '2025',
  team: null,
  fetchedAt: new Date('2026-09-24T01:06:00Z'),
  stats: {
    riTeam: 'Utah Mammoth',
    position: 'G',
    riPlayerName: 'Karel Vejmelka',
    postseason: null,
    regular_season: { win: 20, loss: 8, saves: 1457, shutouts: 0, time_on_ice: 221565, games_played: 64, goals_allowed: 169, overtime_loss: 1, shots_against: 1626 },
  },
}

const MCDAVID_2025 = {
  playerId: 'pim-97',
  season: '2025',
  team: null,
  fetchedAt: new Date('2026-09-24T01:06:00Z'),
  stats: {
    riTeam: 'Edmonton Oilers',
    position: 'C',
    riPlayerName: 'Connor McDavid',
    postseason: null,
    regular_season: {
      goals: 48, assists: 90, plus_minus: 17, shots_on_goal: 306, games_played: 82, time_on_ice: 113127,
      power_play_goals: 13, power_play_assists: 41, short_handed_goals: 1, short_handed_assists: 1, penalty_minutes: 44, hits: 40, blocks: 30,
    },
  },
}

function seasonDb(row: unknown, newest: string) {
  return fakeDb((s) => (s.text.includes('max(season)') ? [{ season: newest }] : [row]))
}

describe('get_player_season_stats — daily sports', () => {
  it('MLB: renders a two-way player as a batting line AND a pitching line, IP/ERA verbatim', async () => {
    const { db, calls } = seasonDb(OHTANI_2026, '2026')
    const out = await buildPlayerSeasonStatsContext({ playerName: 'Shohei Ohtani', sport: 'baseball' }, db)

    expect(out).toContain('Shohei Ohtani, TWP, Los Angeles Dodgers — MLB 2026 regular season')
    expect(out).toMatch(/- Batting: Games 150 · AB 560 .*HR 50 · RBI 110.*AVG \.286 \(H\/AB\)/)
    // "120.1" is 120⅓ innings in baseball notation — re-rounding it as a decimal would be wrong.
    expect(out).toMatch(/- Pitching: Games 150 · Record 8-4 · Saves 0 · IP 120\.1 · ERA 2\.95 · K 150/)
    // The name reaches SQL only as a bound ILIKE value (the longest letter run; first wins a tie).
    expect(calls[1].values).toContain('%Shohei%')
  })

  it('NBA: labels 2025 as the 2025-26 season and says it is LAST season before the opener', async () => {
    const { db } = seasonDb(DONCIC_2025, '2025')
    const out = await buildPlayerSeasonStatsContext({ playerName: 'Luka Doncic', sport: 'NBA', now: BEFORE_NBA_NHL_OPENERS }, db)

    expect(out.split('\n')[0]).toMatch(/2026-27 NBA season has not started \(it opens 2026-10-20\).*LAST season's 2025-26/)
    expect(out).toContain('NBA 2025-26 regular season')
    expect(out).toContain('Points 2143 (33.5 per game)')
    expect(out).toContain('FG% 47.6%')
    // Season `minutes` is SECONDS: 137,319 / 64 / 60 = 35.8. Read as minutes it would be 2,145.6.
    expect(out).toContain('Minutes 35.8 per game')
  })

  it('NBA: once the new season has opened, says its numbers are not stored yet', async () => {
    const { db } = seasonDb(DONCIC_2025, '2025')
    const out = await buildPlayerSeasonStatsContext({ playerName: 'Luka Doncic', sport: 'NBA', now: AFTER_NBA_OPENER }, db)
    expect(out.split('\n')[0]).toMatch(/NO 2026-27 NBA NUMBERS ARE STORED YET/)
  })

  it('NHL goalie: computes SV% and GAA from saves, shots and seconds on ice', async () => {
    const { db } = seasonDb(VEJMELKA_2025, '2025')
    const out = await buildPlayerSeasonStatsContext({ playerName: 'Karel Vejmelka', sport: 'NHL', now: BEFORE_NBA_NHL_OPENERS }, db)
    expect(out).toContain('Saves 1457 of 1626 (SV% .896)')
    expect(out).toContain('Goals against 169 (GAA 2.75)')
  })

  it('NHL skater: sums points and power-play points — the feed has no *_points totals', async () => {
    const { db } = seasonDb(MCDAVID_2025, '2025')
    const out = await buildPlayerSeasonStatsContext({ playerName: 'Connor McDavid', sport: 'hockey', now: BEFORE_NBA_NHL_OPENERS }, db)
    expect(out).toContain('Goals 48 · Assists 90 · Points 138')
    expect(out).toContain('Power-play points 54')
    expect(out).toContain('TOI 23:00 per game')
  })
})

// ── game logs ────────────────────────────────────────────────────────────────────────────────

const game = (over: Record<string, unknown>) => ({
  providerGameId: null,
  season: 2026,
  team: 'LAD',
  opponent: 'SF',
  gameDate: new Date('2026-09-22T04:00:00Z'),
  map: { group: 'batting', stats: {} },
  payload: {},
  ...over,
})

function logDb(opts: { registry: unknown[]; rows: unknown[]; sportLatest?: Date; withGames?: unknown[] }) {
  return fakeDb((s) => {
    if (s.text.includes('"PlayerIdentityMap"')) return opts.registry
    if (s.text.includes('DISTINCT "playerId"')) return opts.withGames ?? []
    if (s.text.includes('max(game_date)')) return [{ latest: opts.sportLatest ?? new Date('2026-09-23T04:00:00Z') }]
    if (s.text.includes('FROM player_game_stats')) return opts.rows
    return []
  })
}

const OHTANI_REG = [{ id: 'pim-ohtani', canonicalName: 'Shohei Ohtani', position: 'TWP', currentTeam: 'LAD' }]

describe('get_player_game_log — daily sports', () => {
  it('MLB: merges a two-way game into ONE line, pitching decision included', async () => {
    const { db } = logDb({
      registry: OHTANI_REG,
      rows: [
        game({ gameId: '20260922-15-18:batting', providerGameId: '20260922-15-18', map: { group: 'batting', seasonType: 'regular', stats: { AB: 4, H: 2, HR: 1, RBI: 3, SO: 1 } } }),
        game({ gameId: '20260922-15-18:pitching', providerGameId: '20260922-15-18', map: { group: 'pitching', seasonType: 'regular', stats: { IP: 6, H: 4, ER: 2, BB: 1, K: 9, W: 1 } }, payload: { IP: '6.0' } }),
        game({ gameId: '20260921-15-18:batting', providerGameId: '20260921-15-18', gameDate: new Date('2026-09-21T04:00:00Z'), map: { group: 'batting', seasonType: 'regular', stats: { AB: 3, H: 0, BB: 1 } } }),
      ],
    })
    const out = await buildPlayerGameLogContext({ playerName: 'Shohei Ohtani', sport: 'MLB' }, db)
    const lines = out.split('\n')

    expect(lines.filter((l) => l.startsWith('- 2026-09-22'))).toHaveLength(1)
    expect(out).toContain('- 2026-09-22 vs SF: Batting 2-for-4, 1 HR, 3 RBI, 1 K · Pitching 6.0 IP, 4 H, 2 ER, 1 BB, 9 K, W')
    expect(out).toContain('- 2026-09-21 vs SF: Batting 0-for-3, 1 BB')
    expect(out).not.toMatch(/⚠ His newest stored game/)
  })

  it('NHL: never shows a preseason game as a game line — including rows written before the label', async () => {
    const { db } = logDb({
      registry: [{ id: 'pim-tippett', canonicalName: 'Owen Tippett', position: 'RW', currentTeam: 'PHI' }],
      rows: [
        // The measured 2026-09-21..23 rows: no stored label, before the 09-29 opener.
        game({ gameId: '20260922-8-2:skaters', providerGameId: '20260922-8-2', opponent: 'BOS', map: { group: 'skaters', stats: { goals: 1, assists: 0, shots_on_goal: 2 } } }),
        game({ gameId: '20260920-8-2:skaters', providerGameId: '20260920-8-2', gameDate: new Date('2026-09-20T04:00:00Z'), map: { group: 'skaters', seasonType: 'pre', stats: { goals: 2 } } }),
      ],
    })
    const out = await buildPlayerGameLogContext({ playerName: 'Owen Tippett', sport: 'NHL' }, db)
    expect(out).not.toMatch(/- 2026-09-2/)
    expect(out).toMatch(/2 preseason line\(s\) are stored and deliberately not shown/)
    expect(out).toMatch(/Do NOT report zeros/)
  })

  it('tags a postseason game', async () => {
    const { db } = logDb({
      registry: OHTANI_REG,
      rows: [game({ gameId: '20261001-15-18:batting', providerGameId: '20261001-15-18', gameDate: new Date('2026-10-01T04:00:00Z'), map: { group: 'batting', seasonType: 'post', stats: { AB: 4, H: 1 } } })],
      sportLatest: new Date('2026-10-01T04:00:00Z'),
    })
    const out = await buildPlayerGameLogContext({ playerName: 'Shohei Ohtani', sport: 'MLB' }, db)
    expect(out).toContain('- 2026-10-01 vs SF (postseason): Batting 1-for-4')
  })

  it('REGRESSION (measured: Judge): warns when his newest game trails the league by days', async () => {
    const { db } = logDb({
      registry: [{ id: 'pim-judge', canonicalName: 'Aaron Judge', position: 'RF', currentTeam: 'NYY' }],
      rows: [game({ gameId: '20260916-1-2:batting', providerGameId: '20260916-1-2', gameDate: new Date('2026-09-16T04:00:00Z'), map: { group: 'batting', seasonType: 'regular', stats: { AB: 4, H: 1 } } })],
      sportLatest: new Date('2026-09-23T04:00:00Z'),
    })
    const out = await buildPlayerGameLogContext({ playerName: 'Aaron Judge', sport: 'MLB' }, db)
    expect(out.split('\n')[0]).toMatch(/His newest stored game is 2026-09-16, while MLB box scores are stored through 2026-09-23/)
    expect(out).toMatch(/Do NOT call it "last night"/)
  })

  it('two registry rows share a name: keeps the one with games, asks only if both have them', async () => {
    const twins = [
      { id: 'pim-a', canonicalName: 'Will Smith', position: 'C', currentTeam: 'LAD' },
      { id: 'pim-b', canonicalName: 'Will Smith', position: 'P', currentTeam: 'FA' },
    ]
    const one = logDb({
      registry: twins,
      withGames: [{ playerId: 'pim-a' }],
      rows: [game({ gameId: 'g1:batting', providerGameId: 'g1', map: { group: 'batting', seasonType: 'regular', stats: { AB: 4, H: 2 } } })],
    })
    expect(await buildPlayerGameLogContext({ playerName: 'Will Smith', sport: 'MLB' }, one.db)).toContain('Will Smith (C, LAD)')

    const both = logDb({ registry: twins, withGames: [{ playerId: 'pim-a' }, { playerId: 'pim-b' }], rows: [] })
    expect(await buildPlayerGameLogContext({ playerName: 'Will Smith', sport: 'MLB' }, both.db)).toMatch(/2 MLB players are named "Will Smith".*Ask which one/)
  })
})

// ── leaders ──────────────────────────────────────────────────────────────────────────────────

function leaderDb(rows: Array<Record<string, unknown>>) {
  return fakeDb((s) => (s.text.includes('max(season)') ? [{ season: '2026' }] : rows))
}

const pitcher = (name: string, era: string, ip: string, games: number) => ({ name, team: 'X', position: 'P', games: String(games), fetchedAt: new Date('2026-09-24T01:06:00Z'), p0: era, p1: ip })

describe('get_season_stat_leaders — daily sports', () => {
  it('MLB ERA: lowest first, with a stated innings minimum that scales with games played', async () => {
    const { db, calls } = leaderDb([
      pitcher('Opener Guy', '0.90', '20.0', 60),
      pitcher('Ace One', '2.10', '190.1', 31),
      pitcher('Ace Two', '2.45', '180.0', 30),
      { name: 'Everyday Guy', team: 'X', position: 'SS', games: '158', fetchedAt: null, p0: null, p1: null },
    ])
    const out = await buildSeasonLeadersContext({ stat: 'era', sport: 'MLB' }, db)

    expect(out).toMatch(/minimum 158 innings/)
    expect(out).toMatch(/1\. Ace One \(P, X\) — 2\.10/)
    expect(out).toMatch(/2\. Ace Two \(P, X\) — 2\.45/)
    expect(out).not.toContain('Opener Guy')
    expect(out).toMatch(/not the league's official qualifier/)
    // Only whitelisted JSON paths reach SQL — as bound arrays, never model text.
    const sql = calls[1]
    expect(sql.values).toContainEqual(['regular_season', 'pitching', 'ERA'])
    expect(sql.values).toContainEqual(['regular_season', 'pitching', 'IP'])
    expect(sql.values.some((v) => v === 'era')).toBe(false)
  })

  it('understands the abbreviation people type (hr → home_runs)', async () => {
    const { db } = leaderDb([
      { name: 'Kyle Schwarber', team: 'PHI', position: 'DH', games: '151', fetchedAt: null, p0: '45' },
      { name: 'Pete Crow-Armstrong', team: 'CHC', position: 'CF', games: '157', fetchedAt: null, p0: '45' },
      { name: 'Junior Caminero', team: 'TB', position: '3B', games: '157', fetchedAt: null, p0: '41' },
    ])
    const out = await buildSeasonLeadersContext({ stat: 'HR', sport: 'MLB', limit: 3 }, db)
    expect(out).toMatch(/leaders in home runs/)
    // Ties broken by name, so the order is stable run to run.
    expect(out).toMatch(/1\. Kyle Schwarber[\s\S]*2\. Pete Crow-Armstrong[\s\S]*3\. Junior Caminero/)
  })

  it('refuses a stat the sport does not carry, listing what it can rank', async () => {
    const { db, calls } = leaderDb([])
    const out = await buildSeasonLeadersContext({ stat: 'touchdowns', sport: 'NHL' }, db)
    expect(out).toMatch(/not a NHL stat I can rank\. Available: goals, assists, points/)
    expect(calls.filter((c) => c.text.includes('fantasy_stat_lines') && !c.text.includes('max(season)'))).toHaveLength(0)
  })
})

// ── standings ────────────────────────────────────────────────────────────────────────────────

function standingsDb(sport: string, season: string, teams: Array<Record<string, unknown>>) {
  return fakeDb((s) =>
    s.text.includes('max(split_part')
      ? [{ season }]
      : teams.map((d) => ({ key: `${sport}:standings:${season}:${d.team}`, data: d })),
  )
}

describe('get_real_standings — daily sports', () => {
  it('NHL: W-L-OTL and ordered by POINTS, not win percentage; 2025 is 2025-26', async () => {
    const { db } = standingsDb('NHL', '2025', [
      // The two orders DISAGREE here, so the test can tell them apart: Alpha has the better win %
      // (45-25 = .643 vs 42-30 = .583) but fewer points (45*2+0 = 90 vs 42*2+10 = 94).
      { team: 'AAA', teamName: 'Alpha', won: 45, lost: 25, otLost: 0, conference: 'Western Conference', pointsFor: 250, pointsAgainst: 240 },
      { team: 'BBB', teamName: 'Bravo', won: 42, lost: 30, otLost: 10, conference: 'Western Conference', pointsFor: 260, pointsAgainst: 230 },
    ])
    const out = await buildRealStandingsContext({ sport: 'NHL', now: BEFORE_NBA_NHL_OPENERS }, db)
    const lines = out.split('\n')
    expect(lines[0]).toMatch(/LAST season's 2025-26/)
    expect(out).toContain('NHL 2025-26 standings')
    expect(lines.findIndex((l) => l.includes('Bravo'))).toBeLessThan(lines.findIndex((l) => l.includes('Alpha')))
    expect(out).toContain('- Bravo 42-30-10, 94 pts (GF 260, GA 230)')
  })

  it('MLB: games back from the league leader, and never the meaningless otLost ESPN stores', async () => {
    const { db } = standingsDb('MLB', '2026', [
      { team: 'LAD', teamName: 'Los Angeles Dodgers', won: 92, lost: 65, otLost: 3, conference: 'National League', division: 'National League', pointsFor: 800, pointsAgainst: 650 },
      { team: 'ARI', teamName: 'Arizona Diamondbacks', won: 83, lost: 74, otLost: 8, conference: 'National League', division: 'National League', pointsFor: 700, pointsAgainst: 696 },
    ])
    const out = await buildRealStandingsContext({ sport: 'MLB', group: 'NL' }, db)
    expect(out).toContain('- Los Angeles Dodgers 92-65 (—, RS 800, RA 650)')
    expect(out).toContain('- Arizona Diamondbacks 83-74 (9 GB, RS 700, RA 696)')
    expect(out).not.toMatch(/83-74-8/)
    expect(out).toMatch(/NOT by division/)
  })
})
