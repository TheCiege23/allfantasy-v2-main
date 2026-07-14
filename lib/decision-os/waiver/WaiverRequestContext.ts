/**
 * Waiver Request Context — Fantasy OS Phase 15.
 *
 * Phase 14's real-data re-validation found the shadow-compare seam wasn't
 * comparing identical decision contexts: `evaluateWaiverShadow({leagueId,
 * rosterId})` never received `currentWeek`/`goal`, so it always evaluated as
 * week-1/balanced regardless of what the authoritative request actually
 * asked for. This module is the fix's contract: the narrow set of fields
 * that are genuinely request-scoped (cannot be reconstructed from any
 * stored fact) and therefore MUST cross the shadow boundary, separate from
 * identity (leagueId/rosterId/userId — resolved server-side, never
 * client-trusted) and from league/waiver context (roster, availablePlayers,
 * leagueSettings, rosterPositions, allLeagueRosters — deliberately
 * INDEPENDENTLY re-assembled by WaiverContextAssembler.ts on the shared
 * side; that independent assembly is the actual thing the shadow compare is
 * validating, so those fields are intentionally NOT forwarded here).
 *
 * NOTE ON NAMING: the Phase 15 brief calls for a type named
 * `WaiverDecisionContext`. That name is already taken by a real, existing,
 * different type — `lib/shared-services/waiver/WaiverContextAssembler.ts`'s
 * `WaiverDecisionContext` (the full assembled context: leagueId, rosterId,
 * platform, sport, managerKey, engineInput, faab*, needs/surplus,
 * dataCompleteness). Reusing the same name for a narrower, request-only
 * object would collide and confuse the two. This module is named
 * `WaiverRequestContext` instead — flagged here explicitly rather than
 * silently renamed without explanation.
 */

import type { WaiverAIServiceInput, UserGoal } from '@/lib/waiver-ai-engine'

/**
 * The exact, deterministic request-scoped fields both engines must evaluate
 * identically. Always concrete values (never optional) — resolved via the
 * SAME defaults `suggestWaiverPickups`/`buildScoringContext` already apply,
 * so a client that omits a field still produces an identical resolved value
 * on both sides, not just an identical raw (possibly-undefined) one.
 */
export interface WaiverRequestContext {
  /** 1–30. Security review: not PII, not a secret, deterministic, cannot be reconstructed from leagueId (no "current week" is stored — the user may intentionally be viewing a past/future week), already available to the authoritative engine because the client sent it. Safe to forward. */
  currentWeek: number
  /** 'win-now' | 'balanced' | 'rebuild'. Security review: a momentary UI strategy selection, not PII, not persisted anywhere per-user/per-league (confirmed by search — no `waiverGoal`/`savedGoal`/`preferredGoal` field exists in this schema), so it cannot be re-derived; must be forwarded. Does not weaken authorization — it's a scoring weight, not an access-control input. */
  goal: UserGoal
  /** 1–25 (matches the route's own Zod bound). Security review: a pure result-count/pagination preference, not sensitive, cannot be reconstructed, does not weaken authorization. */
  maxResults: number
}

const DEFAULT_CURRENT_WEEK = 1
const DEFAULT_GOAL: UserGoal = 'balanced'
const DEFAULT_MAX_RESULTS = 10
const MAX_RESULTS_UPPER_BOUND = 25

function clampMaxResults(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_RESULTS
  return Math.max(1, Math.min(MAX_RESULTS_UPPER_BOUND, Math.round(value)))
}

/**
 * Pure extraction — no DB access, no authorization decision. Only reads the
 * three fields above off the client-supplied engine input; every other
 * field on `WaiverAIServiceInput` (roster, availablePlayers, leagueSettings,
 * rosterPositions, allLeagueRosters, sport, includeAIExplanation,
 * confirmTokenSpend) is deliberately ignored here — see module docstring.
 */
export function extractWaiverRequestContext(engineInput: WaiverAIServiceInput): WaiverRequestContext {
  return {
    currentWeek: typeof engineInput.currentWeek === 'number' && Number.isFinite(engineInput.currentWeek) ? engineInput.currentWeek : DEFAULT_CURRENT_WEEK,
    goal: engineInput.goal ?? DEFAULT_GOAL,
    maxResults: clampMaxResults(engineInput.maxResults),
  }
}
