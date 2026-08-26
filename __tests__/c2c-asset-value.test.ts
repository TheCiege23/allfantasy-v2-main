import { describe, expect, it } from 'vitest'

import {
  C2C_WEIGHTED_POINTS,
  c2cAssetValue,
  c2cSideWeight,
  cantonToCampusRatio,
} from '@/lib/c2c/c2cAssetValue'
import { projectDevyOutlook } from '@/lib/trade-intel/devyOutlook'

/**
 * The scenario: a C2C manager is offered a pro receiver averaging 12 a week for
 * a college receiver averaging 15. On a raw points column the college player
 * looks like the better asset. He is not — campus points count at 0.4 and canton
 * at 0.6, so 15 campus is 6 to the official score and 12 canton is 7.2.
 *
 * ⚠ Dormant today: `c2c_leagues` is empty and `player_weekly_scores` holds no
 * NCAAF rows at all, so every real college player returns null here rather than
 * a number. These tests supply points directly so the path is exercised now.
 */

const LEAGUE = { campusScoreWeight: 0.4, cantonScoreWeight: 0.6 }

const OUTLOOK = projectDevyOutlook({
  player: { recruitingComposite: 0.97, projectedDraftRound: 1 },
  draftEligibleYear: 2027,
  currentSeason: 2026,
})

describe('the side weight is what makes C2C different', () => {
  it('weights campus points below canton points', () => {
    const campus = c2cAssetValue({ side: 'campus', pointsPerWeek: 15, league: LEAGUE })
    const canton = c2cAssetValue({ side: 'canton', pointsPerWeek: 12, league: LEAGUE })

    expect(campus.rawPointsPerWeek).toBe(15)
    expect(campus.weightedPointsPerWeek).toBe(6)
    expect(canton.weightedPointsPerWeek).toBeCloseTo(7.2, 5)
  })

  /**
   * ⚠ THE TRADE THIS PREVENTS. Raw points say the college player is better by 3;
   * weighted points say the pro is better by 1.2. The raw column is the one a
   * manager sees by default.
   */
  it('reverses the verdict a raw points column would give', () => {
    const campus = c2cAssetValue({ side: 'campus', pointsPerWeek: 15, league: LEAGUE })
    const canton = c2cAssetValue({ side: 'canton', pointsPerWeek: 12, league: LEAGUE })

    expect(campus.rawPointsPerWeek!).toBeGreaterThan(canton.rawPointsPerWeek!)
    expect(campus.weightedPointsPerWeek!).toBeLessThan(canton.weightedPointsPerWeek!)
  })

  it('reports how much more a canton point is worth', () => {
    expect(cantonToCampusRatio(LEAGUE)).toBe(1.5)
  })

  it('defaults to the schema weights, not an even split', () => {
    // 0.5/0.5 would silently reprice every college player in a league we failed
    // to load.
    expect(c2cSideWeight('campus', null)).toBe(0.4)
    expect(c2cSideWeight('canton', null)).toBe(0.6)
    expect(c2cSideWeight('campus', { campusScoreWeight: 0.5, cantonScoreWeight: 0.5 })).toBe(0.5)
  })

  it('a league that gives campus no weight has an undefined ratio, not an infinite one', () => {
    expect(cantonToCampusRatio({ campusScoreWeight: 0, cantonScoreWeight: 1 })).toBeNull()
  })
})

describe('absent scoring is null, never zero', () => {
  it('a college player we hold no scores for is unpriced, not scoreless', () => {
    const v = c2cAssetValue({ side: 'campus', pointsPerWeek: null, league: LEAGUE })

    expect(v.rawPointsPerWeek).toBeNull()
    expect(v.weightedPointsPerWeek).toBeNull()
    expect(v.basis).toMatch(/not a zero/)
  })

  it('names the real reason: there is no NCAAF scoring at all', () => {
    const v = c2cAssetValue({ side: 'campus', pointsPerWeek: null, league: LEAGUE })
    expect(v.gaps.join(' ')).toMatch(/no NCAAF weekly scoring in the database/)
  })

  it('tags the scale so weighted points are never mistaken for another unit', () => {
    expect(c2cAssetValue({ side: 'canton', pointsPerWeek: 10 }).scale).toBe(C2C_WEIGHTED_POINTS)
  })
})

describe('production and the option are kept apart', () => {
  it('a campus player carries both, on separate scales', () => {
    const v = c2cAssetValue({
      side: 'campus',
      pointsPerWeek: 12,
      league: LEAGUE,
      devyRank: 4,
      outlook: OUTLOOK,
      name: 'Campus WR',
    })

    expect(v.weightedPointsPerWeek).toBeCloseTo(4.8, 5)
    expect(v.devyOption?.value).toBeGreaterThan(0)
    expect(v.devyOption?.scale).toBe('devy-points')
    expect(v.gaps.join(' ')).toMatch(/cannot be added to the production/)
  })

  /**
   * ⚠ A canton player is already in the NFL. Pricing an "option on his pro
   * future" would be pricing an event that has happened.
   */
  it('a canton player carries no option at all', () => {
    const v = c2cAssetValue({
      side: 'canton',
      pointsPerWeek: 12,
      league: LEAGUE,
      devyRank: 4,
      outlook: OUTLOOK,
    })
    expect(v.devyOption).toBeNull()
  })

  it('an unranked campus player says his option is unranked rather than worthless', () => {
    const v = c2cAssetValue({
      side: 'campus',
      pointsPerWeek: 12,
      league: LEAGUE,
      devyRank: null,
      outlook: OUTLOOK,
    })
    expect(v.devyOption?.value).toBeNull()
    expect(v.basis).toMatch(/not ranked/)
  })
})
