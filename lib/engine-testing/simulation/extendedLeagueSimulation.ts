/**
 * Extended dry-run: preset + draft plan + lifecycle + create validation + trade + roster + lineup lock
 * + waiver rules + matchup command center + AI shape guards + hardening sanity.
 * No database — safe for CI and stress loops.
 */

import {
  COLLEGE_FORMATS_NOT_OPEN_CODE,
  validateCreatePayload,
} from '@/lib/league-creation/canonical/validateCreateLeague'
import { resolveLeagueTradeSettings } from '@/lib/league-trade-engine/tradeSettingsResolver'
import {
  validateTradeAssets,
  type TradeValidationResult,
} from '@/lib/league-trade-engine/tradeValidationService'
import { collectDuplicatePlayerIssues } from '@/lib/roster-lineup-engine/rosterValidationService'
import { evaluateLineupLock } from '@/lib/league/lineup-lock'
import {
  buildEngineTestLeague,
  buildEngineTestRoster,
  buildMinimalValidMatchupCenterPayload,
  buildPlayerSwapTradeAssets,
} from '@/lib/engine-testing/fixtures/enginePayloadBuilders'
import type { LeagueEngineScenarioFixture } from '@/lib/engine-testing/fixtures/leagueScenarioFixtures'
import {
  runLeagueSimulationScenario,
  type LeagueSimulationReport,
  type SimulationStep,
} from '@/lib/engine-testing/simulation/leagueSimulationHarness'
import { assertValidMatchupPayload } from '@/lib/matchup-center/validateMatchupPayload'
import { getClaimPriorityRule, isFaabPriority } from '@/lib/waiver-defaults/ClaimPriorityResolver'
import {
  assertLeagueMatchupAiResultShape,
  assertStartSitAiResultShape,
  buildStubLeagueMatchupAiResult,
  buildStubStartSitAiResult,
} from '@/lib/engine-testing/hardening/aiPayloadGuards'
import {
  assertMatchupPayloadWeekAligned,
  assertNoDuplicateWaiverRun,
  assertNonNegativeWeeklyPoints,
  assertNotificationDedupeKeyPresent,
  assertTradePlayersOwnedBySendingRoster,
  assertValidSpecialtyAutomationTrigger,
} from '@/lib/engine-testing/hardening/engineInvariants'

export type ExtendedSimulationStep =
  | SimulationStep
  | { kind: 'create_payload'; ok: boolean }
  | { kind: 'trade_validation'; ok: boolean; code?: string }
  | { kind: 'roster_duplicate_scan'; issueCount: number }
  | { kind: 'lineup_lock_probe'; locked: boolean; policy: string }
  | { kind: 'waiver_priority_rule'; label: string }
  | { kind: 'waiver_faab_detected'; isFaab: boolean }
  | { kind: 'matchup_command_center_payload'; ok: boolean }
  | { kind: 'ai_matchup_shape'; ok: boolean }
  | { kind: 'ai_startsit_shape'; ok: boolean }
  | { kind: 'hardening_sanity'; ok: boolean }

export type ExtendedLeagueSimulationReport = LeagueSimulationReport & {
  extendedOnlySteps: ExtendedSimulationStep[]
  extendedOk: boolean
}

/**
 * Runs `runLeagueSimulationScenario` plus cross-engine probes with deterministic stubs.
 */
