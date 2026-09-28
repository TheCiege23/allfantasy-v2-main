/**
 * MLB weekly scoring: Rolling Insights box lines -> engine categories -> points, with the league's panel.
 *
 * 🛑 BATTING AND PITCHING SHARE FIELD NAMES (`H`, `HR`, `BB`, `R`, `1B`…) AND MEAN OPPOSITE THINGS, and
 * innings are baseball notation (5.2 = 5⅔). The fixture is the committed Rolling Insights `/live` MLB
 * response, run through the ingest's own box parser, so these read exactly what production stores.
 */
import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { normalizeRiGameBox } from '@/lib/sports-data/rollingInsightsGameLogs'
import { inningsFromBaseballNotation, normalizeMlbGameStats } from '@/lib/scoring-runtime/mlbStatNormalization'
import { aggregateWeeklyStats, getDailySportNormalizer, isDailyStatSport } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { bridgeSportUiScoringStore, UI_SCORING_STORES } from '@/lib/redraft/uiScoringStoreBridge'
import { scoreStatsWithCategories } from '@/lib/redraft/scoringEngine'
import { getScoringCategories } from '@/lib/sportConfig'
import { MLB_STAT_KEYS, buildFullMlbScoringConfig } from '@/lib/mlb-scoring/MlbScoringPresets'
import { DATE_WINDOWED_SPORTS } from '@/lib/redraft/weekGames'
import { resolveDailySportSeasonStart } from '@/lib/season-week/dailySportSeasonStarts'

const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'contracts/rolling-insights/fixtures/live.MLB.json'), 'utf8'))
const games: unknown[] = Array.isArray(raw) ? raw : (raw.data?.MLB ?? raw.data ?? Object.values(raw)[0])

/** What the ingest stores as `normalizedStatMap` for one box line (rollingInsightsGameLogs.normalizedMapFor). */
function stored(line: { group: string; raw: Record<string, unknown> }) {
  const stats: Record<string, number> = {}
  for (const [k, v] of Object.entries(line.raw)) {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null
    if (n != null) stats[k] = n
  }
  return { group: line.group, stats }
}

const LINES = games.flatMap((g) => normalizeRiGameBox(g)?.lines ?? [])
const MLB_CATEGORY_KEYS = new Set(getScoringCategories('MLB').map((c) => c.key))

describe('normalizeMlbGameStats — against the captured Rolling Insights response', () => {
  it('reads both groups from the fixture, and every field is either scored or known non-scoring', () => {
    expect(LINES.some((l) => l.group === 'batting')).toBe(true)
    expect(LINES.some((l) => l.group === 'pitching')).toBe(true)
    const unmapped = new Set(LINES.flatMap((l) => normalizeMlbGameStats(stored(l)).unmappedKeys))
    expect([...unmapped]).toEqual([])
  })

  it('every emitted key is a real MLB engine category — nothing is scored under a name the engine ignores', () => {
    for (const l of LINES) for (const k of Object.keys(normalizeMlbGameStats(stored(l)).stats)) expect(MLB_CATEGORY_KEYS.has(k)).toBe(true)
  })

  it('🛑 the group decides the key: a pitcher’s hits and walks ALLOWED never land on batting keys', () => {
    const p = normalizeMlbGameStats({ group: 'pitching', stats: { H: 5, BB: 2, HR: 1, R: 3, K: 7, ER: 2, IP: 6 } }).stats
    expect(p).toMatchObject({ p_h: 5, p_bb: 2, p_hr: 1, p_r: 3, so: 7, er: 2 })
    expect(p.hr).toBeUndefined()
    expect(p.bb).toBeUndefined()
    const b = normalizeMlbGameStats({ group: 'batting', stats: { SO: 2, BB: 1, HR: 1, '1B': 1, '2B': 1, '3B': 0 } }).stats
    expect(b).toMatchObject({ bat_so: 2, bb: 1, hr: 1, single: 1, double: 1, tb: 1 + 2 + 4 })
    expect(b.so).toBeUndefined() // batter strikeouts must not earn a pitcher's points
  })

  it('🛑 innings are baseball notation, converted per game', () => {
    expect(inningsFromBaseballNotation(5.2)).toBeCloseTo(5 + 2 / 3, 10)
    expect(inningsFromBaseballNotation(0.1)).toBeCloseTo(1 / 3, 10)
    expect(inningsFromBaseballNotation(7)).toBe(7)
    // Two starts, 6.2 and 5.1 innings = 12 innings, not 11.3.
    const week = aggregateWeeklyStats(
      [{ group: 'pitching', stats: { IP: 6.2, ER: 2 } }, { group: 'pitching', stats: { IP: 5.1, ER: 4 } }],
      normalizeMlbGameStats,
    ).stats
    expect(week.ip).toBeCloseTo(12, 10)
    expect(week.outs).toBe(36)
    expect(week.qs).toBe(1) // only the first start was 6+ IP with 3 or fewer ER
  })

  it('a two-way player’s batting and pitching lines sum into one week without colliding', () => {
    const week = aggregateWeeklyStats(
      [{ group: 'batting', stats: { HR: 1, SO: 1, R: 1 } }, { group: 'pitching', stats: { K: 9, R: 2, IP: 6 } }],
      normalizeMlbGameStats,
    ).stats
    expect(week).toMatchObject({ hr: 1, bat_so: 1, r: 1, so: 9, p_r: 2, ip: 6 })
  })

  it('a line with no group is not guessed', () => {
    expect(normalizeMlbGameStats({ stats: { H: 2 } })).toEqual({ stats: {}, unmappedKeys: ['group:(missing)'] })
  })

  it('MLB is a daily sport now, with a week window — and no opener is invented for 2027', () => {
    expect(isDailyStatSport('MLB')).toBe(true)
    expect(getDailySportNormalizer('MLB')).toBe(normalizeMlbGameStats)
    expect(DATE_WINDOWED_SPORTS).toContain('MLB')
    expect(resolveDailySportSeasonStart('MLB', 2027)).toBeNull()
  })
})

