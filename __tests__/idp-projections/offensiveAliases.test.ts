import { describe, expect, it } from 'vitest'

import { computeLeagueProjectedPoints } from '@/lib/projections/leagueScoring'

/**
 * Leagues state scoring in Sleeper's vocabulary; the stat ingest writes nflverse's. Nothing
 * bridged them for offence, so every offensive stat line in the database was unscoreable and it
 * looked like a coverage gap in the feed.
 */

// A normal PPR league, in the vocabulary leagues actually publish.
const PPR = { rec: 1, rec_yd: 0.1, rec_td: 6, rush_yd: 0.1, rush_td: 6, pass_yd: 0.04, pass_td: 4, pass_int: -1, fum_lost: -2 }

describe('offensive stat aliases', () => {
  it('scores a line written in the ingest’s vocabulary', () => {
    /*
     * THE DEFECT. Measured across 8,000 rows of the 2025 season: `rec`, `rec_yd`, `rec_td`,
     * `rush_yd`, `rush_td`, `pass_yd` and `pass_td` appear ZERO times each, while `receptions`
     * appears 790 times and `receiving_yards` 782. Every offensive line returned null.
     */
    const line = { receptions: 7, receiving_yards: 92, receiving_td: 1 }
    const r = computeLeagueProjectedPoints(line, PPR)
    expect(r).not.toBeNull()
    // 7 + 9.2 + 6
    expect(r!.points).toBeCloseTo(22.2, 2)
  })

  it('scores rushing and passing through the same bridge', () => {
    const r = computeLeagueProjectedPoints(
      { rushing_yards: 100, rushing_td: 1, passing_yards: 250, passing_td: 2 },
      PPR,
    )
    // 10 + 6 + 10 + 8
    expect(r!.points).toBeCloseTo(34, 2)
  })

  it('still scores a line already written in the league’s own vocabulary', () => {
    // The alias is a fallback, not a replacement — a native key must keep winning.
    const r = computeLeagueProjectedPoints({ rec: 5, rec_yd: 50 }, PPR)
    expect(r!.points).toBeCloseTo(10, 2)
  })

  it('prefers the native key when a line somehow carries both', () => {
    const r = computeLeagueProjectedPoints({ rec: 5, receptions: 99 }, { rec: 1 })
    expect(r!.points).toBe(5)
  })

  it('NEVER pays a quarterback defensive points for his own interceptions', () => {
    /*
     * ⚠ THE ALIAS THAT MUST NOT EXIST. In a league's scoring `int` is a DEFENDER catching one;
     * in an offensive feed `interceptions` is a quarterback throwing one. Bridging them would
     * turn a QB's worst plays into six points each.
     */
    const r = computeLeagueProjectedPoints({ interceptions: 3 }, { int: 6 })
    expect(r).toBeNull()
  })

  it('keeps the IDP bridge working alongside the new offensive one', () => {
    // Sleeper projects `idp_sack`; leagues configure `sack`. That was the first instance of
    // exactly this problem and must not regress.
    const r = computeLeagueProjectedPoints({ idp_sack: 2, idp_tkl_solo: 6 }, { sack: 4, tkl_solo: 1 })
    expect(r!.points).toBeCloseTo(14, 2)
  })
})

/*
 * A Sleeper rulebook with the keys 222+ of 225 staging leagues weight (measured 2026-09-16).
 * `fum` is 0 in most leagues; it is weighted here so the fumble alias is exercised.
 */
const FULL = {
  ...PPR,
  pass_td: 6,
  pass_int: -2,
  fum: -1,
  pass_2pt: 2,
  rush_2pt: 2,
  rec_2pt: 2,
  pass_att: 0.1,
  pass_cmp: 0.2,
  rush_att: 0.5,
  xpm: 1,
  fgm: 3,
}

describe('Rolling Insights spellings — AFProjectionSnapshot.perGameRates for NFL rows', () => {
  /*
   * THE DEFECT, measured on staging: every touchdown, interception, fumble and two-point
   * conversion in these lines landed in `unusedProjectedStats`, so a real full-PPR league read
   * Josh Allen's rates as 14.19 per game against AF's own 23.26.
   */
  const qb = {
    passing_yards: 250,
    passing_touchdowns: 2,
    passing_interceptions: 1,
    passing_attempts: 30,
    completions: 20,
    rushing_yards: 30,
    rushing_touchdowns: 0.5,
    rushing_attempts: 6,
    fumbles: 1,
    fumbles_lost: 0.5,
    two_point_conversion_pass_succeeded: 0.5,
    two_point_conversion_pass_attempts: 1,
    sacks: 2,
    DK_fantasy_points_per_game: 24,
  }

  it('scores the touchdowns, the interception, the fumbles and the conversion', () => {
    const r = computeLeagueProjectedPoints(qb, FULL)!
    // pass 10 + 12 − 2 + 3 + 4 · rush 3 + 3 + 3 · fum −1 − 1 · 2pt 1
    expect(r.points).toBeCloseTo(35, 2)
    expect(r.contributions).toMatchObject({
      pass_td: 12, pass_int: -2, rush_td: 3, fum: -1, fum_lost: -1, pass_2pt: 1,
    })
  })

  it('leaves nothing scoreable unused — only the stats no league key means', () => {
    const r = computeLeagueProjectedPoints(qb, FULL)!
    // `sacks` is sacks TAKEN here; an attempts count is not a conversion; DK is another vendor's total.
    expect(r.coverage.unusedProjectedStats.sort()).toEqual(['sacks', 'two_point_conversion_pass_attempts'])
  })

  it('scores a receiver’s touchdowns and conversions', () => {
    const r = computeLeagueProjectedPoints(
      { receptions: 5, receiving_yards: 60, receiving_touchdowns: 0.5, two_point_conversion_reception_succeeded: 0.5 },
      FULL,
    )!
    // 5 + 6 + 3 + 1
    expect(r.points).toBeCloseTo(15, 2)
  })
})

