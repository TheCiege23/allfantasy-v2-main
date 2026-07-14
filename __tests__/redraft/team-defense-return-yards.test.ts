/**
 * G9 — DST return-yardage scoring (kick/punt return yards). Pure tests.
 *
 * Return TDs already score via `def_st_td` (G8). G9 adds RETURN YARDS as
 * commissioner-enable categories that are inert (0 pts) by default. Proves the
 * Sleeper mapping (`def_kr_yd`/`def_pr_yd`), default-0 inertness, override
 * scoring, and the UI→engine bridge — all through the authoritative scorer.
 */
import { describe, expect, it } from 'vitest'
import { scoreStatsWithCategories } from '@/lib/redraft/scoringEngine'
import { getScoringCategories } from '@/lib/sportConfig'
import { normalizeNflTeamDefenseWeeklyStats } from '@/lib/redraft/playerWeeklyScoreService'
import { bridgeScoringKey } from '@/lib/nfl-scoring/scoringKeyBridge'

const round2 = (n: number) => Math.round(n * 100) / 100
const cats = getScoringCategories('NFL', [])
const score = (rawStats: Record<string, number>, overrides: Record<string, number> = {}) =>
  round2(scoreStatsWithCategories(cats, rawStats, overrides))

describe('G9 — return-yard categories exist and are inert by default', () => {
  it('exposes def_kr_yd and def_pr_yd in the NFL config', () => {
    const keys = new Set(cats.map((c) => c.key))
    expect(keys.has('def_kr_yd')).toBe(true)
    expect(keys.has('def_pr_yd')).toBe(true)
  })
  it('scores 0 by default (return yards do not count unless enabled)', () => {
    expect(score({ def_kr_yd: 120, def_pr_yd: 45 })).toBe(0)
  })
  it('preserves existing def_st_td (return TDs) untouched', () => {
    expect(score({ def_st_td: 1 })).toBe(6) // unchanged from G8
  })
})

describe('G9 — commissioner override scores return yards', () => {
  it('scores kick + punt return yards at the configured per-yard value', () => {
    // 120 KR yds @0.04 + 45 PR yds @0.1 = 4.8 + 4.5 = 9.3
    expect(score({ def_kr_yd: 120, def_pr_yd: 45 }, { def_kr_yd: 0.04, def_pr_yd: 0.1 })).toBe(9.3)
  })
  it('does not affect other DST categories', () => {
    // Enabling KR yards must not change a sack-only line.
    expect(score({ def_sack: 2 }, { def_kr_yd: 0.04 })).toBe(score({ def_sack: 2 }))
  })
})

describe('G9 — Sleeper provider mapping', () => {
  it('maps def_kr_yd / def_pr_yd (and aliases) to canonical keys', () => {
    expect(normalizeNflTeamDefenseWeeklyStats({ def_kr_yd: 120, def_pr_yd: 30 })).toMatchObject({ def_kr_yd: 120, def_pr_yd: 30 })
    expect(normalizeNflTeamDefenseWeeklyStats({ kr_yd: 80, pr_yd: 12 })).toMatchObject({ def_kr_yd: 80, def_pr_yd: 12 })
  })
  it('does not emit return-yard keys when the provider omits them', () => {
    expect(normalizeNflTeamDefenseWeeklyStats({ sack: 2 })).toEqual({ def_sack: 2 })
  })
})

describe('G9 — UI → engine bridge', () => {
  it('maps the surfaced Special-Teams return-yard keys to engine keys', () => {
    expect(bridgeScoringKey('st_kick_return_yards')).toBe('def_kr_yd')
    expect(bridgeScoringKey('st_punt_return_yards')).toBe('def_pr_yd')
    expect(bridgeScoringKey('dst_kick_return_yards')).toBe('def_kr_yd')
    expect(bridgeScoringKey('dst_punt_return_yards')).toBe('def_pr_yd')
    // Identity passthrough for the engine keys themselves.
    expect(bridgeScoringKey('def_kr_yd')).toBe('def_kr_yd')
  })
})
