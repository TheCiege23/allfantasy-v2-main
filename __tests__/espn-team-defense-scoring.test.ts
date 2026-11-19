import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'
import { parseEspnSettingsForTest } from '@/lib/league-import/espn/EspnLeagueFetchService'
import {
  ESPN_TEAM_DEFENSE_STAT_IDS,
  ESPN_TEAM_DEFENSE_SUMS,
  parsePointsAllowedRangeKey,
  resolveProviderScoringStatKey,
} from '@/lib/scoring-defaults/ScoringKeyAliasResolver'

/*
 * An ESPN league's D/ST showed no projection. Two causes, both pinned here: the importer stored every
 * team-defense rule as 0 (the value lives in `pointsOverrides["16"]`), and no ESPN D/ST stat id
 * translated. The real league capture and the real BUF week-11 projection line are the inputs.
 */

const root = process.cwd()
const fixture = JSON.parse(readFileSync(join(root, 'contracts/espn/fixtures/fantasy-league.NFL.2026.json'), 'utf8'))
const evidence = JSON.parse(readFileSync(join(root, 'lib/scoring-defaults/espn-stat-id-evidence.json'), 'utf8'))

/** `League.settings` as the import stores it: `scoringSettings.rules` keyed `espn_stat_<id>`. */
function leagueSettingsFrom(items: Array<{ statId: number; points: number }>) {
  return { scoringSettings: { rules: Object.fromEntries(items.map((i) => [`espn_stat_${i.statId}`, i.points])) } }
}

const parsed = parseEspnSettingsForTest(fixture)!
const fixtureRules = leagueSettingsFrom(parsed.scoringItems)
const pointsOf = (id: number) => parsed.scoringItems.find((i) => i.statId === id)?.points

/** Sleeper's week-11 projection for BUF, as stored in `fantasy_projections.stats.stats`. */
const BUF_WEEK_11 = {
  ff: 0.9, gp: 1, int: 0.9, sack: 2.99, pr_yd: 19.89, def_td: 0.15, fum_rec: 0.67, pts_ppr: 9.07, pts_std: 9.07,
  blk_kick: 0.07, tkl_loss: 5.61, def_kr_yd: 121.49, def_pr_yd: 141.38, pts_allow: 14.5, yds_allow: 268.58,
  adp_dd_ppr: 999, def_fum_td: 0.07, pass_int_td: 0.07, pts_half_ppr: 9.07, pos_adp_dd_ppr: 999,
  pts_allow_14_20: 1, yds_allow_200_299: 1,
}

describe('ESPN import keeps team-defense weights', () => {
  it('reads the D/ST value from pointsOverrides when points is 0', () => {
    expect(pointsOf(99)).toBe(1) // sack
    expect(pointsOf(95)).toBe(2) // interception
    expect(pointsOf(96)).toBe(2) // fumble recovery
    expect(pointsOf(89)).toBe(5) // shutout
    expect(pointsOf(124)).toBe(-3)
    expect(pointsOf(136)).toBe(-7)
  })

  it('leaves a non-zero base value alone', () => {
    expect(pointsOf(53)).toBe(1) // reception
    expect(pointsOf(4)).toBe(4) // passing TD
    expect(pointsOf(93)).toBe(6) // base and override are both 6
  })
})

describe('ESPN D/ST rules translate', () => {
  const scoring = extractScoringSettings(fixtureRules)!

  it('maps singles, sums and points-allowed ranges, leaving no D/ST id untranslated', () => {
    expect(scoring).toMatchObject({
      sack: 1, int: 2, blk_kick: 2, safe: 2,
      fum_rec: 2, def_st_fum_rec: 2, // 96, a sum
      def_st_td: 6, def_td: 6, // 93+101+102 and 103+104, sums at equal weight
      pts_allow_range_0_0: 5, pts_allow_range_14_17: 1, pts_allow_range_35_45: -3, pts_allow_range_46_up: -5,
      yds_allow_200_299: 2, yds_allow_550p: -7,
    })
    const untranslatedDefense = Object.keys(scoring).filter((k) => {
      const m = /^espn_stat_(\d+)$/.exec(k)
      return m && ESPN_TEAM_DEFENSE_STAT_IDS.has(m[1]) && scoring[k] !== 0
    })
    expect(untranslatedDefense).toEqual([])
    // 93 went into the special-teams sum, so it is NOT also scored as misc_td.
    expect(scoring).not.toHaveProperty('misc_td')
  })

  it('prices the BUF line under the league\'s own rules', () => {
    const r = computeLeagueProjectedPoints(BUF_WEEK_11, scoring)!
    expect(r).not.toBeNull()
    const expected = {
      sack: 2.99, int: 1.8, fum_rec: 1.34, blk_kick: 0.14, def_td: 0.9,
      pts_allow_range_14_17: 1, yds_allow_200_299: 2,
    }
    for (const [key, value] of Object.entries(expected)) expect(r.contributions[key], key).toBeCloseTo(value, 6)
    // 2.99 + 1.8 + 1.34 + 0.14 + 0.9 + 1 + 2
    expect(r.points).toBeCloseTo(10.17, 2)
  })
})

