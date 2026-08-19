import { describe, expect, it } from 'vitest'

import { rescoreIdpForLeague } from '@/lib/af-projections/rescoreForLeague'

/** Shape the writer persists in adjustmentFactors. */
const FACTORS = {
  basis: 'sleeper_weekly_idp_projection',
  idpPreset: 'balanced',
  idp: { componentAmounts: { soloTackle: 4.7, assistTackle: 4.35, sack: 0.15 } },
}

describe('rescoreIdpForLeague', () => {
  it('rescores under a tackle-heavy league and beats the balanced value', () => {
    const balanced = rescoreIdpForLeague(FACTORS, { idp_solo_tackle: 1, idp_assist_tackle: 0.5, idp_sack: 4 })!
    const heavy = rescoreIdpForLeague(FACTORS, { idp_solo_tackle: 1.5, idp_assist_tackle: 0.75, idp_sack: 3 })!
    // Scorer rounds to 2dp, so 7.475 lands on 7.48.
    expect(balanced.points).toBeCloseTo(4.7 + 2.175 + 0.6, 1)
    expect(heavy.points).toBeGreaterThan(balanced.points)
  })

  it("accepts Sleeper's own vocabularies, prefixed and bare", () => {
    const prefixed = rescoreIdpForLeague(FACTORS, { idp_tkl_solo: 1, idp_tkl_ast: 0.5 })!
    const bare = rescoreIdpForLeague(FACTORS, { tkl_solo: 1, tkl_ast: 0.5 })!
    expect(prefixed.points).toBeCloseTo(bare.points, 3)
    expect(bare.points).toBeCloseTo(4.7 + 2.175, 2)
  })

  it('does NOT treat team-defense keys as individual scoring', () => {
    // Bare sack/int/ff are the DEF-unit settings every league carries.
    expect(rescoreIdpForLeague(FACTORS, { sack: 4, int: 2, ff: 1 })).toBeNull()
  })

  it('names components this league does not score', () => {
    const r = rescoreIdpForLeague(FACTORS, { idp_solo_tackle: 1 })!
    expect(r.unscoredComponents).toContain('assistTackle')
    expect(r.storedPreset).toBe('balanced')
  })

  it('returns null when there is nothing better to offer', () => {
    expect(rescoreIdpForLeague(null, { idp_solo_tackle: 1 })).toBeNull()
    expect(rescoreIdpForLeague(FACTORS, null)).toBeNull()
    expect(rescoreIdpForLeague({ idp: { componentAmounts: {} } }, { idp_solo_tackle: 1 })).toBeNull()
  })

  it('does not re-apply the tackle split to already-resolved amounts', () => {
    // componentAmounts already carry solo+assist; passing combinedTackles again would
    // double-count. Scoring must equal exactly solo*w + assist*w.
    const r = rescoreIdpForLeague(FACTORS, { idp_solo_tackle: 1, idp_assist_tackle: 1 })!
    expect(r.points).toBeCloseTo(4.7 + 4.35, 2)
  })
})

describe('season-basis breakdowns are per-game, not season totals', () => {
  it('keeps componentAmounts on the same per-game unit as afProjection', async () => {
    const { buildAfProjection } = await import('@/lib/af-projections/buildAfProjection')
    const BALANCED = { idp_solo_tackle: 1, idp_assist_tackle: 0.5, idp_sack: 4, idp_interception: 3 }
    // Full-season RI aggregate: 17 games, 122 combined tackles.
    const r = buildAfProjection({
      statsJson: { position: 'S', regular_season: { games_played: 17, tackles: 122, sacks: 2, interceptions: 2 } },
      scoringFormat: 'ppr',
      basisIsPriorSeason: true,
      idpRules: BALANCED,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.basis).toBe('season_idp_components')

    // Regression: componentAmounts used to hold SEASON totals (soloTackle ~65) while
    // afProjection was per-game (~6.3). Rescoring then multiplied season counts by weekly
    // weights — Kamren Curl went 6.34 -> 211.44.
    const solo = r.idp!.componentAmounts.soloTackle
    expect(solo).toBeLessThan(10)
    expect(solo).toBeCloseTo((122 * 0.5364) / 17, 1)

    // And a rescore under the SAME rules must reproduce the stored per-game projection.
    const { rescoreIdpForLeague } = await import('@/lib/af-projections/rescoreForLeague')
    const back = rescoreIdpForLeague({ idp: { componentAmounts: r.idp!.componentAmounts } }, BALANCED)!
    expect(back.points).toBeCloseTo(r.baselineProjection, 1)
  })
})
