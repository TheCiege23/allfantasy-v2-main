/**
 * `extractScoringSettings` on a Fantrax league whose stored rules came out empty.
 *
 * 🛑 Measured 2026-11-19 on a real imported Fantrax NFL league: `scoringSettings.rules` held nothing while
 * `fantrax_settings.scoringSystem.scoringCategorySettings` held the league's rules — so every projection read the
 * league as unscorable and My Team showed "0 of 16 starters priced". The fixture is a captured PUBLIC Fantrax NFL
 * league (tests/fixtures/fantrax/nfl-public-2026.json), not that league.
 */
import { describe, expect, it } from 'vitest'
import nfl from '../../tests/fixtures/fantrax/nfl-public-2026.json'
import { computeLeagueProjectedPoints, extractScoringSettings, hasScoringRules } from '@/lib/projections/leagueScoring'
import { fantraxScoringRules } from '@/lib/league-import/fantrax/fantraxScoring'
import type { FantraxLeagueInfo } from '@/lib/league-import/fantrax/fantraxApi'

const scoringSystem = (nfl as { info: { scoringSystem: Record<string, unknown> } }).info.scoringSystem
const expected = Object.fromEntries(
  fantraxScoringRules({ scoringSystem } as unknown as FantraxLeagueInfo).rules.map((r) => [r.stat_key, r.points_value]),
)

describe('a Fantrax league with no stored rules', () => {
  it('🛑 reads the league\'s own Fantrax scoring system instead of reporting it unscorable', () => {
    const settings = { scoringSettings: { format: 'custom', rules: {} }, fantrax_settings: { scoringSystem } }
    const rules = extractScoringSettings(settings)
    expect(hasScoringRules(rules)).toBe(true)
    expect(rules).toEqual(expected)
    // And it prices a real stat line under them, which is what every projection surface does next.
    const line = { pass_yd: 250, pass_td: 2, rush_yd: 20, rec: 0 }
    expect(computeLeagueProjectedPoints(line, rules)?.points).toBeGreaterThan(0)
  })

  it('also when no scoringSettings key exists at all', () => {
    expect(extractScoringSettings({ fantrax_settings: { scoringSystem } })).toEqual(expected)
  })

  it('a rulebook that is stored always wins over the Fantrax fallback', () => {
    const stored = { rec: 0.5, pass_td: 4 }
    expect(extractScoringSettings({ scoringSettings: { rules: stored }, fantrax_settings: { scoringSystem } })).toEqual(stored)
    expect(extractScoringSettings({ scoring_settings: stored, fantrax_settings: { scoringSystem } })).toEqual(stored)
  })

  it('a category league converts to no rules, and stays unscorable rather than inventing points', () => {
    const categories = { ...scoringSystem, type: 'HEAD_TO_HEAD_CATEGORIES' }
    expect(hasScoringRules(extractScoringSettings({ scoringSettings: { rules: {} }, fantrax_settings: { scoringSystem: categories } }))).toBe(false)
  })

  it('a non-Fantrax league with no rules is unchanged', () => {
    expect(extractScoringSettings({ scoringSettings: { rules: {} } })).toBeNull()
  })
})
