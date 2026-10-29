import { describe, expect, it } from 'vitest'

import { importedNflScoring } from '@/lib/league-creation/canonical/importedNflScoring'
import { resolveLeagueScoringRules } from '@/lib/redraft/leagueScoringRules'

/*
 * Imported NFL scoring → the native league (owner, 2026-10-25: "convert them as closely as we can").
 *
 * The rule set below uses only keys stored on the imported Sleeper NFL leagues in production
 * (2026-10-25), with Sleeper-default-shaped values, so the conversion is checked against the
 * vocabulary it will really meet. Every assertion on points goes through
 * `resolveLeagueScoringRules`, the resolver the live scorer uses, so it checks what is scored, not
 * only what is stored.
 */
const SLEEPER_HALF_PPR: Record<string, number> = {
  pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2, pass_fd: 0,
  rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
  rec: 0.5, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
  fum: 0, fum_lost: -2, fum_rec_td: 6,
  xpm: 1, xpmiss: -1, fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50p: 5, fgmiss: -1,
  sack: 1, int: 2, fum_rec: 2, safe: 2, def_td: 6, blk_kick: 2, def_st_td: 6, st_td: 6,
  pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1, pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4,
  bonus_rec_te: 0,
}

const engine = (rules: Record<string, number>, sportConfig: Record<string, unknown> = {}) =>
  resolveLeagueScoringRules({ sport: 'NFL', settings: { sportConfig, nfl_scoring_config: { rules } } })!

const scoringSettings = (rules: Record<string, number>, extra: Record<string, unknown> = {}) => ({
  scoringSettings: { format: 'points', rules },
  ...extra,
})

describe('importedNflScoring', () => {
  it('carries every value the engine can score, exactly', () => {
    const out = importedNflScoring(scoringSettings(SLEEPER_HALF_PPR))!
    const { overrides } = engine(out.rules)
    expect(overrides).toMatchObject({
      pass_yds: 0.04, pass_td: 4, pass_int: -1, rush_yds: 0.1, rush_td: 6, rec: 0.5, rec_yds: 0.1, rec_td: 6,
      two_pt: 2, fum_lost: -2, fumble_td: 6, xp_made: 1, fg_0_39: 3, fg_40_49: 4, fg_50_plus: 5, fg_miss: -1,
      def_sack: 1, def_int: 2, def_fr: 2, def_safety: 2, def_td: 6, def_blk_kick: 2, def_st_td: 6,
      def_pa_0: 10, def_pa_1_6: 7, def_pa_7_13: 4, def_pa_14_20: 1, def_pa_21_27: 0, def_pa_28_34: -1, def_pa_35_plus: -4,
    })
    // Missed PATs and player special-teams TDs score since the engine gained provider-count rules.
    expect(engine(out.rules).overrides).toMatchObject({ xpmiss: -1, st_td: 6 })
    expect(out.notScored).toEqual([])
    expect(out.approximated).toEqual([])
    expect(out.enableTEPremium).toBe(false)
    expect(out.rules).not.toHaveProperty('te_premium')
  })

  it('a rule the source does not award scores 0, even where the AllFantasy default awards points', () => {
    const out = importedNflScoring(scoringSettings(SLEEPER_HALF_PPR))!
    // The engine's defaults give 3 for a 300-yard game and 6 for a defensive return TD.
    expect(engine(out.rules).overrides).toMatchObject({ pass_300_bonus: 0, pass_400_bonus: 0, rush_100_bonus: 0, rec_100_bonus: 0 })
  })

  it('a half-PPR import is not turned into the league preset by the reception default', () => {
    const out = importedNflScoring(scoringSettings(SLEEPER_HALF_PPR))!
    const rec = engine(out.rules).categories.find((c) => c.key === 'rec')!
    expect(engine(out.rules).overrides.rec ?? rec.defaultPoints).toBe(0.5)
  })

  it('missed field goals: the generic rule fills only the distances no specific rule set', () => {
    const out = importedNflScoring(scoringSettings({ ...SLEEPER_HALF_PPR, fgmiss: -1, fgmiss_0_19: -3 }))!
    expect(out.rules).toMatchObject({ fg_missed_0_19: -3, fg_missed_20_29: -1, fg_missed_50_plus: -1 })
    expect(out.approximated).toEqual(['Missed field goals'])
  })

  it('names a rule that several source rules feed when they disagree', () => {
    const out = importedNflScoring(scoringSettings({ ...SLEEPER_HALF_PPR, pass_2pt: 2, rec_2pt: 1 }))!
    expect(out.approximated).toEqual(['2-point conversions'])
  })

  it('lists rules that award points with no AllFantasy equivalent, and stays quiet about zero ones', () => {
    const out = importedNflScoring(scoringSettings({ ...SLEEPER_HALF_PPR, rec_air_yd: 0.1, rush_yac: 0.1, rush_btkl: 0 }))!
    expect(out.notScored).toEqual(['rec air yd', 'rush yac'])
  })

  it('the most-used Sleeper extras carry over and score (owner, 2026-10-25)', () => {
    const out = importedNflScoring(scoringSettings({
      ...SLEEPER_HALF_PPR,
      pass_fd: 1, rush_fd: 0.5, rec_fd: 0.5, rush_td_40p: 2, rec_td_50p: 3, pass_cmp_40p: 1,
      bonus_rec_rb: 0.5, bonus_fd_te: 0.25, bonus_rush_rec_yd_100: 2, fum: -1, st_ff: 1, def_st_fum_rec: 1, kr_yd: 0.04,
    }))!
    expect(out.notScored).toEqual([])
    expect(engine(out.rules).overrides).toMatchObject({
      pass_fd: 1, rush_fd: 0.5, rec_fd: 0.5, rush_td_40p: 2, rec_td_50p: 3, pass_cmp_40p: 1,
      bonus_rec_rb: 0.5, bonus_fd_te: 0.25, bonus_rush_rec_yd_100: 2, fum: -1, st_ff: 1, def_st_fum_rec: 1, kr_yd: 0.04,
    })
  })

  it('a tight-end reception bonus turns on TE premium and scores its amount', () => {
    const out = importedNflScoring(scoringSettings({ ...SLEEPER_HALF_PPR, bonus_rec_te: 0.5 }))!
    expect(out.enableTEPremium).toBe(true)
    expect(engine(out.rules, { enableTEPremium: true }).overrides.te_premium).toBe(0.5)
  })

  it('Fantrax rules it reported as having no equivalent are passed on to the commissioner', () => {
    const out = importedNflScoring(scoringSettings({ pass_yd: 0.04, pass_td: 4 }, {
      fantrax_settings: { scoringGaps: ['Sacks Taken has no equivalent here, so it is not scored'] },
    }))!
    expect(out.notScored).toContain('Sacks Taken has no equivalent here, so it is not scored')
    expect(engine(out.rules).overrides).toMatchObject({ pass_yds: 0.04, pass_td: 4, rec: 0, rush_td: 0 })
  })

  it('keeps the preset (null) for a category league, or a rule set with no recognisable NFL stat', () => {
    expect(importedNflScoring({ scoringSettings: { format: 'H2H_CATEGORIES', rules: { pass_yd: 1 } } })).toBeNull()
    expect(importedNflScoring(scoringSettings({ '42': 3, '43': 1 }))).toBeNull()
    expect(importedNflScoring({})).toBeNull()
  })
})
