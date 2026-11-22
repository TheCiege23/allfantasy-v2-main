/**
 * The commissioner settings window's Scoring tab edits the store live scoring reads (2026-11-15).
 *
 * 🛑 It used to render only CommissionerScoringSettingsPanel, which saves `LeagueScoringOverride` rows; the live scorer
 * resolves points from `League.settings` only (lib/redraft/leagueScoringRules.ts), so a commissioner's change saved and
 * scored nothing. The tab now renders the same per-sport editor as League settings → Scoring, and the override editor
 * only for the two formats whose scoring still reads those rows (IDP defensive stats, survivor-guillotine capped scoring).
 *
 * Static-source assertions, like __tests__/nfl-redraft-core-settings-gear.test.ts: rendering this window pulls in the
 * whole settings tree. Patterns are anchored to the start of a line so a comment describing the change cannot satisfy them.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { resolveLeagueScoringRules } from '@/lib/redraft/leagueScoringRules'

const src = readFileSync(resolve(__dirname, '../../app/league/[leagueId]/components/CommissionerSettingsModal.tsx'), 'utf8')
const scoringTab = src.slice(src.indexOf("activeTab === 'scoring'"), src.indexOf('<GamesLimitsSettingsPanel'))

describe("the settings window's Scoring tab", () => {
  it('renders the per-sport editor the live scorer reads', () => {
    expect(scoringTab).toMatch(/^\s*<SportScoringPanel\b/m)
  })

  it('renders the override editor only behind the IDP / survivor-guillotine check', () => {
    const override = scoringTab.search(/^\s*<CommissionerScoringSettingsPanel\b/m)
    const gate = scoringTab.search(/^\s*\{usesOverrideScoring \? \(/m)
    expect(override).toBeGreaterThan(-1)
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(override)
    expect(src).toMatch(/^\s*idpLeague \|\| .*leagueVariant === 'survivor_guillotine'/m)
  })
})

describe('the store the per-sport editor writes is the store the scorer reads', () => {
  it('an NFL panel save changes the resolved point values', () => {
    const base = resolveLeagueScoringRules({ sport: 'NFL', settings: {} } as never)
    const saved = resolveLeagueScoringRules({
      sport: 'NFL',
      settings: { nfl_scoring_config: { presetKey: 'custom', rules: { passing_td: 6 } } },
    } as never)
    expect(saved.overrides.pass_td).toBe(6)
    expect(base.overrides.pass_td).not.toBe(6)
  })
})
