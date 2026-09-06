/**
 * Decision OS — shadow runner for `manager.trade.evaluate` (Slice 3 integration).
 *
 * Runs the Decision OS trade-evaluation path BESIDE the proposal-create response, compares parity
 * (WRAP-FIDELITY: fed the same persisted deterministic snapshot), logs status, and NEVER throws or
 * affects the legacy response. Gated by DECISION_OS_TRADE_SHADOW. The Decision OS evaluates ONLY — it
 * never creates/accepts/rejects/cancels/counters/votes/vetoes/processes/settles a trade, and never
 * mutates rosters/FAAB/trade state.
 */
import { emitShadowParity } from '@/lib/decision-os/core/parity'
import { shouldRunShadow, type DecisionShadowScope } from '@/lib/decision-os/core/shadow'
import type { TradeValueSnapshot } from '@/lib/trade-value/types'
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'
import { runTradeEvaluateDecision, type RunTradeEvaluateResult } from './index'
// `deriveParticipants` is the DCO's OWN helper (dco.ts builds `participantCount` from it, and
// `canonicalShadow` already reuses it). Importing it rather than recounting rosters here keeps ONE
// implementation of "how many teams are in this trade" — the emit must report the same number the
// evaluator branched on.
import { deriveParticipants, type TradeAssetSummary, type TradeProposalContext } from './dco'
import { loadTradeWorldFacts, worldInputFromFacts, parseTradeSnapshot, type TradeWorldFacts } from './loader'
import { buildProductionTradeDecisionDeps } from './deps'
import type { TradeDecisionDeps } from './decision'
import { runCanonicalTradeShadowAttempt, type CanonicalTradeShadowResult } from './canonicalShadow'

export function shouldRunTradeShadow(
  env: NodeJS.ProcessEnv = process.env,
  scope?: DecisionShadowScope,
): boolean {
  return shouldRunShadow('DECISION_OS_TRADE_SHADOW', env, scope)
}

/**
 * Stage 1 kill switch: when DECISION_OS_TRADE_LIVE=true, decisionOs is appended to the trade
 * proposal response unconditionally (no scope filter). Instant rollback by unsetting the env var.
 */
export function shouldRunTradeLive(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return String(env['DECISION_OS_TRADE_LIVE'] ?? '').trim().toLowerCase() === 'true'
}

export interface TradeShadowResult {
  ran: boolean
  proposalId: string
  result?: RunTradeEvaluateResult
  error?: string
  /**
   * E.4 — the canonical `TradeWorld` shadow attempt that ran BESIDE the native path. Best-effort and
   * parity-only: present when the native path ran; a structured skip when canonical inputs are
   * unavailable. Never affects `ran`/`result`/`error` (those reflect the native path alone).
   */
  canonical?: CanonicalTradeShadowResult
}

export interface TradeShadowDeps {
  loadWorldFacts: (input: { leagueId: string; seasonId: string; proposerRosterId: string; receiverRosterId: string }) => Promise<TradeWorldFacts | null>
  /** Build the decision deps from the persisted deterministic snapshot (the wrap-fidelity memo). */
  buildDecisionDeps: (memo: TradeValueSnapshot) => TradeDecisionDeps
  /** E.4 — read-only canonical world resolver injected into the canonical TradeWorld shadow attempt. */
  resolveCanonicalWorld?: (leagueId: string) => Promise<CanonicalWorld | null>
}

const defaultTradeShadowDeps: Pick<TradeShadowDeps, 'loadWorldFacts' | 'buildDecisionDeps'> = {
  loadWorldFacts: (input) => loadTradeWorldFacts(input),
  buildDecisionDeps: (memo) => buildProductionTradeDecisionDeps(memo),
}

/**
 * Shadow one proposal's trade evaluation. The decision is fed the SAME persisted deterministic
 * snapshot the route captured, and parity compares the Decision OS evaluation against it — proving
 * the wrapper introduces NO drift. Never throws; never mutates trade state.
 */
