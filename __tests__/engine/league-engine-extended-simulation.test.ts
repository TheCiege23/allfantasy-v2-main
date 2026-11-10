/**
 * Extended dry-run: base harness + create validation + trade + roster duplicate scan + lineup lock.
 */

import { describe, expect, it } from 'vitest'
import { LEAGUE_ENGINE_SCENARIO_FIXTURES, getScenarioFixture } from '@/lib/engine-testing/fixtures/leagueScenarioFixtures'
import { runExtendedLeagueEngineSimulation } from '@/lib/engine-testing/simulation/extendedLeagueSimulation'

describe('runExtendedLeagueEngineSimulation', () => {
  it('passes for every built-in scenario fixture', () => {
    for (const f of LEAGUE_ENGINE_SCENARIO_FIXTURES) {
      const r = runExtendedLeagueEngineSimulation(f)
      expect(r.extendedOk, `${f.id}: extended`).toBe(true)
      expect(r.ok, `${f.id}: report`).toBe(true)
    }
  })

  it('surfaces extended failure when base lifecycle path is invalid', () => {
    const fx = getScenarioFixture('standard_redraft_nfl')!
    const r = runExtendedLeagueEngineSimulation(fx, {
      lifecyclePath: ['setup', 'in_season'],
    })
    expect(r.ok).toBe(false)
    expect(r.errors.length).toBeGreaterThan(0)
  })
})
