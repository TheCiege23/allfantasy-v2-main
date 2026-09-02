/**
 * Kicker component scoring.
 *
 * 🛑 THE HOLE THIS FILLS. The engine had no kicker path at all — measured on production
 * 2026-09-02, 41 NFL kicker rows existed in the whole table, all from a provider points column or
 * the DraftKings season proxy, with no league rule ever applied.
 *
 * 🛑 AND THE HOLE IT DOES NOT PRETEND TO FILL. Leagues score by distance (`fgm_40_49` etc.); the
 * stat source carries totals and a longest, never a distribution. Those rules are NAMED as
 * unscored rather than approximated, because unlike the IDP tackle split there is no measured
 * distribution anywhere in the pipeline to base a prior on.
 */

import { describe, expect, it } from 'vitest'
import {
  UNSCOREABLE_RULE_KEYS,
  extractKickerComponents,
  isKickerPosition,
  scoreKickerComponents,
} from '@/lib/af-projections/kickerScoring'

/** A real production shape: Rolling Insights season aggregate for a kicker. */
const RI_SEASON = {
  field_goals_made: 24,
  field_goals_attempted: 30,
  field_goals_long: 54,
  extra_points_made: 39,
  extra_points_attempted: 41,
}

describe('position gate', () => {
  it('accepts kickers and rejects everything else', () => {
    expect(isKickerPosition('K')).toBe(true)
    expect(isKickerPosition('PK')).toBe(true)
    expect(isKickerPosition('k')).toBe(true)
    // 🛑 A PUNTER IS NOT A KICKER. `P` is also MLB "pitcher"; scoring either here would be wrong.
    expect(isKickerPosition('P')).toBe(false)
    expect(isKickerPosition('QB')).toBe(false)
    expect(isKickerPosition(null)).toBe(false)
    expect(isKickerPosition('')).toBe(false)
  })
})

describe('extraction', () => {
  it('reads makes and DERIVES misses from attempts', () => {
    const c = extractKickerComponents(RI_SEASON, 'ri_season')
    expect(c.fieldGoalMade).toBe(24)
    expect(c.fieldGoalMissed).toBe(6)      // 30 − 24, exact, not approximated
    expect(c.extraPointMade).toBe(39)
    expect(c.extraPointMissed).toBe(2)     // 41 − 39
  })

  it('omits misses when attempts are absent — never assumes zero', () => {
    // 🛑 "He missed none" and "we do not know" are different claims, and only one costs points.
    const c = extractKickerComponents({ field_goals_made: 24, extra_points_made: 39 }, 'ri_season')
    expect(c.fieldGoalMade).toBe(24)
    expect(c.fieldGoalMissed).toBeUndefined()
    expect(c.extraPointMissed).toBeUndefined()
  })

  it('never derives a negative miss count from inconsistent data', () => {
    const c = extractKickerComponents(
      { field_goals_made: 30, field_goals_attempted: 24 },
      'ri_season',
    )
    expect(c.fieldGoalMissed).toBe(0)
  })

  it('reads the Sleeper weekly vocabulary too', () => {
    const c = extractKickerComponents({ fgm: 2, fga: 3, xpm: 4, xpa: 4 }, 'sleeper_weekly')
    expect(c.fieldGoalMade).toBe(2)
    expect(c.fieldGoalMissed).toBe(1)
    expect(c.extraPointMade).toBe(4)
    expect(c.extraPointMissed).toBe(0)
  })

  it('returns nothing for a stat map with no kicker keys', () => {
    expect(extractKickerComponents({ rushing_yards: 100 }, 'ri_season')).toEqual({})
  })
})

describe('scoring', () => {
  const components = extractKickerComponents(RI_SEASON, 'ri_season')

  it('applies a league\'s flat rules', () => {
    const r = scoreKickerComponents({
      components,
      rules: { fgm: 3, fgmiss: -1, xpm: 1, xpmiss: -1 },
    })!
    // 24×3 + 6×−1 + 39×1 + 2×−1 = 72 − 6 + 39 − 2 = 103
    expect(r.points).toBe(103)
    expect(r.scoredComponents).toContain('fieldGoalMade')
    expect(r.distanceRulesIgnored).toBe(false)
  })

  it('names a component the league does not score, rather than dropping it', () => {
    const r = scoreKickerComponents({ components, rules: { fgm: 3 } })!
    expect(r.points).toBe(72)
    expect(r.unscoredComponents).toContain('extraPointMade')
    expect(r.unscoredComponents).toContain('fieldGoalMissed')
  })

  it('returns null when the league scores nothing this engine can read', () => {
    // The ladder must fall through, not record a zero.
    expect(scoreKickerComponents({ components, rules: { rec: 1 } })).toBeNull()
  })

  it('persists componentAmounts so a league rescore is possible later', () => {
    const r = scoreKickerComponents({ components, rules: { fgm: 3 } })!
    expect(r.componentAmounts.fieldGoalMade).toBe(24)
    expect(r.componentAmounts.extraPointMade).toBe(39)
  })
})

describe('🛑 distance rules are refused loudly, not approximated', () => {
  const components = extractKickerComponents(RI_SEASON, 'ri_season')

  it('names every distance rule the league set that the data cannot honour', () => {
    const r = scoreKickerComponents({
      components,
      rules: { fgm: 3, xpm: 1, fgm_40_49: 4, fgm_50p: 5 },
    })!
    expect(r.distanceRulesIgnored).toBe(true)
    expect(r.unscoredComponents).toContain('fgm_40_49')
    expect(r.unscoredComponents).toContain('fgm_50p')
    // The reason must be a sentence a manager can act on, not a flag.
    expect(r.approximations[0]).toMatch(/distance/i)
    expect(r.approximations[0]).toMatch(/understated/i)
  })

  it('does NOT invent a bucket distribution — flat rules alone decide the points', () => {
    const withBuckets = scoreKickerComponents({
      components,
      rules: { fgm: 3, xpm: 1, fgm_50p: 5 },
    })!
    const withoutBuckets = scoreKickerComponents({
      components,
      rules: { fgm: 3, xpm: 1 },
    })!
    /*
     * Same points either way. `idpScoring` DOES apportion combined tackles with a population prior
     * — but that prior was measured from 5,186 real rows. There is no per-distance data anywhere
     * in this pipeline, so a distribution here would be invented, and an invented distribution
     * applied to a real rule produces a number that looks measured and is not.
     */
    expect(withBuckets.points).toBe(withoutBuckets.points)
    expect(withBuckets.distanceRulesIgnored).toBe(true)
    expect(withoutBuckets.distanceRulesIgnored).toBe(false)
  })

  it('ignores a distance rule set to 0 — that is not a rule the league is using', () => {
    const r = scoreKickerComponents({ components, rules: { fgm: 3, fgm_50p: 0 } })!
    expect(r.distanceRulesIgnored).toBe(false)
  })

  it('a bucket-ONLY league gets an honest refusal, not a fabricated score', () => {
    const r = scoreKickerComponents({ components, rules: { fgm_40_49: 4, fgm_50p: 5 } })
    expect(r).toBeNull()
  })

  it('the unscoreable list covers every bucket key seen in real league settings', () => {
    for (const k of ['fgm_0_19', 'fgm_20_29', 'fgm_30_39', 'fgm_40_49', 'fgm_50_59',
                     'fgm_50p', 'fgm_60p', 'fgmiss_50p', 'fgm_yds', 'fgm_yds_over_30']) {
      expect(UNSCOREABLE_RULE_KEYS).toContain(k)
    }
  })
})
