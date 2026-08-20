import type { Decision, RuleVerdict } from '../../core/decision'
import type { ThreeBrainDecisionResult } from '../types'

/**
 * Phase 4 — the ONLY sanctioned seam between the three-brain analysis and a Decision.
 *
 * The Decision Registry states the invariant plainly: *"Deterministic decisions: 100% — AI is
 * explanation-only, never in the verdict path."* This module is where that invariant is enforced
 * rather than merely intended, because `ThreeBrainDecisionResult` carries three fields that would
 * silently break it if anyone spread it into a Decision:
 *
 *   1. `confidencePct`     — would override the calibrated deterministic `confidence`.
 *   2. `recommendedAction` — would put model prose into `recommended_actions`, the verdict path.
 *   3. `specialistStatus`  — literal provider names (deepseek/grok/openai/anthropic). The Decision
 *                            contract says `explanation` "Never exposes models/AI".
 *
 * So enrichment here is deliberately narrow: it may replace `explanation` and nothing else. Every
 * other field is carried across by reference from the original Decision, and `assertVerdictPathUntouched`
 * re-checks that afterwards rather than trusting this file to stay correct as it is edited.
 *
 * PURE ON PURPOSE — no DB, no `server-only`, no clock. The caller resolves the analysis (see
 * `phase3/readLeagueIntelligence`) and passes it in, which keeps this testable and keeps the
 * dangerous merge in one small auditable place.
 */

/** Provider identifiers that must never reach user-facing text. Keys of `specialistStatus`, plus the
 *  vendor/product names those stages are known by. */
const MODEL_TERMS = [
  'deepseek', 'grok', 'openai', 'anthropic', 'claude', 'gpt', 'llm',
  'xai', 'chatgpt', 'three-brain', 'threebrain', 'model',
]

const MODEL_LEAK = new RegExp(`\\b(${MODEL_TERMS.join('|')})\\b`, 'i')

/** True when the text names a provider/model. Used to REFUSE the enrichment rather than to scrub it:
 *  a redacted sentence reads as damage, and a silent scrub hides that the generator misbehaved. */
export function mentionsModel(text: string): boolean {
  return MODEL_LEAK.test(text)
}

export type EnrichmentRefusal =
  /** No analysis exists for this decision's evidence yet. The overwhelmingly common case. */
  | 'no_analysis'
  /** Analysis exists but is not usable (still running, failed, evidence changed under it). */
  | 'analysis_not_ready'
  /** A rule returned `illegal`. AI prose must never talk a user into an action the rules forbid. */
  | 'decision_is_illegal'
  /** The analysis answered a different question than this Decision asks. */
  | 'decision_type_mismatch'
  /** The generator leaked a provider/model name into prose the contract says must not expose one. */
  | 'model_name_leak'
  /** The analysis carried no usable narrative. */
  | 'empty_narrative'

export type EnrichmentOutcome<TAction = unknown> =
  | { enriched: true; decision: Decision<TAction>; stale: boolean }
  | { enriched: false; decision: Decision<TAction>; reason: EnrichmentRefusal }

/** The fields that constitute the verdict path. Enrichment must leave every one identical. */
function verdictPathOf<TAction>(d: Decision<TAction>) {
  return {
    rule_verdicts: d.rule_verdicts,
    recommended_actions: d.recommended_actions,
    confidence: d.confidence,
    data_completeness: d.data_completeness,
    automation_capable: d.automation_capable,
    uncertainty_sources: d.uncertainty_sources,
    provenance: d.provenance,
    four_answers: d.four_answers,
  }
}

/**
 * Throws if enrichment changed anything it is not allowed to change. Reference equality is the point:
 * the enriched Decision must carry the ORIGINAL objects, not equal-looking copies, so a future edit
 * that rebuilds `rule_verdicts` from the analysis fails here instead of shipping.
 */
