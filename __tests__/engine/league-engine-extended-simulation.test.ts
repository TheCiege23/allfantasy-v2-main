/**
 * Extended dry-run: base harness + create validation + trade + roster duplicate scan + lineup lock.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTeamCountOptions } from '@/lib/create-league-v2/rules-engine'
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

/*
 * ⚠ THE CALENDAR MUST NOT DECIDE THIS SUITE (2026-11-10). Create offers only the Survivor cast sizes a
 * league drafted today could still finish, so late in the NFL season 16 stops fitting and only 12 is
 * offered. The `survivor_nfl` fixture asks for 16, and "passes for every built-in scenario fixture"
 * went red overnight with no code change. The simulation now reads a valid-but-out-of-season cast as a
 * calendar gate; these pin the clock so the gate path is exercised on every run, whatever today is.
 */
describe('Survivor cast sizes and the calendar', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('late in the season, when only 12 fits, every fixture still passes', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-10T17:00:00Z') })
    // Proves the gate path is the one under test: 16 is genuinely not offered on this date.
    expect(getTeamCountOptions('NFL' as never, 'survivor' as never)).toEqual([12])
    for (const f of LEAGUE_ENGINE_SCENARIO_FIXTURES) {
      const r = runExtendedLeagueEngineSimulation(f)
      expect(r.extendedOk, `${f.id}: extended on 2026-11-10`).toBe(true)
    }
  })

  it('early in the season every size is offered, and the fixture passes outright', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-02T16:00:00Z') })
    expect(getTeamCountOptions('NFL' as never, 'survivor' as never)).toContain(16)
    const r = runExtendedLeagueEngineSimulation(getScenarioFixture('survivor_nfl')!)
    expect(r.extendedOk).toBe(true)
  })

  it('a cast size Survivor never offers is still a failure, on any date', () => {
    const fx = getScenarioFixture('survivor_nfl')!
    for (const now of ['2026-09-02T16:00:00Z', '2026-11-10T17:00:00Z']) {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date(now) })
      const r = runExtendedLeagueEngineSimulation({ ...fx, preset: { ...fx.preset, teamCount: 13 } })
      expect(r.extendedOk, `13 on ${now}`).toBe(false)
      vi.useRealTimers()
    }
  })
})
