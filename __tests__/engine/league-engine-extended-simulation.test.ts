/**
 * Extended dry-run: base harness + create validation + trade + roster duplicate scan + lineup lock.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { LEAGUE_ENGINE_SCENARIO_FIXTURES, getScenarioFixture } from '@/lib/engine-testing/fixtures/leagueScenarioFixtures'
import { runExtendedLeagueEngineSimulation } from '@/lib/engine-testing/simulation/extendedLeagueSimulation'

describe('runExtendedLeagueEngineSimulation', () => {
  // Survivor creation only offers cast sizes that can still finish this season, so the 16-team
  // survivor_nfl fixture stops validating partway through the NFL season (it failed on 2026-11-10,
  // when only 12 still fit). Pin a preseason date so this checks the engine, not today's calendar.
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-15T16:00:00Z'))
  })
  afterAll(() => {
    vi.useRealTimers()
  })

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
