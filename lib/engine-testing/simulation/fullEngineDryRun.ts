/**
 * Full orchestrated dry-run: extended league simulation + explicit hardening checklist.
 * No database — safe for CI and `npx tsx scripts/run-league-engine-simulation.ts --full`
 */

import type { LeagueEngineScenarioFixture } from '@/lib/engine-testing/fixtures/leagueScenarioFixtures'
import {
  runExtendedLeagueEngineSimulation,
  type ExtendedLeagueSimulationReport,
} from '@/lib/engine-testing/simulation/extendedLeagueSimulation'
import {
  allConsistencyChecksPass,
  runLeagueEngineConsistencyChecks,
  type LeagueEngineConsistencySnapshot,
} from '@/lib/engine-testing/hardening/consistencyChecks'
import type { InvariantResult } from '@/lib/engine-testing/hardening/engineInvariants'

type FullEngineDryRunReport = ExtendedLeagueSimulationReport & {
  /** Synthetic snapshot exercising the full consistency matrix (happy path). */
  consistencyProbe: {
    snapshot: LeagueEngineConsistencySnapshot
    allPass: boolean
    results: InvariantResult[]
  }
  fullOk: boolean
}

/**
 * Runs `runExtendedLeagueEngineSimulation` plus a golden-path consistency snapshot.
 */
export function runFullLeagueEngineDryRun(
  fixture: LeagueEngineScenarioFixture,
): FullEngineDryRunReport {
  const extended = runExtendedLeagueEngineSimulation(fixture)

  const snapshot: LeagueEngineConsistencySnapshot = {
    expectedLeagueId: 'l1',
    draftSessionLeagueId: 'l1',
    draftCompletionMarkerCount: 1,
    standingsRows: [
      { rosterId: 'r1', wins: 5, losses: 4, ties: 0, gamesPlayed: 9 },
      { rosterId: 'r2', wins: 4, losses: 5, ties: 0, gamesPlayed: 9 },
    ],
    matchupPayloadWeek: 3,
    expectedMatchupWeek: 3,
    waiverRunKey: 'waiver:2026:w5',
    waiverCompletedRunKeys: new Set(['waiver:2026:w4']),
    waiverForce: false,
    automationThisRunKey: 'auto:pass:2',
    automationLastCompletedKey: 'auto:pass:1',
    automationForce: false,
    notificationDedupeKey: 'league:l1:fanout:dedupe:1',
    specialtyTrigger: 'onWeekFinalized',
    tradeRosterPlayerIds: ['p1', 'p2', 'p3'],
    tradeSendingPlayerIds: ['p1'],
    importExternalIds: ['sleeper-roster-a', 'sleeper-roster-b'],
  }

  const results = runLeagueEngineConsistencyChecks(snapshot)
  const allPass = allConsistencyChecksPass(snapshot)

  const fullOk = extended.ok && allPass
  const errors = [...extended.errors]
  if (!allPass) errors.push('consistency_probe_failed')

  return {
    ...extended,
    ok: fullOk,
    errors,
    consistencyProbe: { snapshot, allPass, results },
    fullOk,
  }
}
