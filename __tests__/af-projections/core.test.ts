import { describe, expect, it } from 'vitest'

import {
  deriveConfidence,
  extractSeasonAggregate,
  parseDepthRole,
  perGameRates,
  recencyWeightedPoints,
  snapShare,
  toWeeklyObservation,
} from '@/lib/af-projections/core'
import type { WeeklyObservation } from '@/lib/af-projections/types'

/** Mirrors the real RI payload shape measured in production 2026-08-11. */
const REAL_STATS = {
  riTeam: 'Washington Commanders',
  position: 'TE',
  riPlayerId: '1234',
  riPlayerName: 'Zach Ertz',
  postseason: null,
  regular_season: {
    games_played: 13,
    targets: 72,
    receptions: 50,
    receiving_yards: 504,
    receiving_touchdowns: 4,
    fumbles: 1,
    fumbles_lost: 0,
    snap_count_offense: 354,
    DK_fantasy_points: 129.4,
    DK_fantasy_points_per_game: 9.95,
  },
}

function week(w: number, ppr: number | null, extra: Partial<WeeklyObservation> = {}): WeeklyObservation {
  return {
    week: w,
    ptsPpr: ppr,
    ptsHalfPpr: ppr == null ? null : ppr - 1,
    ptsStd: ppr == null ? null : ppr - 2,
    offSnaps: null,
    teamOffSnaps: null,
    targets: null,
    ...extra,
  }
}

describe('extractSeasonAggregate', () => {
  it('reads components from regular_season, not the top level', () => {
    const agg = extractSeasonAggregate(REAL_STATS)
    expect(agg).not.toBeNull()
    expect(agg!.gamesPlayed).toBe(13)
    expect(agg!.components.receptions).toBe(50)
    expect(agg!.position).toBe('TE')
    expect(agg!.dkPointsPerGame).toBeCloseTo(9.95)
  })

  it('refuses a payload whose numbers sit only at the top level', () => {
    // This is the shape that makes SportsPlayerRecord.projections inert. If a future
    // refactor flattens payloads, this test should start failing loudly rather than
    // silently admitting last season's totals as a forecast.
    expect(extractSeasonAggregate({ receptions: 50, games_played: 13 })).toBeNull()
  })

  it('refuses when games_played is missing or zero — never defaults it', () => {
    expect(extractSeasonAggregate({ regular_season: { receptions: 50 } })).toBeNull()
    expect(extractSeasonAggregate({ regular_season: { games_played: 0, receptions: 50 } })).toBeNull()
  })

  it('drops non-numeric components rather than coercing them', () => {
    const agg = extractSeasonAggregate({
      regular_season: { games_played: 4, receptions: 10, snap_counts: { offense: 1 }, note: 'n/a' },
    })
    expect(agg!.components.receptions).toBe(10)
    expect(agg!.components.snap_counts).toBeUndefined()
    expect(agg!.components.note).toBeUndefined()
  })
})

describe('perGameRates', () => {
  it('divides every component by games played', () => {
    const rates = perGameRates(extractSeasonAggregate(REAL_STATS)!)
    expect(rates.receptions).toBeCloseTo(50 / 13)
    expect(rates.targets).toBeCloseTo(72 / 13)
  })

  it('excludes games_played itself', () => {
    expect(perGameRates(extractSeasonAggregate(REAL_STATS)!).games_played).toBeUndefined()
  })
})

describe('toWeeklyObservation', () => {
  it('maps the confirmed Sleeper key vocabulary', () => {
    const o = toWeeklyObservation(3, {
      pts_ppr: 24.4,
      pts_half_ppr: 21.4,
      pts_std: 18.4,
      off_snp: 62,
      tm_off_snp: 70,
      rec_tgt: 7,
    })
    expect(o).toEqual({
      week: 3,
      ptsPpr: 24.4,
      ptsHalfPpr: 21.4,
      ptsStd: 18.4,
      offSnaps: 62,
      teamOffSnaps: 70,
      targets: 7,
    })
  })

  it('yields nulls for absent keys rather than zeros', () => {
    const o = toWeeklyObservation(1, { pts_ppr: 5 })
    expect(o!.ptsStd).toBeNull()
    expect(o!.targets).toBeNull()
  })
})

