/**
 * Kickers and team defenses get a projection in the league's own scoring, from this season's game
 * logs. Before: a kicker's snapshot had field goals with no distance (nothing a rule could price),
 * and a team defense had no AF number at all.
 */
import { describe, expect, it } from 'vitest'
import { summarizeSpecialistGames, teamDefenseWeekLine } from '@/lib/af-projections/nflSpecialistRatesModel'
import { computeLeagueProjectedPoints, extractScoringSettings, scoreTeamDefenseRate } from '@/lib/projections/leagueScoring'

const panel = {
  reception: 0.5, passing_td: 4,
  fg_0_19: 3, fg_20_29: 3, fg_30_39: 3, fg_40_49: 4, fg_50_plus: 5, pat_made: 1, pat_missed: -1,
  dst_sack: 1, dst_interception: 2, dst_fumble_recovery: 2, dst_safety: 2, dst_blocked_kick: 2,
  dst_pa_0: 10, dst_pa_1_6: 7, dst_pa_7_13: 4, dst_pa_14_20: 1, dst_pa_21_27: 0, dst_pa_28_34: -1, dst_pa_35_plus: -4,
  idp_sack: 3, idp_interception: 4,
}
const hosted = { scoringSettings: { rules: [] }, nfl_scoring_config: { rules: panel } }

// Shaped like `player_game_stats.normalized_stat_map` (production sample, 2026 week 9 and 11).
const kickerGames = [
  { gp: 1, fga: 2, fgm: 2, xpa: 2, fg_0_39: 2, pat_made: 2, fgm_20_29: 1, fgm_30_39: 1 },
  { gp: 1, fga: 3, fgm: 2, xpa: 4, fg_40_49: 1, fg_50_plus: 1, fgmiss: 1, pat_made: 3, pat_missed: 1 },
]
const defenseGames = [
  { gp: 1, dst_sack: 2, dst_interception: 1, safe: 1, blk_kick: 1, pts_allow: 3, pts_allow_1_6: 1, fga: 1 },
  { gp: 1, dst_sack: 4, fum_rec: 1, pts_allow: 24, pts_allow_21_27: 1 },
]

describe('summarizeSpecialistGames', () => {
  it("averages a kicker's makes by distance", () => {
    const rate = summarizeSpecialistGames(kickerGames)!
    expect(rate.kind).toBe('K')
    expect(rate.games).toBe(2)
    expect(rate.perGame).toMatchObject({ fgm_20_29: 0.5, fgm_30_39: 0.5, fgm_40_49: 0.5, fgm_50p: 0.5, fgmiss: 0.5, xpm: 2.5, xpmiss: 0.5 })
  })

  it('reads a club row as the defense even though it carries kick attempts', () => {
    const rate = summarizeSpecialistGames(defenseGames)!
    expect(rate.kind).toBe('DEF')
    expect(rate.perGame).toMatchObject({ sack: 3, int: 0.5, fum_rec: 0.5, safe: 0.5, blk_kick: 0.5, pts_allow_1_6: 0.5, pts_allow_21_27: 0.5, pts_allow_0: 0 })
  })

  it('gives no rate from one game, or from rows that are neither', () => {
    expect(summarizeSpecialistGames(kickerGames.slice(0, 1))).toBeNull()
    expect(summarizeSpecialistGames([{ rec: 5 }, { rec: 3 }])).toBeNull()
  })
})

describe('pricing in a hosted league (scoring panel rules)', () => {
  it('prices a kicker from his makes by distance', () => {
    const rate = summarizeSpecialistGames(kickerGames)!
    const scored = computeLeagueProjectedPoints(rate.perGame, extractScoringSettings(hosted))
    // 0.5*3 + 0.5*3 + 0.5*4 + 0.5*5 + 2.5*1 + 0.5*-1
    expect(scored?.points).toBeCloseTo(9.5, 5)
  })

  it('prices a team defense, points-allowed brackets included', () => {
    const rate = summarizeSpecialistGames(defenseGames)!
    // 3*1 + 0.5*2 + 0.5*2 + 0.5*2 + 0.5*2 + 0.5*7 + 0.5*0
    expect(scoreTeamDefenseRate(rate.perGame, hosted)).toBeCloseTo(10.5, 5)
  })

  it("does not pay a defender the team defense's points", () => {
    // An individual defender's line: one sack, one interception. Team-defense weights must not reach it.
    const defender = { idp_sack: 1, idp_interception: 1, idp_int: 1 }
    const scored = computeLeagueProjectedPoints(defender, extractScoringSettings(hosted))
    expect(scored?.points).toBeCloseTo(3 + 4, 5)
  })
})

describe('pricing a team defense in an imported league (stored rulebook)', () => {
  it('uses the stored rules as they are', () => {
    const rate = summarizeSpecialistGames(defenseGames)!
    const sleeper = { scoring_settings: { sack: 1, int: 2, fum_rec: 2, pts_allow_1_6: 7, pts_allow_21_27: 0, rec: 1 } }
    expect(scoreTeamDefenseRate(rate.perGame, sleeper)).toBeCloseTo(3 + 1 + 1 + 3.5, 5)
  })

  it('gives nothing when the league has no rule a defense can use', () => {
    const rate = summarizeSpecialistGames(defenseGames)!
    expect(scoreTeamDefenseRate(rate.perGame, { scoring_settings: { rec: 1, pass_td: 4 } })).toBeNull()
    expect(scoreTeamDefenseRate(rate.perGame, null)).toBeNull()
  })
})

/*
 * Owner report 2026-11-22: Chimmy's week 11 lineup check told two managers their 49ers and Lions
 * defenses had "no week 11 projection — a bye, ruled out, or released". The weekly pool the lineup
 * is priced from had no team defense in it at all.
 */
describe("a team defense's line for the lineup week", () => {
  const sleeperRules = { sack: 1, int: 2, fum_rec: 2, safe: 2, blk_kick: 2, def_st_td: 6,
    pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1, pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4,
    rec: 1, pass_td: 4, fgm_30_39: 3, xpm: 1 }

  it('is priced under a Sleeper rulebook in a week the club plays', () => {
    const line = teamDefenseWeekLine(summarizeSpecialistGames(defenseGames)!, 1)!
    const scored = computeLeagueProjectedPoints(line, sleeperRules)
    // sack 3*1 + int 0.5*2 + fum_rec 0.5*2 + safe 0.5*2 + blk 0.5*2 + PA 1-6 0.5*7 + PA 21-27 0.5*0
    expect(scored?.points).toBeCloseTo(10.5, 5)
  })

  it('has no line on a bye or with no game on file, so it still reads as a bye', () => {
    const rate = summarizeSpecialistGames(defenseGames)!
    expect(teamDefenseWeekLine(rate, 0)).toBeNull()
    expect(teamDefenseWeekLine(rate, null)).toBeNull()
  })

  it("is never built from a kicker's rate", () => {
    expect(teamDefenseWeekLine(summarizeSpecialistGames(kickerGames)!, 1)).toBeNull()
  })

  it('keeps raw points allowed per game, so a range rule buckets the average', () => {
    const line = teamDefenseWeekLine(summarizeSpecialistGames(defenseGames)!, 2)!
    expect(line.pts_allow).toBeCloseTo(13.5, 5)
    expect(line.sack).toBeCloseTo(6, 5)
  })
})
