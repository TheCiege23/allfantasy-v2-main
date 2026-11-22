/**
 * A hosted NFL league whose only rulebook is the scoring panel's store still gets projections.
 * Production, 2026-11-22: five hosted NFL leagues (a zombie league among them) stored
 * `scoringSettings: { rules: [] }` with their real rules in `nfl_scoring_config.rules`, and every
 * projection in them came back empty.
 */
import { describe, expect, it } from 'vitest'
import { computeLeagueProjectedPoints, extractScoringSettings, hasScoringRules } from '@/lib/projections/leagueScoring'

const panel = {
  reception: 0.5, passing_yards: 0.04, passing_td: 4, interception_thrown: -1, rushing_yards: 0.1, rushing_td: 6,
  receiving_yards: 0.1, receiving_td: 6, fumble_lost: -2, passing_2pt: 2, completion: 0,
  idp_sack: 3, idp_solo_tackle: 1, dst_sack: 1, fg_40_49: 4, pat_made: 1,
}
const zombie = {
  scoringSettings: { rules: [], sport: 'NFL', preset: 'fb_half_ppr', modifiers: [], scoringFormat: 'Half PPR' },
  nfl_scoring_config: { rules: panel },
}

describe('hosted NFL league with rules only in the scoring panel store', () => {
  it('reads them in the vocabulary projections are scored in', () => {
    const rules = extractScoringSettings(zombie)
    expect(hasScoringRules(rules)).toBe(true)
    expect(rules).toMatchObject({ rec: 0.5, pass_yd: 0.04, pass_td: 4, pass_int: -1, rush_yd: 0.1, rush_td: 6, rec_yd: 0.1, rec_td: 6, fum_lost: -2, pass_2pt: 2, idp_sack: 3, idp_solo_tackle: 1 })
    // Kicking and team defense have no projection to price, so they are not carried.
    expect(rules).not.toHaveProperty('dst_sack')
    expect(rules).not.toHaveProperty('fg_40_49')
  })

  it('prices a projection that was empty before', () => {
    const line = { receptions: 6, receiving_yards: 80, receiving_touchdowns: 0.5, rushing_yards: 10 }
    // Positive control: the stored metadata alone prices nothing.
    expect(computeLeagueProjectedPoints(line, zombie.scoringSettings)).toBeNull()
    const scored = computeLeagueProjectedPoints(line, extractScoringSettings(zombie))
    expect(scored?.points).toBeCloseTo(6 * 0.5 + 80 * 0.1 + 0.5 * 6 + 10 * 0.1, 5)
  })

  it('leaves a league with a stored rulebook alone', () => {
    const stored = { scoringSettings: { rules: { rec: 1, pass_td: 6 } }, nfl_scoring_config: { rules: panel } }
    expect(extractScoringSettings(stored)).toEqual({ rec: 1, pass_td: 6 })
  })

  it('gives nothing when the panel store has no usable rule either', () => {
    const empty = { scoringSettings: { rules: [] }, nfl_scoring_config: { rules: { dst_sack: 1, completion: 0 } } }
    expect(hasScoringRules(extractScoringSettings(empty))).toBe(false)
  })
})
