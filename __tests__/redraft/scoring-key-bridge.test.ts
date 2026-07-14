/**
 * UI → engine scoring-key bridge (R1) — pure tests.
 *
 * Locks the mapping that connects the commissioner NFL scoring panel
 * (`passing_td`/`dst_sack`/`dst_pa_7_13`) to the engine store
 * (`pass_td`/`def_sack`/`def_pa_7_13`), proving a panel save can write the
 * canonical `sportConfig.categoryPoints` the engine actually scores.
 */
import { describe, expect, it } from 'vitest'
import {
  bridgeScoringKey,
  bridgeUiRulesToEngineCategoryPoints,
  isEngineScoringKey,
  bridgeTierKey,
} from '@/lib/nfl-scoring/scoringKeyBridge'

describe('R1 bridge — single key mapping', () => {
  it('maps the required offensive keys', () => {
    expect(bridgeScoringKey('passing_td')).toBe('pass_td')
    expect(bridgeScoringKey('passing_yards')).toBe('pass_yds')
    expect(bridgeScoringKey('rushing_td')).toBe('rush_td')
    expect(bridgeScoringKey('rushing_yards')).toBe('rush_yds')
    expect(bridgeScoringKey('receiving_td')).toBe('rec_td')
    expect(bridgeScoringKey('receiving_yards')).toBe('rec_yds')
    expect(bridgeScoringKey('reception')).toBe('rec')
    expect(bridgeScoringKey('interception_thrown')).toBe('pass_int')
  })

  it('maps the DST counting keys (both prompt names and actual UI keys)', () => {
    expect(bridgeScoringKey('dst_sack')).toBe('def_sack')
    expect(bridgeScoringKey('dst_int')).toBe('def_int')
    expect(bridgeScoringKey('dst_interception')).toBe('def_int')
    expect(bridgeScoringKey('dst_fumble_recovery')).toBe('def_fr')
    expect(bridgeScoringKey('dst_safety')).toBe('def_safety')
    expect(bridgeScoringKey('dst_blocked_kick')).toBe('def_blk_kick')
    expect(bridgeScoringKey('dst_td')).toBe('def_td')
    expect(bridgeScoringKey('dst_defensive_td')).toBe('def_td')
    expect(bridgeScoringKey('st_td')).toBe('def_st_td')
    expect(bridgeScoringKey('dst_special_teams_td')).toBe('def_st_td')
  })

  it('maps points-allowed and yards-allowed tiers (collapsing YA 450+)', () => {
    expect(bridgeTierKey('dst_pa_0')).toBe('def_pa_0')
    expect(bridgeTierKey('dst_pa_7_13')).toBe('def_pa_7_13')
    expect(bridgeTierKey('dst_pa_35_plus')).toBe('def_pa_35_plus')
    expect(bridgeTierKey('dst_ya_300_349')).toBe('def_ya_300_349')
    expect(bridgeTierKey('dst_ya_450_499')).toBe('def_ya_450_plus')
    expect(bridgeTierKey('dst_ya_550_plus')).toBe('def_ya_450_plus')
  })

  it('maps the IDP catalog keys (short-form engine keys + identity passthroughs)', () => {
    // UI catalog keys that DIFFER from the engine key need an explicit mapping.
    expect(bridgeScoringKey('idp_solo_tackle')).toBe('idp_solo')
    expect(bridgeScoringKey('idp_assisted_tackle')).toBe('idp_assist')
    expect(bridgeScoringKey('idp_interception')).toBe('idp_int')
    expect(bridgeScoringKey('idp_pass_defended')).toBe('idp_pd')
    expect(bridgeScoringKey('idp_fumble_forced')).toBe('idp_ff')
    expect(bridgeScoringKey('idp_fumble_recovery')).toBe('idp_fr')
    expect(bridgeScoringKey('idp_tackle_for_loss')).toBe('idp_tfl')
    // Identity passthroughs (UI key already equals the engine key).
    expect(bridgeScoringKey('idp_sack')).toBe('idp_sack')
    expect(bridgeScoringKey('idp_td')).toBe('idp_td')
    expect(bridgeScoringKey('idp_safety')).toBe('idp_safety')
    expect(bridgeScoringKey('idp_qb_hit')).toBe('idp_qb_hit')
  })

  it('maps the yardage/passing bonus keys', () => {
    expect(bridgeScoringKey('three_hundred_yd_pass_bonus')).toBe('pass_300_bonus')
    expect(bridgeScoringKey('four_hundred_yd_pass_bonus')).toBe('pass_400_bonus')
    expect(bridgeScoringKey('one_hundred_yd_rush_bonus')).toBe('rush_100_bonus')
    expect(bridgeScoringKey('one_hundred_yd_rec_bonus')).toBe('rec_100_bonus')
  })

  it('maps the misc fumble-TD and return-TD catalog keys', () => {
    expect(bridgeScoringKey('off_fumble_recovery_td')).toBe('fumble_td')
    expect(bridgeScoringKey('dst_kick_return_td')).toBe('def_st_td')
    expect(bridgeScoringKey('dst_punt_return_td')).toBe('def_st_td')
  })

  it('passes through keys that are already engine keys; drops unmapped', () => {
    expect(bridgeScoringKey('te_premium')).toBe('te_premium')
    expect(bridgeScoringKey('idp_sack')).toBe('idp_sack')
    expect(bridgeScoringKey('passing_first_down')).toBeNull() // no engine category
    expect(bridgeScoringKey('totally_unknown')).toBeNull()
  })

  it('isEngineScoringKey distinguishes the namespaces', () => {
    expect(isEngineScoringKey('def_sack')).toBe(true)
    expect(isEngineScoringKey('pass_td')).toBe(true)
    expect(isEngineScoringKey('dst_sack')).toBe(false)
    expect(isEngineScoringKey('passing_td')).toBe(false)
  })
})

describe('R1 bridge — full rules map', () => {
  it('bridges a realistic panel payload to engine categoryPoints', () => {
    const uiRules = {
      passing_td: 6,
      passing_yards: 0.04,
      reception: 1,
      dst_sack: 2,
      dst_interception: 3,
      dst_pa_7_13: 5,
      dst_ya_500_549: 1,
      passing_first_down: 1, // unmapped → dropped
      reception_bonus_wr: 0.5, // unmapped → dropped
    }
    expect(bridgeUiRulesToEngineCategoryPoints(uiRules)).toEqual({
      pass_td: 6,
      pass_yds: 0.04,
      rec: 1,
      def_sack: 2,
      def_int: 3,
      def_pa_7_13: 5,
      def_ya_450_plus: 1,
    })
  })

  it('drops non-finite values and handles empty/null input', () => {
    expect(bridgeUiRulesToEngineCategoryPoints({ dst_sack: Number.NaN, def_td: 6 } as never)).toEqual({ def_td: 6 })
    expect(bridgeUiRulesToEngineCategoryPoints(null)).toEqual({})
    expect(bridgeUiRulesToEngineCategoryPoints(undefined)).toEqual({})
  })
})