export function assertVerdictPathUntouched<TAction>(
  before: Decision<TAction>,
  after: Decision<TAction>,
): void {
  const a = verdictPathOf(before)
  const b = verdictPathOf(after)
  for (const key of Object.keys(a) as Array<keyof typeof a>) {
    if (a[key] !== b[key]) {
      throw new Error(
        `Decision OS invariant violated: AI enrichment altered the verdict path (\`${String(key)}\`). ` +
          'AI is explanation-only — see lib/decision-os/DECISION_REGISTRY.md.',
      )
    }
  }
}

function hasIllegalVerdict(verdicts: RuleVerdict[]): boolean {
  return verdicts.some((v) => v.verdict === 'illegal')
}

/**
 * Compose the user-facing narrative from the analysis. Ordered to answer the reader's questions in the
 * order they ask them, and it deliberately does NOT include `recommendedAction`: what to do is the
 * deterministic engine's answer (`four_answers.what_to_do`), never the model's.
 */
function composeNarrative(result: ThreeBrainDecisionResult): string {
  const parts = [result.shortAnswer, result.whatDataSays, result.whatItMeans]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
  if (parts.length === 0) return ''

  // Caveats and missing inputs are part of an honest explanation, not a footnote to drop.
  const caveats = [...(result.caveats ?? []), ...(result.missingInformation ?? [])]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
  if (caveats.length > 0) parts.push(`Caveats: ${caveats.slice(0, 3).join('; ')}.`)

  // When the specialists disagreed, say so — in plain language, naming no provider.
  if (result.agreementState && /disagree|conflict|split/i.test(String(result.agreementState))) {
    parts.push('Independent analyses disagreed on this, so treat it as lower-confidence.')
  }
  return parts.join(' ')
}

/**
 * Attach the three-brain narrative to a Decision's `explanation`, or refuse with a reason.
 *
 * Refusing is the normal path and is not an error: today almost every decision has no analysis, and a
 * Decision with its deterministic explanation intact is a correct, complete Decision. The caller
 * renders `decision` either way.
 */
export function enrichDecisionExplanation<TAction = unknown>(input: {
  decision: Decision<TAction>
  /** The persisted analysis, or null when none exists. */
  result: ThreeBrainDecisionResult | null
  /** Freshness from the read layer. Only `ready`/`stale` may enrich — `locked` (paywalled) must not,
   *  so an unentitled user never receives AI prose even if a run exists for them. */
  status:
    | 'ready'
    | 'stale'
    | 'generating'
    | 'not_generated'
    | 'evidence_unavailable'
    | 'unsupported_scope'
    | 'failed'
    | 'locked'
}): EnrichmentOutcome<TAction> {
  const { decision, result, status } = input

  if (!result) return { enriched: false, decision, reason: 'no_analysis' }
  if (status !== 'ready' && status !== 'stale') {
    return { enriched: false, decision, reason: 'analysis_not_ready' }
  }

  // An `illegal` verdict outranks anything the analysis has to say. The rules already told the user
  // they cannot do this; a fluent paragraph arguing the upside would be actively harmful.
  if (hasIllegalVerdict(decision.rule_verdicts)) {
    return { enriched: false, decision, reason: 'decision_is_illegal' }
  }

  // Guard against serving one decision's analysis under another's heading — the identity key should
  // already prevent it, but a mismatch here means something upstream is wrong and must not be papered over.
  if (result.decisionType && decision.decision_type && result.decisionType !== decision.decision_type) {
    return { enriched: false, decision, reason: 'decision_type_mismatch' }
  }

  const narrative = composeNarrative(result)
  if (!narrative) return { enriched: false, decision, reason: 'empty_narrative' }
  if (mentionsModel(narrative)) {
    // Refuse rather than scrub: a redaction reads as damage, and silently cleaning it hides a
    // generator that is violating the contract and should be fixed at the source.
    return { enriched: false, decision, reason: 'model_name_leak' }
  }

  const stale = status === 'stale'
  const enriched: Decision<TAction> = {
    ...decision,
    explanation: stale
      ? `${narrative} (Based on the last completed analysis; newer league activity is not yet reflected.)`
      : narrative,
  }

  // Belt and braces: prove we changed only what we are allowed to change.
  assertVerdictPathUntouched(decision, enriched)
  return { enriched: true, decision: enriched, stale }
}