export async function runTradeShadowForProposal(
  args: {
    userId: string
    leagueId: string
    seasonId: string
    proposal: TradeProposalContext
    assets: TradeAssetSummary[]
    /** The persisted snapshot row payload (JSON) the route already read. */
    snapshotPayload: unknown
    snapshotConfidenceScore?: number | null
  },
  deps: Partial<TradeShadowDeps> = {},
): Promise<TradeShadowResult> {
  const loadWorldFacts = deps.loadWorldFacts ?? defaultTradeShadowDeps.loadWorldFacts
  const buildDecisionDeps = deps.buildDecisionDeps ?? defaultTradeShadowDeps.buildDecisionDeps
  const proposalId = args.proposal.proposalId
  try {
    const snapshot = parseTradeSnapshot(args.snapshotPayload)
    if (!snapshot) {
      emitShadowParity('manager.trade.evaluate', { shadow: true, ran: false, reason: 'missing_snapshot', proposalId })
      return { ran: false, proposalId, error: 'missing_snapshot' }
    }
    const facts = await loadWorldFacts({
      leagueId: args.leagueId,
      seasonId: args.seasonId,
      proposerRosterId: args.proposal.proposerRosterId,
      receiverRosterId: args.proposal.receiverRosterId,
    })
    if (!facts) {
      emitShadowParity('manager.trade.evaluate', { shadow: true, ran: false, reason: 'inputs_unavailable', proposalId })
      return { ran: false, proposalId, error: 'inputs_unavailable' }
    }
    const result = await runTradeEvaluateDecision(
      {
        worldInput: worldInputFromFacts(facts, true),
        userId: args.userId,
        leagueId: args.leagueId,
        sport: facts.sport,
        proposal: args.proposal,
        assets: args.assets,
        snapshotConfidenceScore: args.snapshotConfidenceScore ?? snapshot.grade.confidenceScore ?? null,
      },
      {
        decision: buildDecisionDeps(snapshot),
        shadow: { snapshot },
      },
    )

    // The success path emitted NOTHING of its own until now — only the three `ran: false` paths did,
    // and `runTradeEvaluateDecision`'s `ran`-less event was silently standing in for this one.
    //
    // `ran` is what makes the row a COMPARISON to `flipReadiness` rather than a skip, and it is
    // BRANCHED on purpose: an `unsupported` parity means the legacy evaluator cannot evaluate this
    // trade (3+ teams), so no comparison happened and it stays a refusal.
    //
    // ⚠ `surface` is 'proposal_wrap_fidelity', deliberately NOT the 'proposal' that `canonicalShadow`
    // emits a few lines below on this same route. Both are the proposal route; they are not the same
    // evidence. This path is fed the SAME persisted snapshot it is graded against (wrap fidelity —
    // tautological by design, and that is its job: prove the wrapper adds no drift), while canonical
    // resolves its own ADP. Sharing a bucket would let the weaker evidence top the stronger one up to
    // the gate's fifty.
    const parity = result.parity
    const participants = deriveParticipants(args.assets).length
    emitShadowParity(
      'manager.trade.evaluate',
      parity?.unsupported
        ? {
            shadow: true,
            ran: false,
            surface: 'proposal_wrap_fidelity',
            legacy_shadow_compared: true,
            wrap_fidelity: true,
            evaluator_supported: false,
            unsupported: true,
            reason: 'unsupported_by_legacy_evaluator',
            participants,
            proposalId,
          }
        : {
            shadow: true,
            ran: true,
            surface: 'proposal_wrap_fidelity',
            legacy_shadow_compared: true,
            wrap_fidelity: true,
            evaluator_supported: true,
            parity_passed: parity?.passed,
            parity_failed: parity ? !parity.passed : undefined,
            diffs: parity?.diffs.length ?? 0,
            participants: parity?.comparedParticipants ?? participants,
            proposalId,
          },
      result.decision.decision_id,
    )

    // E.4 — canonical TradeWorld shadow attempt, BESIDE the native path (parity-only, read-only). The
    // native `result` above is already final; this never throws and never alters it. A structured skip
    // is returned (not an error) when canonical inputs are unavailable.
    let canonical: CanonicalTradeShadowResult | undefined
    try {
      canonical = await runCanonicalTradeShadowAttempt(
        {
          leagueId: args.leagueId,
          proposerRosterId: args.proposal.proposerRosterId,
          receiverRosterId: args.proposal.receiverRosterId,
          assets: args.assets,
          referenceSnapshot: snapshot,
          proposalId,
        },
        deps.resolveCanonicalWorld ? { resolveWorld: deps.resolveCanonicalWorld } : {},
      )
    } catch {
      // The canonical attempt is defensive internally; this is a second guard so it can NEVER affect
      // the native shadow result.
      canonical = undefined
    }

    return { ran: true, proposalId, result, canonical }
  } catch (e) {
    emitShadowParity('manager.trade.evaluate', { shadow: true, ran: false, reason: 'shadow_error', proposalId })
    return { ran: false, proposalId, error: e instanceof Error ? e.message : 'shadow_error' }
  }
}
