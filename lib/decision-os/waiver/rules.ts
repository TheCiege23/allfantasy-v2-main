/**
 * Decision OS — Rule Modules for `manager.waiver.claim` (Slice 2).
 *
 * The single legality entry point (validity BEFORE optimality). It WRAPS the existing waiver gates
 * behind one Rule Framework so callers stop invoking validators directly:
 *   - lib/waiver-wire/transaction-eligibility (assertWaiverClaimEligibility) ← composed here, INJECTED
 *     (it throws + does prisma in production, so it is wrapped + caught, never rewritten)
 *   - the claim-service guard chain / roster-legality engine ← composed at the parity seam
 * Plus a declarative submission-window rule from the World. The existing gates THROW; this layer
 * catches and maps to RuleVerdict[] WITHOUT altering the production throw behavior. Pure given the
 * injected validators (unit-tests without a DB).
 */
import type { RuleVerdict, RuleVerdictType, VerdictSeverity } from '@/lib/decision-os/core/decision'
import { compareValidatorParity, type ValidatorParity, type ValidatorParityConfig } from '@/lib/decision-os/core/parity'
import type { WaiverWorld } from './world'

/** A single candidate claim being gated. */
export interface WaiverCandidateClaim {
  addPlayerId: string
  dropPlayerId: string | null
  faabBid: number | null
}

export interface WaiverRuleContext {
  claim: WaiverCandidateClaim
  world: WaiverWorld
}

export interface WaiverRuleDeps {
  /**
   * Canonical eligibility (reused, not rewritten). THROWS a user-facing Error on violation; resolves
   * on legality. Production wires assertWaiverClaimEligibility (closed over league/roster); tests fake it.
   */
  assertEligibility: (claim: WaiverCandidateClaim) => Promise<void>
  /**
   * Composition seam (parity only, NOT the active gate): a SECOND validator (e.g. the claim-service
   * guard chain / roster-legality engine) → verdicts. When provided, compared for parity.
   */
  validateCanonical?: (ctx: WaiverRuleContext) => Promise<RuleVerdict[]>
}

// ── Category normalization (the waiver legality vocabulary) ─────────────────────

export type WaiverRuleCategory =
  | 'insufficient_faab'
  | 'player_locked'
  | 'undroppable'
  | 'roster_over_limit'
  | 'drop_limit'
  | 'submission_window_closed'
  | 'claim_limit_exceeded'
  | 'ineligible'
  | 'processing_locked'
  | 'roster_legality'

/** Map a thrown waiver-gate message → a normalized legality category (pure). */
export function categorizeWaiverFailure(message: string): WaiverRuleCategory {
  const m = message.toLowerCase()
  if (m.includes('insufficient faab') || m.includes('minimum faab') || m.includes('faab bid')) return 'insufficient_faab'
  if (m.includes('processing') || m.includes('frozen') || m.includes('unlock')) return 'processing_locked'
  if (m.includes('submission window') || m.includes('waiver claims are closed') || m.includes('waiver submissions are') || m.includes('window')) return 'submission_window_closed'
  if (m.includes('undroppable')) return 'undroppable'
  if (m.includes('weekly drop limit') || m.includes('drop limit')) return 'drop_limit'
  if (m.includes('claim limit') || m.includes('maximum pending')) return 'claim_limit_exceeded'
  if (m.includes('locked')) return 'player_locked'
  if (m.includes('over the limit') || m.includes('roster is already at the limit') || m.includes('roster full') || m.includes('would be over')) return 'roster_over_limit'
  if (m.includes('resolve ir') || m.includes('illegal state') || m.includes('taxi') || m.includes('devy') || m.includes('ir,')) return 'roster_legality'
  return 'ineligible'
}

const TEMPORARY: ReadonlySet<WaiverRuleCategory> = new Set(['submission_window_closed', 'processing_locked', 'player_locked'])

function categoryToVerdict(category: WaiverRuleCategory, message: string): RuleVerdict {
  const temporary = TEMPORARY.has(category)
  const verdict: RuleVerdictType = temporary ? 'temporarily_illegal' : 'illegal'
  const severity: VerdictSeverity = temporary ? 'warning' : 'critical'
  return { rule: `waiver.legality.${category}`, verdict, message, severity }
}

/** Declarative World rule: claims are temporarily illegal while processing is locked / window closed. */
function submissionRule(ctx: WaiverRuleContext): RuleVerdict[] {
  if (ctx.world.submission.open) return []
  return [
    {
      rule: 'waiver.submission.window_closed',
      verdict: 'temporarily_illegal',
      message: ctx.world.submission.reason ?? 'Waiver submissions are closed for this period.',
      severity: 'warning',
    },
  ]
}

/**
 * The ACTIVE legality gate: the primary eligibility validator (caught + mapped) + the submission
 * rule. This is what the decision consumes — its behavior is UNCHANGED by the parity composition.
 */
export async function evaluateWaiverRules(ctx: WaiverRuleContext, deps: WaiverRuleDeps): Promise<RuleVerdict[]> {
  const verdicts: RuleVerdict[] = []
  try {
    await deps.assertEligibility(ctx.claim)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'This waiver claim is not eligible.'
    verdicts.push(categoryToVerdict(categorizeWaiverFailure(message), message))
  }
  verdicts.push(...submissionRule(ctx))
  return verdicts
}

// ── Validator parity (compose the second validator, never retire) ───────────────

const WAIVER_PARITY_CONFIG: ValidatorParityConfig = {
  categoryFor: (v) => {
    const m = /^waiver\.(?:legality|canonical)\.(.+)$/.exec(v.rule)
    return m ? m[1] : v.rule
  },
  // Categories both validators are expected to cover (the shared parity scope).
  sharedCategories: new Set<string>(['insufficient_faab', 'roster_over_limit', 'roster_legality', 'undroppable', 'player_locked']),
}

export interface WaiverRuleEvaluation {
  /** The active gate (primary eligibility + submission) — unchanged behavior. */
  verdicts: RuleVerdict[]
  /** The second (canonical) validator's verdicts, for parity only — NOT part of the active gate. */
  canonicalVerdicts: RuleVerdict[]
  parity: ValidatorParity
  retirementSafe: boolean
}

/**
 * Run BOTH validators and report parity WITHOUT changing the active gate. The canonical validator is
 * wrapped in try/catch so it can never break the decision (parity records the error instead).
 */
export async function evaluateWaiverRulesWithParity(ctx: WaiverRuleContext, deps: WaiverRuleDeps): Promise<WaiverRuleEvaluation> {
  const verdicts = await evaluateWaiverRules(ctx, deps)
  let canonicalVerdicts: RuleVerdict[] = []
  let canonicalError: string | undefined
  try {
    canonicalVerdicts = (await deps.validateCanonical?.(ctx)) ?? []
  } catch (e) {
    canonicalError = e instanceof Error ? e.message : 'canonical_validator_error'
  }
  const parity = compareValidatorParity(verdicts, canonicalVerdicts, WAIVER_PARITY_CONFIG, canonicalError)
  return { verdicts, canonicalVerdicts, parity, retirementSafe: parity.retirementSafe }
}
