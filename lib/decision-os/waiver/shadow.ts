/**
 * Decision OS — shadow runner for `manager.waiver.claim` (Slice 2 integration).
 *
 * Runs the Decision OS waiver path BESIDE the legacy /api/waiver-ai/engine response, compares parity
 * (WRAP-FIDELITY: fed the same deterministic suggestions), logs status, and NEVER throws or affects
 * the legacy response. Gated by DECISION_OS_WAIVER_SHADOW. The Decision OS NEVER executes a claim.
 */
import { emitShadowParity } from '@/lib/decision-os/core/parity'
import { shouldRunShadow, type DecisionShadowScope } from '@/lib/decision-os/core/shadow'
import type { WaiverAIServiceInput, WaiverAIServiceOutput } from '@/lib/waiver-ai-engine'
import { runWaiverClaimDecision, type RunWaiverClaimResult } from './index'
import { worldInputFromFacts, loadWaiverWorldFacts, type WaiverWorldFacts } from './loader'
import { buildProductionWaiverDecisionDeps } from './deps'
import type { WaiverDecisionDeps } from './decision'

export function shouldRunWaiverShadow(
  env: NodeJS.ProcessEnv = process.env,
  scope?: DecisionShadowScope,
): boolean {
  return shouldRunShadow('DECISION_OS_WAIVER_SHADOW', env, scope)
}

/**
 * Stage 1 kill switch: when DECISION_OS_WAIVER_LIVE=true, decisionOs is appended to the waiver
 * engine response unconditionally (no scope filter). Instant rollback by unsetting the env var.
 */
export function shouldRunWaiverLive(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return String(env['DECISION_OS_WAIVER_LIVE'] ?? '').trim().toLowerCase() === 'true'
}

export interface WaiverShadowResult {
  ran: boolean
  leagueId: string
  result?: RunWaiverClaimResult
  error?: string
}

export interface WaiverShadowDeps {
  loadWorldFacts: (userId: string, leagueId: string) => Promise<WaiverWorldFacts | null>
  /** Build the decision deps from loaded facts + the legacy engine output (the wrap-fidelity memo). */
  buildDecisionDeps: (facts: WaiverWorldFacts, memo: WaiverAIServiceOutput) => WaiverDecisionDeps
}

const defaultWaiverShadowDeps: WaiverShadowDeps = {
  loadWorldFacts: (userId, leagueId) => loadWaiverWorldFacts(userId, leagueId),
  buildDecisionDeps: (facts, memo) => buildProductionWaiverDecisionDeps(facts, memo),
}

/**
 * Shadow one league's waiver recommendation. The decision is fed the SAME deterministic suggestions
 * the legacy engine produced, and parity compares the Decision OS recommended claims against them —
 * proving the wrapper introduces NO drift. Never throws.
 */
export async function runWaiverShadowForEngine(
  args: { userId: string; leagueId: string; engineInput: WaiverAIServiceInput; legacyAnalysis: WaiverAIServiceOutput },
  deps: Partial<WaiverShadowDeps> = {},
): Promise<WaiverShadowResult> {
  const loadWorldFacts = deps.loadWorldFacts ?? defaultWaiverShadowDeps.loadWorldFacts
  const buildDecisionDeps = deps.buildDecisionDeps ?? defaultWaiverShadowDeps.buildDecisionDeps
  try {
    const facts = await loadWorldFacts(args.userId, args.leagueId)
    if (!facts) {
      emitShadowParity('manager.waiver.claim', { shadow: true, ran: false, reason: 'inputs_unavailable', userId: args.userId, leagueId: args.leagueId })
      return { ran: false, leagueId: args.leagueId, error: 'inputs_unavailable' }
    }
    const result = await runWaiverClaimDecision(
      {
        worldInput: worldInputFromFacts(facts),
        userId: args.userId,
        leagueId: args.leagueId,
        sport: facts.sport,
        rosterId: facts.rosterId,
        engineInput: args.engineInput,
        poolIncomplete: (args.engineInput.availablePlayers?.length ?? 0) === 0,
      },
      {
        decision: buildDecisionDeps(facts, args.legacyAnalysis),
        shadow: { legacySuggestions: args.legacyAnalysis.deterministic?.suggestions ?? [] },
      },
    )
    return { ran: true, leagueId: args.leagueId, result }
  } catch (e) {
    emitShadowParity('manager.waiver.claim', { shadow: true, ran: false, reason: 'shadow_error', userId: args.userId, leagueId: args.leagueId })
    return { ran: false, leagueId: args.leagueId, error: e instanceof Error ? e.message : 'shadow_error' }
  }
}