describe('CFBD spellings — AFProjectionSnapshot.perGameRates for NCAAF rows', () => {
  /*
   * THE DEFECT, measured on staging: these dotted names matched no league key at all, so every
   * college line `lookupNcaafProjections` handed out priced to null.
   */
  it('scores a college quarterback that used to return null', () => {
    const line = {
      'passing.YDS': 250, 'passing.TD': 2, 'passing.INT': 1, 'passing.ATT': 30, 'passing.COMPLETIONS': 20,
      'passing.PCT': 66.7, 'passing.YPA': 8.3,
      'rushing.YDS': 40, 'rushing.TD': 1, 'rushing.CAR': 8, 'rushing.YPC': 5, 'rushing.LONG': 20,
      'fumbles.FUM': 1, 'fumbles.LOST': 1, 'fumbles.REC': 0,
      DK_fantasy_points: 30,
    }
    const r = computeLeagueProjectedPoints(line, FULL)!
    expect(r).not.toBeNull()
    // pass 10 + 12 − 2 + 3 + 4 · rush 4 + 6 + 4 · fum −1 − 2
    expect(r.points).toBeCloseTo(38, 2)
    // Rates and longest plays are not scoring stats; nothing else should be left over.
    expect(r.coverage.unusedProjectedStats.sort()).toEqual(['passing.PCT', 'passing.YPA', 'rushing.LONG', 'rushing.YPC'])
  })

  it('scores a college receiver and kicker', () => {
    expect(computeLeagueProjectedPoints({ 'receiving.REC': 6, 'receiving.YDS': 70, 'receiving.TD': 1 }, FULL)!.points)
      .toBeCloseTo(19, 2)
    expect(computeLeagueProjectedPoints({ 'kicking.XPM': 4, 'kicking.FGM': 2 }, FULL)!.points).toBeCloseTo(10, 2)
  })
})

describe('keys that look like aliases and must not be', () => {
  it('🛑 never scores the normalizer’s merged `interception` for either side of the ball', () => {
    /*
     * `StatNormalizationService` renames BOTH `pass_int` and `int` to `interception`. On a QB row it
     * is a thrown pick, on a defender's a caught one. Bridging it to either key scores the other with
     * the wrong sign.
     */
    expect(computeLeagueProjectedPoints({ interception: 2 }, { pass_int: -2 })).toBeNull()
    expect(computeLeagueProjectedPoints({ interception: 2 }, { int: 2 })).toBeNull()
  })

  it('never reads a thrown interception as a caught one, or the reverse', () => {
    expect(computeLeagueProjectedPoints({ passing_interceptions: 2, 'passing.INT': 2 }, { int: 6 })).toBeNull()
    // RI's bare `interceptions` is DEFENSIVE; nflverse's is thrown. Neither direction is safe.
    expect(computeLeagueProjectedPoints({ interceptions: 2 }, { pass_int: -2 })).toBeNull()
    expect(computeLeagueProjectedPoints({ 'interceptions.INT': 2 }, { pass_int: -2 })).toBeNull()
  })

  it('never gives a quarterback sack points for being sacked', () => {
    expect(computeLeagueProjectedPoints({ sacks: 3 }, { sack: 1 })).toBeNull()
    expect(computeLeagueProjectedPoints({ 'defensive.SACKS': 3 }, { sack: 1 })).toBeNull()
  })

  it('never counts attempts as conversions', () => {
    expect(computeLeagueProjectedPoints({ two_point_conversion_pass_attempts: 2 }, { pass_2pt: 2 })).toBeNull()
  })

  it('still prefers a native key over any new spelling', () => {
    const r = computeLeagueProjectedPoints({ pass_td: 1, passing_touchdowns: 9, 'passing.TD': 9 }, { pass_td: 4 })
    expect(r!.points).toBe(4)
  })

  it('does not report another vendor’s point total as an unscored stat', () => {
    const r = computeLeagueProjectedPoints({ rec: 5, DK_fantasy_points: 20, DK_fantasy_points_per_game: 2 }, { rec: 1 })
    expect(r!.coverage.unusedProjectedStats).toEqual([])
  })
})