describe('points-allowed ranges', () => {
  const rules = { pts_allow_range_14_17: 1, pts_allow_range_18_21: 10, pts_allow_range_46_up: 100 }
  const at = (pts_allow: number) => computeLeagueProjectedPoints({ pts_allow }, rules)!.points

  it('reads integer edges as half-open, so every value lands in exactly one bucket', () => {
    expect(at(14)).toBe(1)
    expect(at(17.5)).toBe(1)
    expect(at(18)).toBe(10)
    expect(at(21.99)).toBe(10)
    expect(at(46)).toBe(100)
    expect(at(80)).toBe(100)
    expect(at(13.99)).toBe(0)
  })

  it('is unmatched, not zero, for a line with no points allowed', () => {
    expect(computeLeagueProjectedPoints({ rec: 5 }, rules)).toBeNull()
    expect(parsePointsAllowedRangeKey('pts_allow_14_20')).toBeNull()
  })
})

describe('a D/ST that cannot be fully translated is refused, not under-priced', () => {
  const withRules = (patch: Record<string, number>) =>
    extractScoringSettings(leagueSettingsFrom(parsed.scoringItems.map((i) => (
      `espn_stat_${i.statId}` in patch ? { ...i, points: patch[`espn_stat_${i.statId}`] } : i
    ))))!

  it('refuses when a sum\'s weights differ', () => {
    const scoring = withRules({ espn_stat_101: 4 })
    expect(scoring).toHaveProperty('espn_stat_101', 4)
    expect(computeLeagueProjectedPoints(BUF_WEEK_11, scoring)).toBeNull()
  })

  it('refuses rather than double-count a total beside its parts', () => {
    const scoring = extractScoringSettings({
      scoringSettings: { rules: { ...fixtureRules.scoringSettings.rules, espn_stat_94: 6 } },
    })!
    expect(scoring).toHaveProperty('espn_stat_94', 6)
    expect(computeLeagueProjectedPoints(BUF_WEEK_11, scoring)).toBeNull()
  })

  it('still prices an offensive player in the same league', () => {
    const scoring = withRules({ espn_stat_101: 4 })
    expect(computeLeagueProjectedPoints({ rec: 5, rec_yd: 60 }, scoring)?.points).toBe(11)
  })

  it('does not let a later zero erase an earlier real weight for the same key', () => {
    const scoring = extractScoringSettings({ scoringSettings: { rules: { espn_stat_89: 5, espn_stat_188: 0 } } })!
    expect(scoring.pts_allow_range_0_0).toBe(5)
  })
})

describe('every shipped D/ST mapping is backed by the committed evidence', () => {
  const td = evidence.teamDefense

  it('observes exactly the D/ST ids the refusal gate checks', () => {
    expect([...ESPN_TEAM_DEFENSE_STAT_IDS].sort()).toEqual([...td.espnIdsObserved].sort())
  })

  it('backs each single id with a passing pairing, and each range with the shipped ladder', () => {
    for (const id of td.espnIdsObserved as string[]) {
      const key = resolveProviderScoringStatKey(`espn_stat_${id}`)
      if (!key) continue
      const range = parsePointsAllowedRangeKey(key)
      if (range) {
        const rung = td.ladder[id]
        expect(rung, `ladder for ${id}`).toBeDefined()
        expect([rung.lo, rung.hi], `edges for ${id}`).toEqual([range.lo, range.hi])
        expect(rung.passes && rung.matchesBestFound, `ladder verdict for ${id}`).toBe(true)
      } else if (evidence.mappings[id]?.sleeperKey === key) {
        // Cleared the strict player tier (e.g. 114 = kick-return yards).
      } else {
        expect(td.singles[id]?.sleeperKey, `single for ${id}`).toBe(key)
        expect(td.singles[id].passes).toBe(true)
      }
    }
  })

  it('backs each sum with a passing hypothesis', () => {
    for (const sum of ESPN_TEAM_DEFENSE_SUMS) {
      const tested = td.sums.find((s: { espn: string[] }) => s.espn.join('+') === sum.espn.join('+'))
      expect(tested?.sleeper).toEqual(sum.sleeper)
      expect(tested?.passes, sum.espn.join('+')).toBe(true)
    }
  })
})
