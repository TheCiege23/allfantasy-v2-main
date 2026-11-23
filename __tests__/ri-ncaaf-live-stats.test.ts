import { describe, expect, it } from 'vitest'
import fixture from '../contracts/rolling-insights/fixtures/live.NCAAFB.json'
import { normalizeRiGameBox, normalizedStatMapFor } from '@/lib/sports-data/rollingInsightsGameLogs'
import {
  aggregateNcaafWeek,
  isRiNcaafRow,
  normalizeRiNcaafGameStats,
} from '@/lib/scoring-runtime/ncaafStatNormalization'
import { DAILY_LIVE_SPORTS, MAX_GAME_LENGTH_MS, resolveDailyLiveSports } from '@/lib/live/dailySportLiveTick'

/*
 * Against the COMMITTED fixture (54 real games, captured 2026-10-05 on RSC_TOKEN2), never a
 * hand-written payload: the parser's comment still calls the NCAAFB shape unverified, and this is
 * the test that verifies it.
 */
const games = (fixture as { data: { NCAAFB: unknown[] } }).data.NCAAFB

describe('Rolling Insights college football box scores', () => {
  it('the shared parser reads every player line of the real fixture', () => {
    let lines = 0
    let expected = 0
    for (const g of games) {
      const box = normalizeRiGameBox(g)
      expect(box).not.toBeNull()
      lines += box!.lines.length
      const pb = (g as { player_box: Record<string, Record<string, unknown>> }).player_box
      expected += Object.values(pb).reduce((n, side) => n + Object.keys(side).length, 0)
    }
    expect(expected).toBe(3588)
    expect(lines).toBe(expected)
  })

  it("scores a real quarterback line: Keyone Jenkins, 253 yds 1 TD 1 INT passing, 1 rushing TD", () => {
    const game = games.find((g) => (g as { game_ID: string }).game_ID === '20261003-1-5')!
    const box = normalizeRiGameBox(game)!
    const line = box.lines.find((l) => l.providerPlayerId === '65557')!
    const stored = normalizedStatMapFor(line, box)
    expect(isRiNcaafRow(stored)).toBe(true)
    const { stats, unmappedKeys, appeared } = normalizeRiNcaafGameStats(stored)
    expect(appeared).toBe(true)
    expect(stats).toMatchObject({ pass_yds: 253, pass_td: 1, pass_int: 1, rush_yds: -4, rush_td: 1, fum_lost: 0 })
    expect(unmappedKeys).toEqual([])
  })

  it('every field in the fixture is either scored or named as informational', () => {
    const unmapped = new Set<string>()
    for (const g of games) {
      const box = normalizeRiGameBox(g)!
      for (const line of box.lines) for (const k of normalizeRiNcaafGameStats(normalizedStatMapFor(line, box)).unmappedKeys) unmapped.add(k)
    }
    expect([...unmapped]).toEqual([])
  })

  it('derives kicking misses only when both made and attempted exist', () => {
    const r = normalizeRiNcaafGameStats({ stats: { field_goals_made: 2, field_goals_attempted: 3, extra_points_made: 4, extra_points_attempted: 4 } })
    expect(r.stats).toMatchObject({ fg_made: 2, fg_miss: 1, xp_made: 4, xp_miss: 0 })
  })

  it('ignores the vendor player id that rides inside a stored line', () => {
    const r = normalizeRiNcaafGameStats({ group: 'all', stats: { player_id: 61641, passing_yards: 59 } })
    expect(r.stats).toEqual({ pass_yds: 59 })
    expect(r.unmappedKeys).toEqual([])
  })

  it('a week aggregate reads CFBD rows and RI rows by their own shapes', () => {
    const cfbd = { 'passing.YDS': 100, 'passing.TD': 1 }
    const ri = { group: 'all', stats: { passing_yards: 50, rushing_touchdowns: 1 } }
    expect(isRiNcaafRow(cfbd)).toBe(false)
    const week = aggregateNcaafWeek([cfbd, ri])
    expect(week.gamesCounted).toBe(2)
    expect(week.stats).toMatchObject({ pass_yds: 150, pass_td: 1, rush_td: 1 })
  })
})

describe('live tick covers college football', () => {
  it('NCAAF is polled by default and has a college game length', () => {
    expect(DAILY_LIVE_SPORTS).toContain('NCAAF')
    expect(resolveDailyLiveSports({})).toContain('NCAAF')
    expect(MAX_GAME_LENGTH_MS.NCAAF).toBeGreaterThanOrEqual(4 * 3_600_000)
  })

  it('an operator can still leave it out', () => {
    expect(resolveDailyLiveSports({ DAILY_SPORT_LIVE_SCORING: 'NBA,NHL,MLB' })).not.toContain('NCAAF')
  })
})
