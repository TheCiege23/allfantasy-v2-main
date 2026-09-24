import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }))

import {
  buildPlayerGameLogContext,
  buildPlayerSeasonStatsContext,
  buildRealStandingsContext,
  buildSeasonLeadersContext,
  normalizeStatsSport,
} from '@/lib/chimmy/tools/realStatsTools'
import { isStoredStatsQuestion } from '@/lib/ai/deterministic'

/*
 * College basketball through the real-stats tools (phase 3).
 *
 * 🛑 THE ONE PROPERTY THAT MATTERS MOST: nothing here may read `fantasy_stat_lines`. Rolling
 * Insights' NCAAB season totals stop in December (GAPS N-14 — Boozer shows 12 GP for a 37-game
 * season). Totals are summed from `player_game_stats`, which was backfilled 2026-09-24. Every
 * shape and number below is from production rows read that day.
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

const BEFORE_OPENER = new Date('2026-09-24T12:00:00Z')
const AFTER_OPENER = new Date('2026-11-10T12:00:00Z')
const BOOZER = { id: 'pim-boozer', canonicalName: 'Cameron Boozer', position: 'F', currentTeam: 'DUKE UNIVERSITY' }

/** Boozer's 2025-26 totals as summed on production (37 games, 7 postseason). */
const BOOZER_TOTALS = {
  playerId: 'pim-boozer', games: 37, postGames: 7,
  points: 832, total_rebounds: 381, offensive_rebounds: 120, defensive_rebounds: 261, assists: 144, steals: 52,
  blocks: 92, turnovers: 92, fouls: 80, minutes: 1180, field_goals_made: 290, field_goals_attempted: 523,
  three_points_made: 54, three_points_attempted: 136, free_throws_made: 196, free_throws_attempted: 246,
}

function seasonDb(opts: { registry?: unknown[]; totals?: unknown[] } = {}) {
  return fakeDb((s) => {
    if (s.text.includes('max(season)')) return [{ season: 2025 }]
    if (s.text.includes('"PlayerIdentityMap"')) return opts.registry ?? [BOOZER]
    if (s.text.includes('FROM player_game_stats')) return opts.totals ?? [BOOZER_TOTALS]
    return []
  })
}

const readsVendorTotals = (calls: Sql[]) => calls.some((c) => c.text.includes('fantasy_stat_lines'))

describe('college basketball — sport names and routing', () => {
  it('maps the ways people name it', () => {
    for (const v of ['NCAAB', 'college basketball', 'CBB', 'NCAABB']) expect(normalizeStatsSport(v), v).toBe('NCAAB')
    // Plain "basketball" is still the NBA.
    expect(normalizeStatsSport('basketball')).toBe('NBA')
  })

  it('a college basketball question reaches the stats tools even without "season" in it', () => {
    // No "this season" / "last week" here — only the `college basketball` cue can route this.
    expect(isStoredStatsQuestion('who leads college basketball in scoring')).toBe(true)
  })
})

describe('get_player_season_stats — NCAAB is summed from game logs', () => {
  it('REGRESSION CATCHER: never reads the truncated vendor totals', async () => {
    const { db, calls } = seasonDb()
    await buildPlayerSeasonStatsContext({ playerName: 'Cameron Boozer', sport: 'NCAAB', now: BEFORE_OPENER }, db)
    expect(readsVendorTotals(calls)).toBe(false)
    expect(calls.some((c) => c.text.includes('FROM player_game_stats'))).toBe(true)
  })

  it('renders totals, per-game rates and how many postseason games are in them', async () => {
    const { db } = seasonDb()
    const out = await buildPlayerSeasonStatsContext({ playerName: 'Cameron Boozer', sport: 'college basketball', now: BEFORE_OPENER }, db)
    expect(out).toContain('Cameron Boozer, F, DUKE UNIVERSITY — NCAAB 2025-26 season:')
    expect(out).toContain('Games 37 (incl. 7 postseason)')
    expect(out).toContain('Points 832 (22.5 per game)')
    expect(out).toContain('Rebounds 381 (10.3 per game)')
    expect(out).toContain('FG% 55.4%')
    // NCAAB box minutes are MINUTES (NBA season totals are seconds): 1180 / 37 = 31.9.
    expect(out).toContain('Minutes 31.9 per game')
    expect(out).toMatch(/conference tournaments and the NCAA Tournament\/NIT/)
    expect(out).toMatch(/can run slightly low/)
  })

  it('says these are LAST season before the opener, and that the new one is not stored after it', async () => {
    const before = await buildPlayerSeasonStatsContext({ playerName: 'Cameron Boozer', sport: 'NCAAB', now: BEFORE_OPENER }, seasonDb().db)
    expect(before.split('\n')[0]).toMatch(/2026-27 NCAAB season has not started \(it opens 2026-11-02\).*LAST season's 2025-26/)
    const after = await buildPlayerSeasonStatsContext({ playerName: 'Cameron Boozer', sport: 'NCAAB', now: AFTER_OPENER }, seasonDb().db)
    expect(after.split('\n')[0]).toMatch(/NO 2026-27 NCAAB NUMBERS ARE STORED YET/)
  })

  it('REGRESSION CATCHER (measured on prod): sums are cast to float8, or Prisma returns Decimal objects and every total is empty', async () => {
    const { db, calls } = seasonDb()
    await buildPlayerSeasonStatsContext({ playerName: 'Cameron Boozer', sport: 'NCAAB', now: BEFORE_OPENER }, db)
    const totals = calls.find((c) => c.text.includes('FROM player_game_stats') && c.text.includes('sum('))!
    expect(totals.text).toMatch(/::numeric\)::float8/)
    // The stat keys reach SQL as bound values, never identifiers built from model text.
    expect(totals.values).toContain('points')
    // Preseason / exhibitions are excluded.
    expect(totals.text).toMatch(/<> 'pre'/)
  })

  it('two players with the same name who both played: asks rather than picking', async () => {
    const twin = { id: 'pim-2', canonicalName: 'Cameron Boozer', position: 'G', currentTeam: 'SOMEWHERE STATE' }
    const { db } = seasonDb({ registry: [BOOZER, twin], totals: [BOOZER_TOTALS, { ...BOOZER_TOTALS, playerId: 'pim-2' }] })
    const out = await buildPlayerSeasonStatsContext({ playerName: 'Cameron Boozer', sport: 'NCAAB', now: BEFORE_OPENER }, db)
    expect(out).toMatch(/2 college players named "Cameron Boozer" played in 2025-26.*Ask which one/)
  })

  it('no stored games is a sentence, never zeros', async () => {
    const { db } = seasonDb({ totals: [] })
    const out = await buildPlayerSeasonStatsContext({ playerName: 'Cameron Boozer', sport: 'NCAAB', now: BEFORE_OPENER }, db)
    expect(out).toMatch(/do NOT report zeros/)
  })
})

