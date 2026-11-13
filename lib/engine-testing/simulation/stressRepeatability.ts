/**
 * Repeatability helpers for simulation harness (determinism / stress loops).
 */

import type { LeagueLifecycleState } from '@prisma/client'
import type { LeagueEngineScenarioFixture } from '@/lib/engine-testing/fixtures/leagueScenarioFixtures'
import { runLeagueSimulationScenario, type LeagueSimulationReport } from '@/lib/engine-testing/simulation/leagueSimulationHarness'

type RepeatabilityResult = {
  runs: number
  uniqueFingerprints: number
  stable: boolean
  reports: LeagueSimulationReport[]
}

function fingerprint(r: LeagueSimulationReport): string {
  return JSON.stringify({
    ok: r.ok,
    scenarioId: r.scenarioId,
    errors: r.errors,
    steps: r.steps,
  })
}

/** Run the same scenario N times; pure engines should yield identical fingerprints. */
export function repeatSimulationScenario(
  fixture: LeagueEngineScenarioFixture,
  runs: number,
  options?: { lifecyclePath?: LeagueLifecycleState[] },
): RepeatabilityResult {
  const n = Math.max(1, Math.min(runs, 500))
  const reports: LeagueSimulationReport[] = []
  for (let i = 0; i < n; i += 1) {
    reports.push(runLeagueSimulationScenario(fixture, { lifecyclePath: options?.lifecyclePath }))
  }
  const fps = new Set(reports.map(fingerprint))
  return {
    runs: n,
    uniqueFingerprints: fps.size,
    stable: fps.size === 1,
    reports,
  }
}
