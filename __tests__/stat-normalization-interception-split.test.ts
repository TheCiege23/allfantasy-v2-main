/**
 * A thrown interception and a team defense's interception are two different stats.
 *
 * 🛑 THE BUG THIS PINS. `NFL_ALIASES` renamed BOTH Sleeper's `pass_int` (a quarterback throwing
 * one) and `int` (a team defense catching one) to `interception`. Measured on staging
 * 2026-09-16, every NFL row carrying either:
 *
 *   2,016 passer rows      raw `pass_int`   → normalized `interception`
 *   1,952 team-defense rows raw `int`       → normalized `interception`   (ids like `ARI`)
 *
 * Two consequences, both silent:
 *   - the registry template scores `interception` at −2 (a THROWN pick), so the stored
 *     `fantasyPoints` of every team defense LOST two points for each interception it made;
 *   - `computeLeagueProjectedPoints` reads neither name, so league-scored actuals ignored both
 *     sides — quarterbacks were never charged for a pick, defenses never paid for one.
 *
 * Individual defenders were never part of this: their feed key is `idp_int`, which the
 * normalizer leaves alone.
 */

import { describe, expect, it } from 'vitest'
import { normalizeStatPayload } from '@/lib/schedule-stats/StatNormalizationService'
import { getDefaultScoringTemplate } from '@/lib/scoring-defaults/ScoringDefaultsRegistry'
import { computeFantasyPoints } from '@/lib/scoring-defaults/FantasyPointCalculator'
import { computeLeagueProjectedPoints } from '@/lib/projections/leagueScoring'

// Shapes taken from real staging rows: a quarterback game and a team-defense game.
const QB_RAW = { pass_yd: 255, pass_td: 3, pass_int: 2, pass_att: 30, rush_yd: 11, fum_lost: 0 }
const DEF_RAW = { int: 2, sack: 3, fum_rec: 1, def_td: 0, pts_allow: 17 }

const TEMPLATE = getDefaultScoringTemplate('NFL', 'standard').rules
const templateWeight = (key: string) => TEMPLATE.find((r) => r.statKey === key)?.pointsValue ?? 0

// A Sleeper rulebook in the vocabulary leagues publish (weights from a real staging league).
const SLEEPER_BOOK = { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, fum_lost: -2, int: 2, sack: 1, fum_rec: 2 }

describe('normalizeStatPayload keeps the two interceptions apart', () => {
  it('writes a thrown pick under the template key AND the league key', () => {
    const out = normalizeStatPayload('NFL', QB_RAW)
    expect(out.interception).toBe(2)
    expect(out.pass_int).toBe(2)
    expect(out.dst_interception).toBeUndefined()
  })

  it('writes a team defense’s pick under the DST key, never the thrown one', () => {
    const out = normalizeStatPayload('NFL', DEF_RAW)
    expect(out.dst_interception).toBe(2)
    expect(out.interception).toBeUndefined()
    expect(out.pass_int).toBeUndefined()
  })

  it('leaves an individual defender’s `idp_int` alone', () => {
    expect(normalizeStatPayload('NFL', { idp_int: 1 })).toEqual({ idp_int: 1 })
  })

  it('applies the same split to college rows, which share the NFL map', () => {
    expect(normalizeStatPayload('NCAAF', { pass_int: 1 })).toEqual({ interception: 1, pass_int: 1 })
    expect(normalizeStatPayload('NCAAF', { int: 1 })).toEqual({ dst_interception: 1 })
  })
})

describe('re-normalizing a stored map changes nothing', () => {
  /*
   * ⚠ `projectionAccuracy` feeds STORED `normalized_stat_map` rows back through this function.
   * Writing a thrown pick under two names is only safe if a second pass does not fold `pass_int`
   * into `interception` again — that would charge the quarterback twice.
   */
  it('is idempotent for a quarterback and a team defense', () => {
    for (const raw of [QB_RAW, DEF_RAW]) {
      const once = normalizeStatPayload('NFL', raw)
      expect(normalizeStatPayload('NFL', once)).toEqual(once)
    }
  })

  it('leaves a legacy merged row exactly as it was stored', () => {
    // Rows written before this fix carry only `interception`. Until the backfill rewrites them,
    // they must keep scoring as they always have — not be reinterpreted.
    expect(normalizeStatPayload('NFL', { interception: 2, passing_yards: 200 })).toEqual({ interception: 2, passing_yards: 200 })
  })

  it('never overwrites an interception count the input already states', () => {
    expect(normalizeStatPayload('NFL', { interception: 1, pass_int: 3 })).toEqual({ interception: 1, pass_int: 3 })
  })

  it('scores a thrown pick once through the template, on the first pass and the second', () => {
    const once = normalizeStatPayload('NFL', { pass_int: 1 })
    const twice = normalizeStatPayload('NFL', once)
    expect(computeFantasyPoints(once, TEMPLATE)).toBe(templateWeight('interception'))
    expect(computeFantasyPoints(twice, TEMPLATE)).toBe(templateWeight('interception'))
  })
})

describe('the stored fantasyPoints column (registry template)', () => {
  it('still charges the quarterback for a thrown pick', () => {
    expect(templateWeight('interception')).toBeLessThan(0)
    expect(computeFantasyPoints(normalizeStatPayload('NFL', { pass_int: 2 }), TEMPLATE)).toBe(2 * templateWeight('interception'))
  })

  it('pays a team defense for its picks instead of charging it', () => {
    expect(templateWeight('dst_interception')).toBeGreaterThan(0)
    expect(computeFantasyPoints(normalizeStatPayload('NFL', { int: 2 }), TEMPLATE)).toBe(2 * templateWeight('dst_interception'))
  })
})

describe('league-scored actuals (computeLeagueProjectedPoints)', () => {
  it('charges the quarterback the league’s pass_int weight', () => {
    const r = computeLeagueProjectedPoints(normalizeStatPayload('NFL', QB_RAW), SLEEPER_BOOK)!
    expect(r.contributions.pass_int).toBe(-4)
  })

  it('pays a team defense the league’s int weight', () => {
    const r = computeLeagueProjectedPoints(normalizeStatPayload('NFL', DEF_RAW), SLEEPER_BOOK)!
    expect(r.contributions.int).toBe(4)
  })

  it('never lets one side of the ball score the other’s pick', () => {
    const qb = computeLeagueProjectedPoints(normalizeStatPayload('NFL', QB_RAW), SLEEPER_BOOK)!
    const def = computeLeagueProjectedPoints(normalizeStatPayload('NFL', DEF_RAW), SLEEPER_BOOK)!
    expect(qb.contributions.int).toBeUndefined()
    expect(def.contributions.pass_int).toBeUndefined()
  })
})