describe('MLB panel -> engine bridge', () => {
  it('every panel key it maps is a real panel key, and every engine key is a real MLB category', () => {
    const panelKeys = new Set<string>(MLB_STAT_KEYS)
    for (const [uiKey, engineKey] of Object.entries(UI_SCORING_STORES.MLB!.keyMap)) {
      expect(panelKeys.has(uiKey)).toBe(true)
      expect(MLB_CATEGORY_KEYS.has(engineKey)).toBe(true)
    }
  })

  it('🛑 an UNSAVED league scores what its panel displays — the AllFantasy default preset', () => {
    const overrides = bridgeSportUiScoringStore('MLB', {})!
    expect(overrides).toMatchObject({ single: 1, double: 2, triple: 3, hr: 4, tb: 0, ip: 3, so: 1, bat_so: -1, hld: 3, er: -2, p_h: -1, qs: 3 })
  })

  it('a SAVED panel wins over the default', () => {
    const rules = { ...buildFullMlbScoringConfig('af_default'), singles: 2, holds: 5 }
    expect(bridgeSportUiScoringStore('MLB', { mlb_scoring_config: { rules } })).toMatchObject({ single: 2, hld: 5 })
  })

  it('end to end: a real fixture pitcher and batter score what the default panel says', () => {
    const categories = getScoringCategories('MLB')
    const overrides = bridgeSportUiScoringStore('MLB', {})!
    // A 6.2-inning, 7-K win with 2 ER, 5 hits and 1 walk allowed.
    const p = normalizeMlbGameStats({ group: 'pitching', stats: { IP: 6.2, K: 7, W: 1, ER: 2, H: 5, BB: 1, HBP: 0 } }).stats
    const pitcherPts = scoreStatsWithCategories(categories, p, overrides)
    // 20/3*3 IP + 7 K + 5 W + 2*-2 ER + 5*-1 H + 1*-1 BB + QS 3 = 20 + 7 + 5 - 4 - 5 - 1 + 3 = 25
    expect(pitcherPts).toBeCloseTo(25, 10)
    // 2-for-4 with a double and a homer, 2 R, 3 RBI, 1 K.
    const b = normalizeMlbGameStats({ group: 'batting', stats: { AB: 4, H: 2, '2B': 1, HR: 1, R: 2, RBI: 3, SO: 1 } }).stats
    // double 2 + HR 4 + R 2 + RBI 3 + K -1; total bases scored at 0 by the panel (no double count).
    expect(scoreStatsWithCategories(categories, b, overrides)).toBeCloseTo(10, 10)
  })
})
