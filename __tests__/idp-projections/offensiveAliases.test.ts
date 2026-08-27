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