export function runExtendedLeagueEngineSimulation(
  fixture: LeagueEngineScenarioFixture,
  options?: Parameters<typeof runLeagueSimulationScenario>[1],
): ExtendedLeagueSimulationReport {
  const base = runLeagueSimulationScenario(fixture, options)
  const extendedOnlySteps: ExtendedSimulationStep[] = []

  const p = fixture.preset
  const cp = validateCreatePayload({
    concept: String(p.concept),
    sport: p.sport,
    teamCount: p.teamCount,
    draftType: String(p.draftType),
    scoringPreset: p.scoringPreset,
    leagueName: p.leagueName ?? 'Sim',
    ...(String(p.sport).toUpperCase() === 'SOCCER' ? { soccerPipeline: 'mls' as const } : {}),
  })
  // Option B launch gate: devy/c2c CREATION is closed as policy. A rejection
  // carrying ONLY that gate's code means the payload cleared every structural
  // check, which is what this step verifies — not the launch policy.
  const cpBlockedByLaunchGateOnly =
    !cp.ok && cp.errors.length > 0 && cp.errors.every((e) => e.code === COLLEGE_FORMATS_NOT_OPEN_CODE)
  const cpStructurallyOk = cp.ok || cpBlockedByLaunchGateOnly
  extendedOnlySteps.push({ kind: 'create_payload', ok: cpStructurallyOk })

  const lg = buildEngineTestLeague()
  const proposer = buildEngineTestRoster('r-sim-1', lg.id, 'u1', { players: ['p1', 'p2'] })
  const receiver = buildEngineTestRoster('r-sim-2', lg.id, 'u2', { players: ['p3', 'p4'] })
  const settings = resolveLeagueTradeSettings(lg)
  const tv = validateTradeAssets({
    league: lg,
    settings,
    proposer,
    receiver,
    assets: buildPlayerSwapTradeAssets({
      proposerRosterId: proposer.id,
      receiverRosterId: receiver.id,
      proposerSendsPlayerId: 'p1',
      receiverSendsPlayerId: 'p3',
    }),
    currentWeek: 5,
  })
  const tvFailed: Extract<TradeValidationResult, { ok: false }> | null = tv.ok ? null : tv
  extendedOnlySteps.push({
    kind: 'trade_validation',
    ok: tv.ok,
    code: tvFailed?.code,
  })

  const dupIssues = collectDuplicatePlayerIssues({
    lineup_sections: {
      starters: [{ id: 'p1', position: 'RB' }],
      bench: [{ id: 'p1', position: 'RB' }],
      ir: [],
      taxi: [],
      devy: [],
    },
  })
  extendedOnlySteps.push({ kind: 'roster_duplicate_scan', issueCount: dupIssues.length })

  const lock = evaluateLineupLock({
    sport: 'NFL',
    now: new Date(),
    leagueWeek: 5,
    editingWeek: 5,
  })
  extendedOnlySteps.push({
    kind: 'lineup_lock_probe',
    locked: lock.locked,
    policy: lock.policy,
  })

  const wRule = getClaimPriorityRule('faab_highest')
  extendedOnlySteps.push({ kind: 'waiver_priority_rule', label: wRule.label })
  extendedOnlySteps.push({
    kind: 'waiver_faab_detected',
    isFaab: isFaabPriority('faab', 'faab_highest'),
  })

  const mcp = buildMinimalValidMatchupCenterPayload({ leagueId: lg.id })
  const mv = assertValidMatchupPayload(mcp)
  extendedOnlySteps.push({ kind: 'matchup_command_center_payload', ok: mv.ok })

  const aiMatchupOk = assertLeagueMatchupAiResultShape(buildStubLeagueMatchupAiResult()).ok
  const aiStartSitOk = assertStartSitAiResultShape(buildStubStartSitAiResult()).ok
  extendedOnlySteps.push({ kind: 'ai_matchup_shape', ok: aiMatchupOk })
  extendedOnlySteps.push({ kind: 'ai_startsit_shape', ok: aiStartSitOk })

  const hardeningOk =
    assertNoDuplicateWaiverRun({
      runKey: 'w1',
      completedRunKeys: new Set(),
      force: false,
    }).ok &&
    assertNotificationDedupeKeyPresent('dedupe:key:1').ok &&
    assertTradePlayersOwnedBySendingRoster({ rosterPlayerIds: ['p1', 'p2'], sendingPlayerIds: ['p1'] }).ok &&
    assertMatchupPayloadWeekAligned({ payloadWeek: 1, expectedWeek: 1 }).ok &&
    assertValidSpecialtyAutomationTrigger('onWeekFinalized').ok &&
    assertNonNegativeWeeklyPoints(100).ok

  extendedOnlySteps.push({ kind: 'hardening_sanity', ok: hardeningOk })

  const matchupOk = mv.ok
  const extendedOk =
    cpStructurallyOk &&
    tv.ok &&
    dupIssues.length > 0 &&
    matchupOk &&
    aiMatchupOk &&
    aiStartSitOk &&
    hardeningOk
  const errors = [...base.errors]
  if (!extendedOk) {
    errors.push('extended_league_engine_simulation_failed')
  }

  return {
    ...base,
    ok: base.ok && extendedOk,
    errors,
    extendedOnlySteps,
    extendedOk,
  }
}
