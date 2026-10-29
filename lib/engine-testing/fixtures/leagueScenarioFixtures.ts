/**
 * Repeatable scenario descriptors for preset engine + simulation harness (no I/O).
 * Use with `runLeagueSimulationScenario` in `../simulation/leagueSimulationHarness`.
 */

import type { RunPresetEngineInput } from '@/lib/league-creation/preset-engine/runPresetEngine'

export type EngineTestScenarioId =
  | 'standard_redraft_nfl'
  | 'dynasty_nfl'
  | 'devy_nfl'
  | 'c2c_nfl'
  | 'guillotine_nfl'
  | 'keeper_superflex'
  | 'best_ball'
  | 'tournament'
  | 'zombie'
  | 'idp_nfl'
  | 'imported_sleeper_style'
  | 'superflex_nfl'
  | 'survivor_nfl'
  | 'salary_cap_nfl'
  | 'nba_redraft'
  | 'soccer_redraft'

export type LeagueEngineScenarioFixture = {
  id: EngineTestScenarioId
  label: string
  /** Inputs to `runPresetEngine` — commissionerId is a stub for tests. */
  preset: RunPresetEngineInput
  /** Optional expectations for snapshot tests */
  expect?: {
    leagueFormatIdIncludes?: string[]
    oddTeamCountWarning?: boolean
  }
}

const base = (overrides: Partial<RunPresetEngineInput>): RunPresetEngineInput => ({
  concept: 'redraft',
  sport: 'NFL',
  teamCount: 12,
  draftType: 'snake',
  scoringPreset: 'half_ppr',
  leagueName: 'Test League',
  commissionerId: 'fixture-commissioner-user',
  ...overrides,
})

export const LEAGUE_ENGINE_SCENARIO_FIXTURES: LeagueEngineScenarioFixture[] = [
  {
    id: 'standard_redraft_nfl',
    label: 'Standard redraft NFL',
    preset: base({ concept: 'redraft', leagueName: 'Std Redraft' }),
  },
  {
    id: 'dynasty_nfl',
    label: 'Dynasty NFL',
    preset: base({ concept: 'dynasty', leagueName: 'Dynasty', scoringPreset: 'dynasty_ppr' }),
  },
  {
    id: 'devy_nfl',
    label: 'Devy NFL',
    preset: base({
      concept: 'devy',
      leagueName: 'Devy',
      scoringPreset: 'ppr',
      draftType: 'devy_snake',
    }),
  },
  {
    id: 'c2c_nfl',
    label: 'College-to-Cannons merged',
    preset: base({
      concept: 'c2c',
      leagueName: 'C2C',
      scoringPreset: 'ppr',
      draftType: 'c2c_snake',
    }),
  },
  {
    id: 'guillotine_nfl',
    label: 'Guilly',
    preset: base({ concept: 'guillotine', leagueName: 'Guilly', teamCount: 17, scoringPreset: 'half_ppr' }),
  },
  {
    id: 'keeper_superflex',
    label: 'Keeper + superflex scoring label',
    preset: base({
      concept: 'keeper',
      leagueName: 'Keeper SF',
      scoringPreset: 'superflex_half_ppr',
    }),
  },
  {
    id: 'best_ball',
    label: 'Best ball',
    preset: base({ concept: 'best_ball', leagueName: 'Best Ball', scoringPreset: 'half_ppr' }),
  },
  {
    id: 'tournament',
    label: 'Tournament',
    preset: base({
      concept: 'tournament',
      leagueName: 'Tournament',
      teamCount: 32,
      scoringPreset: 'ppr',
    }),
  },
  {
    id: 'zombie',
    label: 'Zombie',
    preset: base({ concept: 'zombie', leagueName: 'Zombie', scoringPreset: 'half_ppr' }),
  },
  {
    id: 'idp_nfl',
    label: 'IDP modifiers',
    preset: base({
      concept: 'idp',
      leagueName: 'IDP',
      scoringPreset: 'idp_half_ppr',
    }),
  },
  {
    id: 'imported_sleeper_style',
    label: 'Imported-style redraft (parity with import normalization tests)',
    preset: base({ concept: 'redraft', leagueName: 'Imported', draftType: 'snake', scoringPreset: 'ppr' }),
  },
  {
    id: 'superflex_nfl',
    label: 'Superflex scoring preset (modifier resolution)',
    preset: base({
      concept: 'redraft',
      leagueName: 'Superflex',
      scoringPreset: 'superflex_half_ppr',
    }),
  },
  {
    id: 'survivor_nfl',
    label: 'Survivor format',
    preset: base({
      concept: 'survivor',
      leagueName: 'Survivor',
      teamCount: 16,
      scoringPreset: 'half_ppr',
    }),
  },
  {
    id: 'salary_cap_nfl',
    label: 'Salary cap shell',
    preset: base({
      concept: 'salary_cap',
      leagueName: 'Salary Cap',
      scoringPreset: 'ppr',
      draftType: 'auction',
    }),
  },
  {
    id: 'nba_redraft',
    label: 'NBA redraft (multi-sport preset path)',
    preset: base({
      sport: 'NBA',
      concept: 'redraft',
      leagueName: 'NBA Test',
      scoringPreset: 'ppr',
      teamCount: 12,
    }),
  },
  {
    id: 'soccer_redraft',
    label: 'Soccer redraft (multi-sport preset path)',
    preset: base({
      sport: 'SOCCER',
      concept: 'redraft',
      leagueName: 'Soccer Test',
      scoringPreset: 'ppr',
      teamCount: 10,
    }),
  },
]

export function getScenarioFixture(id: EngineTestScenarioId): LeagueEngineScenarioFixture | undefined {
  return LEAGUE_ENGINE_SCENARIO_FIXTURES.find((s) => s.id === id)
}
