/**
 * Per-game log columns, run on the REAL stored path for each sport:
 *
 *   fixtures/live.<SPORT>.json -> normalizeRiGameBox -> normalizedStatMapFor -> sport normalizer
 *     -> computeGameLogValues
 *
 * The fixtures are the committed Rolling Insights captures, so a renamed vendor field shows up here
 * as a missing value rather than as a blank column in production.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/workers/providers/rollingInsightsRest', () => ({ riFetchRows: vi.fn() }))

import { getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { normalizeRiGameBox, normalizedStatMapFor, type RiBoxLine } from '@/lib/sports-data/rollingInsightsGameLogs'
import {
  computeGameLogValues,
  formatGameLogValue,
  gameLogColumns,
  gameLogLinePlayed,
  ratioInputsFor,
  summarizeGameLog,
  type GameLogSport,
} from '@/lib/player-game-log/gameLogColumns'

function fixtureLines(file: string): RiBoxLine[] {
  const json = JSON.parse(readFileSync(join(process.cwd(), 'contracts/rolling-insights/fixtures', file), 'utf8')) as {
    data: Record<string, unknown[]>
  }
  const games = Object.values(json.data)[0]
  return games.flatMap((g) => normalizeRiGameBox(g)?.lines ?? [])
}

function rowFor(sport: GameLogSport, line: RiBoxLine) {
  const map = normalizedStatMapFor(line, { seasonType: 'regular', seasonTypeLabel: 'Regular Season' })
  const stats = getDailySportNormalizer(sport)!(map).stats
  const inputs = { stats, raw: line.raw }
  return {
    stats,
    played: gameLogLinePlayed(sport, line.group, inputs),
    values: computeGameLogValues(sport, line.group, inputs)!,
    ratioInputs: ratioInputsFor(sport, line.group, stats),
  }
}

describe('NHL', () => {
  const lines = fixtureLines('live.NHL.json')
  const skaters = lines.filter((l) => l.group === 'skaters')
  const goalies = lines.filter((l) => l.group === 'goalies')

  it('the fixture has both groups (control: the parser found lines at all)', () => {
    expect(skaters.length).toBeGreaterThan(10)
    expect(goalies.length).toBeGreaterThan(0)
  })

  it('puts time on ice first and gives every skater the same columns, forward or defenseman', () => {
    const cols = gameLogColumns('NHL', 'skaters').map((c) => c.key)
    expect(cols[0]).toBe('toi')
    expect(cols.indexOf('hits')).toBeLessThan(cols.indexOf('blks'))

    const d = skaters.find((l) => String(l.raw.position) === 'D')!
    const f = skaters.find((l) => String(l.raw.position) !== 'D')!
    expect(d).toBeTruthy()
    expect(f).toBeTruthy()
    const dv = rowFor('NHL', d).values
    const fv = rowFor('NHL', f).values
    expect(Object.keys(dv)).toEqual(Object.keys(fv))
    // Defensemen keep faceoffs won (a number, usually 0) instead of losing the column.
    expect(typeof dv.fow).toBe('number')
  })

  it('reads the mm:ss clock and the box line exactly', () => {
    const line = skaters.find((l) => /^\d+:\d\d$/.test(String(l.raw.time_on_ice)) && Number(l.raw.goals) >= 0)!
    const { values } = rowFor('NHL', line)
    const [m, s] = String(line.raw.time_on_ice).split(':').map(Number)
    expect(values.toi).toBeCloseTo(m + s / 60, 5)
    expect(formatGameLogValue(gameLogColumns('NHL', 'skaters')[0], values.toi)).toBe(String(line.raw.time_on_ice).replace(/^0(\d)/, '$1'))
    expect(values.g).toBe(Number(line.raw.goals))
    expect(values.pts).toBe(Number(line.raw.goals) + Number(line.raw.assists))
    expect(values.hits).toBe(Number(line.raw.hits))
    expect(values.blks).toBe(Number(line.raw.blocks))
    expect(values.ppp).toBe(Number(line.raw.power_play_goals) + Number(line.raw.power_play_assists))
  })

  it('computes save percentage for a goalie who played, and marks the dressed backup as not played', () => {
    const starter = goalies.find((l) => Number(l.raw.shots_against) > 0)!
    const r = rowFor('NHL', starter)
    expect(r.played).toBe(true)
    expect(r.values.svpct).toBeCloseTo(Number(starter.raw.saves) / Number(starter.raw.shots_against), 6)

    const backup = { ...starter, raw: { ...starter.raw, time_on_ice: '0:00', saves: 0, shots_against: 0, goals_allowed: 0, win: 0, loss: 0, overtime_loss: 0 } }
    expect(rowFor('NHL', backup).played).toBe(false)
  })

  it('averages save percentage from totals, not game by game', () => {
    const cols = gameLogColumns('NHL', 'goalies')
    const mk = (sv: number, sa: number) => ({ played: true, values: {}, ratioInputs: { g_sv: sv, g_sa: sa } })
    // 9/10 and 40/50: game-by-game mean is .850, the real rate is 49/60 = .817.
    const s = summarizeGameLog(cols, [mk(9, 10), mk(40, 50)])
    expect(formatGameLogValue(cols.find((c) => c.key === 'svpct')!, s.svpct, true)).toBe('.817')
  })

  it('leaves DNP rows out of averages', () => {
    const cols = gameLogColumns('NHL', 'skaters')
    const s = summarizeGameLog(cols, [
      { played: true, values: { g: 2 } },
      { played: false, values: { g: 0 } },
    ])
    expect(s.g).toBe(2)
  })
})

describe('NBA and NCAAB', () => {
  for (const [sport, file] of [['NBA', 'live.NBA.json'], ['NCAAB', 'live.NCAABB.json']] as const) {
    it(`${sport}: minutes, points and made-attempted splits come straight off the box`, () => {
      const lines = fixtureLines(file)
      expect(lines.length).toBeGreaterThan(5)
      const line = lines.find((l) => Number(l.raw.field_goals_attempted) > 0)!
      const { values, played } = rowFor(sport, line)
      expect(played).toBe(true)
      expect(values.pts).toBe(Number(line.raw.points))
      expect(values.reb).toBe(Number(line.raw.total_rebounds))
      expect(values.fg).toEqual({ made: Number(line.raw.field_goals_made), att: Number(line.raw.field_goals_attempted) })
      expect(typeof values.min).toBe('number')
    })
  }
})

describe('MLB', () => {
  const lines = fixtureLines('live.MLB.json')

  it('splits batting and pitching and shows innings in baseball notation', () => {
    const pitcher = lines.find((l) => l.group === 'pitching' && String(l.raw.IP).includes('.') && !String(l.raw.IP).endsWith('.0'))
    const anyPitcher = pitcher ?? lines.find((l) => l.group === 'pitching' && Number(l.raw.IP) > 0)!
    const { values } = rowFor('MLB', anyPitcher)
    const ip = gameLogColumns('MLB', 'pitching').find((c) => c.key === 'ip')!
    expect(formatGameLogValue(ip, values.ip)).toBe(Number(anyPitcher.raw.IP).toFixed(1))
    expect(values.so).toBe(Number(anyPitcher.raw.K))

    const batter = lines.find((l) => l.group === 'batting' && Number(l.raw.AB) > 0)!
    const b = rowFor('MLB', batter).values
    expect(b.h).toBe(Number(batter.raw.H))
    expect(b.bat_so).toBe(Number(batter.raw.SO))
  })

  it('formats 5 2/3 innings as 5.2 and a full inning carry correctly', () => {
    const ip = gameLogColumns('MLB', 'pitching').find((c) => c.key === 'ip')!
    expect(formatGameLogValue(ip, 5 + 2 / 3)).toBe('5.2')
    expect(formatGameLogValue(ip, 6)).toBe('6.0')
  })
})

describe('soccer', () => {
  it('reads a stored fielder line (production field names)', () => {
    const map = {
      group: 'fielders',
      position: 'Forward',
      stats: { goals: 1, assists: 0, minutes_played: 78, shots_attempted: 4, shots_on_goal: 2, yellow_cards: 1, red_cards: 0 },
    }
    const stats = getDailySportNormalizer('SOCCER')!(map).stats
    const values = computeGameLogValues('SOCCER', 'fielders', { stats, raw: map.stats })!
    expect(values).toMatchObject({ minutes_played: 78, goals: 1, shots: 4, shots_on_target: 2, yellow_card: 1 })
  })
})