describe('get_season_stat_leaders — NCAAB', () => {
  const leaderDb = (rows: unknown[]) =>
    fakeDb((s) => {
      if (s.text.includes('max(season)')) return [{ season: 2025 }]
      if (s.text.includes('"PlayerIdentityMap"')) {
        return [
          { id: 'a', canonicalName: 'AJ Dybantsa', position: 'F', currentTeam: 'BRIGHAM YOUNG UNIVERSITY' },
          { id: 'b', canonicalName: 'Small Sample', position: 'G', currentTeam: 'X' },
          { id: 'c', canonicalName: 'Cameron Boozer', position: 'F', currentTeam: 'DUKE UNIVERSITY' },
        ]
      }
      return rows
    })

  it('per-game leaders need a stated share of the most games played — small samples are out', async () => {
    const { db, calls } = leaderDb([
      { playerId: 'a', games: 35, total: 894 },
      { playerId: 'b', games: 5, total: 150 }, // 30.0 a game, but only 5 games
      { playerId: 'c', games: 37, total: 832 },
      { playerId: 'x', games: 40, total: 400 },
    ])
    const out = await buildSeasonLeadersContext({ stat: 'ppg', sport: 'NCAAB', now: BEFORE_OPENER }, db)
    expect(out).toMatch(/minimum 24 games \(60% of the most anyone played, 40/)
    expect(out).toMatch(/1\. AJ Dybantsa \(F, BRIGHAM YOUNG UNIVERSITY\) — 25\.5 in 35 games/)
    expect(out).toMatch(/2\. Cameron Boozer .* — 22\.5 in 37 games/)
    expect(out).not.toContain('Small Sample')
    expect(readsVendorTotals(calls)).toBe(false)
  })

  it('refuses a stat it cannot rank, listing what it can', async () => {
    const out = await buildSeasonLeadersContext({ stat: 'touchdowns', sport: 'NCAAB' }, leaderDb([]).db)
    expect(out).toMatch(/not a college basketball stat I can rank\. Available: points, rebounds/)
  })
})

describe('get_player_game_log and get_real_standings — NCAAB', () => {
  it('lists games by date with the NBA-shaped box and whole-minute strings', async () => {
    const { db } = fakeDb((s) => {
      if (s.text.includes('"PlayerIdentityMap"')) return [BOOZER]
      if (s.text.includes('max(game_date)')) return [{ latest: new Date('2026-03-29T00:00:00Z') }]
      if (s.text.includes('FROM player_game_stats')) {
        return [{
          gameId: '20260329-40-66', providerGameId: '20260329-40-66', season: 2025, team: 'DUKE', opponent: 'CONN',
          gameDate: new Date('2026-03-29T00:00:00Z'),
          map: { group: 'all', seasonType: 'post', stats: { points: 27, total_rebounds: 8, assists: 4, steals: 0, blocks: 4, turnovers: 4, field_goals_made: 10, field_goals_attempted: 21, three_points_made: 1 } },
          payload: { minutes: '39' },
        }]
      }
      return []
    })
    const out = await buildPlayerGameLogContext({ playerName: 'Cameron Boozer', sport: 'NCAAB' }, db)
    expect(out).toContain('- 2026-03-29 vs CONN (postseason): 27 pts, 8 reb, 4 ast, 0 stl, 4 blk, 4 TO, 10/21 FG, 1 3PM, 39 min')
  })

  it('standings: by conference, games back, 2025-26, last-season note', async () => {
    const { db } = fakeDb((s) =>
      s.text.includes('max(split_part')
        ? [{ season: '2025' }]
        : [
            { key: 'NCAAB:standings:2025:FLA', data: { team: 'FLA', teamName: 'Florida Gators', won: 26, lost: 7, conference: 'Southeastern Conference' } },
            { key: 'NCAAB:standings:2025:ALA', data: { team: 'ALA', teamName: 'Alabama Crimson Tide', won: 23, lost: 9, conference: 'Southeastern Conference' } },
          ],
    )
    const out = await buildRealStandingsContext({ sport: 'NCAAB', group: 'SEC', now: BEFORE_OPENER }, db)
    expect(out.split('\n')[0]).toMatch(/LAST season's 2025-26/)
    expect(out).toContain('NCAAB 2025-26 standings')
    expect(out).toContain('- Florida Gators 26-7 (—)')
    expect(out).toContain('- Alabama Crimson Tide 23-9 (2.5 GB)')
  })
})