describe('recencyWeightedPoints', () => {
  it('weights recent weeks more heavily than old ones', () => {
    // Flat 10s except a late spike; the weighted mean must exceed the plain mean.
    const obs = [week(1, 10), week(2, 10), week(3, 10), week(4, 30)]
    const plainMean = (10 + 10 + 10 + 30) / 4
    const r = recencyWeightedPoints(obs, 'ppr')!
    expect(r.value).toBeGreaterThan(plainMean)
    expect(r.weeksUsed).toBe(4)
  })

  it('excludes weeks with no observation, but keeps a real zero', () => {
    const withNull = recencyWeightedPoints([week(1, 10), week(2, null), week(3, 10)], 'ppr')!
    expect(withNull.weeksUsed).toBe(2)
    expect(withNull.value).toBeCloseTo(10)

    // A genuine 0 is production, not absence, and must drag the mean down.
    const withZero = recencyWeightedPoints([week(1, 10), week(2, 0), week(3, 10)], 'ppr')!
    expect(withZero.weeksUsed).toBe(3)
    expect(withZero.value).toBeLessThan(10)
  })

  it('returns null when no week carries the requested format', () => {
    const obs: WeeklyObservation[] = [
      { week: 1, ptsPpr: 10, ptsHalfPpr: null, ptsStd: null, offSnaps: null, teamOffSnaps: null, targets: null },
    ]
    expect(recencyWeightedPoints(obs, 'std')).toBeNull()
    expect(recencyWeightedPoints([], 'ppr')).toBeNull()
  })

  it('reads the requested scoring format, not whichever is present', () => {
    const obs = [week(1, 20)] // ppr 20, half 19, std 18
    expect(recencyWeightedPoints(obs, 'ppr')!.value).toBeCloseTo(20)
    expect(recencyWeightedPoints(obs, 'half_ppr')!.value).toBeCloseTo(19)
    expect(recencyWeightedPoints(obs, 'std')!.value).toBeCloseTo(18)
  })
})

describe('snapShare', () => {
  it('ignores weeks missing either side of the ratio', () => {
    const obs = [
      week(1, 10, { offSnaps: 30, teamOffSnaps: 60 }),
      week(2, 10, { offSnaps: 30, teamOffSnaps: null }),
    ]
    expect(snapShare(obs)).toBeCloseTo(0.5)
    expect(snapShare([week(1, 10)])).toBeNull()
  })
})

describe('parseDepthRole', () => {
  it('extracts ordinals, treating an unnumbered skill slot as first', () => {
    expect(parseDepthRole('WR2')).toEqual({ slot: 'WR2', ordinal: 2 })
    expect(parseDepthRole('RB')).toEqual({ slot: 'RB', ordinal: 1 })
    expect(parseDepthRole('QB')).toEqual({ slot: 'QB', ordinal: 1 })
  })

  it('returns no ordinal for non-skill slots', () => {
    expect(parseDepthRole('LS')).toEqual({ slot: 'LS', ordinal: null })
    expect(parseDepthRole('KR')).toEqual({ slot: 'KR', ordinal: null })
  })

  it('returns null for an absent slot', () => {
    expect(parseDepthRole(null)).toBeNull()
    expect(parseDepthRole('  ')).toBeNull()
  })
})

describe('deriveConfidence', () => {
  const base = {
    gamesPlayed: 17,
    weeklyWeeksUsed: 8,
    hasDepthRole: true,
    hasInjuryStatus: true,
    basisIsPriorSeason: false,
  }

  it('is never constant — full coverage outranks minimal coverage', () => {
    const full = deriveConfidence(base)
    const thin = deriveConfidence({
      gamesPlayed: 2,
      weeklyWeeksUsed: 0,
      hasDepthRole: false,
      hasInjuryStatus: false,
      basisIsPriorSeason: true,
    })
    expect(full.score).toBeGreaterThan(thin.score)
    expect(full.level).toBe('high')
    expect(thin.level).toBe('low')
  })

  it('drops confidence when weekly observations are unavailable', () => {
    // ~47% of players cannot join to weekly logs (sleeperId is 53.1% populated).
    const withWeekly = deriveConfidence(base)
    const withoutWeekly = deriveConfidence({ ...base, weeklyWeeksUsed: 0 })
    expect(withoutWeekly.score).toBeLessThan(withWeekly.score)
    expect(withoutWeekly.reasons.join(' ')).toContain('not matched to a Sleeper id')
  })

  it('discounts a prior-season baseline', () => {
    expect(deriveConfidence({ ...base, basisIsPriorSeason: true }).score).toBeLessThan(
      deriveConfidence(base).score,
    )
  })

  it('never reports absence of an injury designation as health', () => {
    const reasons = deriveConfidence({ ...base, hasInjuryStatus: false }).reasons.join(' ')
    expect(reasons).toContain('not a statement of health')
    expect(reasons.toLowerCase()).not.toContain('healthy')
  })
})
