/**
 * Decision OS — production dependency wiring for `manager.lineup.set` (Slice 1).
 *
 * The ONLY place the real engines are referenced for the production path. The decision layer never
 * imports these directly (architecture rule) — they are injected here. Tests use fakes instead, so
 * this file is never exercised by unit tests.
 */
import { computeLineupActionsForUser } from '@/lib/lineup-actions/computeLineupActionsForUser'
import { validateCanonicalRosterPayload } from '@/lib/roster-lineup-engine/rosterValidationService'
import type { LineupValidationContext } from '@/lib/roster-lineup-engine/types'
import type { RuleVerdict } from '@/lib/decision-os/core/decision'
import { defaultLineupWorldDeps, type LineupWorldDeps } from './world'
import { defaultLineupRuleDeps, type LineupRuleContext } from './rules'
import { buildCanonicalValidatorDep } from './canonicalAdapter'
import type { LineupDecisionDeps } from './decision'

export function productionLineupWorldDeps(): LineupWorldDeps {
  return defaultLineupWorldDeps
}

export function productionLineupDecisionDeps(): LineupDecisionDeps {
  return {
    recommend: computeLineupActionsForUser, // canonical recommender (Slice 0), reused unchanged
    ruleDeps: defaultLineupRuleDeps, // Rule Framework composes validateRedraftLineup
    newId: () =>
      (globalThis.crypto?.randomUUID?.() as string | undefined) ??
      `dec_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  }
}

/**
 * Shadow recommender for the Parity Gate — the same legacy engine, used to compare the Decision OS
 * output against the legacy path before cutover.
 */
export function productionLegacyRecommend() {
  return computeLineupActionsForUser
}

/**
 * Wire the SECOND legacy validator (rosterValidationService.validateCanonicalRosterPayload) into the
 * Rule Framework's `validateCanonical` seam — for PARITY only (it does not change the active gate).
 * Needs a loaded canonical context (template + league flags), assembled at the route seam alongside
 * the loader. Composed, never retired.
 */
export function buildProductionCanonicalValidatorDep(
  ctx: LineupValidationContext,
): (ruleCtx: LineupRuleContext) => RuleVerdict[] {
  return buildCanonicalValidatorDep({
    validate: (playerData, c) => validateCanonicalRosterPayload(playerData, c as LineupValidationContext),
    ctx,
  })
}

/**
 * INTEGRATION SEAM (next ticket): a prisma-backed reader that loads league.settings, week, rosterId,
 * and the player rows the existing /api/redraft/roster + /api/leagues/roster/save paths already read,
 * then calls runLineupSetDecision. Kept out of the pure orchestrator so World/Context/DCO/Decision
 * stay read-only and unit-testable. Not wired in Slice 1 — see the final report's Remaining TODOs.
 */
