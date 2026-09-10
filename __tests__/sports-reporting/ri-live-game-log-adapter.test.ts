/** @vitest-environment node */
/**
 * `riLiveGameLogAdapter` — Rolling Insights `/live` into the game-log CACHE.
 *
 * 🛑 WHY THE CACHE AND NOT `player_game_stats`. Measured 2026-09-10, this repo has TWO game-log
 * tables and nothing joined them. `rollingInsightsGameLogs` has swept `/live` daily since
 * 2026-08-27 into `player_game_stats` (62,069 MLB rows). But `playerWeeklyScoreService` reads
 * `player_game_log_cache`, whose only writer had NO scheduled caller and held 7 NFL rows last
 * written 2026-06-24. Provider data arrived every day and the scorer saw none of it.
 *
 * ⚠ THE TWO SPORTS DO NOT SHARE A BOX SHAPE, which is the whole reason a naive parser reads one
 * of them as empty. Confirmed against a real probe on 2026-03-15 (fixtures/live.NBA.json,
 * fixtures/live.NHL.json):
 *
 *     NBA   player_box.<side>.<player_id>.<stat>
 *     NHL   player_box.<side>.{goalies|skaters}.<player_id>.<stat>
 *
 * These tests run the REAL `normalizeRiGameBox` rather than mocking it — mocking the parser
 * would leave exactly the bug this is guarding untested.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const riFetchRows = vi.fn()
vi.mock('@/lib/workers/providers/rollingInsightsRest', () => ({
  riFetchRows: (...a: unknown[]) => riFetchRows(...a),
}))

import { fetchRiLiveGameLogRows } from '@/lib/sports-reporting/riLiveGameLogAdapter'

const ok = (rows: unknown[]) => ({ rows, notModified: false, unsupported: false, error: null })

/** NBA: player ids hang directly off the side. */
const nbaGame = {
  game_ID: 'nba-1',
  season: '2025-2026',
  season_type: 'Regular Season',
  status: 'completed',
  game_time: '2026-03-15T23:00:00Z',
  home_team_name: 'Chicago Bulls',
  away_team_name: 'Miami Heat',
  full_box: { home_team: { abbrv: 'CHI' }, away_team: { abbrv: 'MIA' } },
  player_box: {
    home_team: { '619': { player: 'A Player', points: 21, assists: 4, position: 'G' } },
    away_team: { '191': { player: 'B Player', points: 14, total_rebounds: 8, position: 'F' } },
  },
}

/** NHL: an extra grouping level sits between the side and the player id. */
const nhlGame = {
  game_ID: 'nhl-1',
  season: '2025-2026',
  season_type: 'Regular Season',
  status: 'completed',
  game_time: '2026-03-15T23:00:00Z',
  home_team_name: 'Boston Bruins',
  away_team_name: 'Ottawa Senators',
  full_box: { home_team: { abbrv: 'BOS' }, away_team: { abbrv: 'OTT' } },
  player_box: {
    home_team: {
      skaters: { '1001': { player: 'C Skater', goals: 1, assists: 2, position: 'C' } },
      goalies: { '2941': { player: 'D Goalie', saves: 30, goals_allowed: 2, position: 'G' } },
    },
    away_team: {
      skaters: { '1002': { player: 'E Skater', goals: 0, shots_on_goal: 3, position: 'D' } },
    },
  },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fetchRiLiveGameLogRows', () => {
  it('flattens NBA player ids that hang directly off the side', async () => {
    riFetchRows.mockResolvedValue(ok([nbaGame]))
    const out = await fetchRiLiveGameLogRows({ sport: 'NBA', seasonType: 'regular', days: 1 })

    expect(out.errors).toEqual([])
    const ids = out.rows.map((r) => r.providerPlayerId).sort()
    expect(ids).toEqual(['191', '619'])
    expect(out.rows.every((r) => r.gameId === 'nba-1')).toBe(true)
    expect(out.rows.every((r) => r.provider === 'rolling_insights')).toBe(true)
  })

  it('flattens NHL through the extra skaters/goalies level', async () => {
    // 🛑 The failure this guards: a parser written against NBA treats "skaters" and "goalies" as
    // player ids, finds no stats on them, and ingests nothing — silently.
    riFetchRows.mockResolvedValue(ok([nhlGame]))
    const out = await fetchRiLiveGameLogRows({ sport: 'NHL', seasonType: 'regular', days: 1 })

    const ids = out.rows.map((r) => r.providerPlayerId).sort()
    expect(ids).toEqual(['1001', '1002', '2941'])
    // And the grouping keys must NEVER appear as players.
    expect(ids).not.toContain('skaters')
    expect(ids).not.toContain('goalies')
  })

  it('reduces the hyphenated season the /live body returns', async () => {
    // `/live` emits "2025-2026" while the REST season path takes YYYY. A row carrying the span
    // into an integer-keyed season column matches nothing, silently.
    riFetchRows.mockResolvedValue(ok([nbaGame]))
    const out = await fetchRiLiveGameLogRows({ sport: 'NBA', seasonType: 'regular', days: 1 })
    expect(out.rows[0]?.season).toBe('2025')
  })

  it('treats a surviving 304 as unknown and writes nothing', async () => {
    // The contract's `304_conflict` is UNRESOLVED — cache artifact or empty set. Reporting "no
    // games" would be choosing one reading of a documented dispute.
    riFetchRows.mockResolvedValue({ rows: [], notModified: true, unsupported: false, error: null })
    const out = await fetchRiLiveGameLogRows({ sport: 'NHL', seasonType: 'regular', days: 2 })
    expect(out.rows).toEqual([])
    expect(out.errors).toEqual([])
    expect(out.warnings.join(' ')).toMatch(/unchanged\/unknown/)
  })

  it('stops immediately when the vendor does not support the sport', async () => {
    riFetchRows.mockResolvedValue({ rows: [], notModified: false, unsupported: true, error: null })
    const out = await fetchRiLiveGameLogRows({ sport: 'NBA', seasonType: 'regular', days: 5 })
    expect(riFetchRows).toHaveBeenCalledTimes(1) // breaks, does not retry 5 dates
    expect(out.warnings.join(' ')).toMatch(/not supported/)
  })

  it('reports an empty in-season-shaped sweep as a warning, never a failure', async () => {
    // NBA and NHL are dark from mid-June to October. A permanently red light is one an operator
    // stops reading — which is how the outage this fixes lasted months.
    riFetchRows.mockResolvedValue(ok([]))
    const out = await fetchRiLiveGameLogRows({ sport: 'NHL', seasonType: 'regular', days: 3 })
    expect(out.rows).toEqual([])
    expect(out.errors).toEqual([])
    expect(out.warnings.join(' ')).toMatch(/expected out of season/)
  })
})
