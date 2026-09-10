/**
 * The live informational flow, in one place.
 *
 *   request → intent → authorized context → grounding providers → validation
 *           → DecisionResponseEnvelopeV1 → allowlist serialization → wording
 *
 * 🛑 THIS EXISTS SO THE ROUTE DOES NOT GROW A NINTH INLINE SECTION. That file is
 * 3,100 lines and every capability so far has been added by appending another
 * block to it; the route's job here is one call and one string.
 *
 * ⚠ CHIMMY VERBALIZES. IT DOES NOT RECALCULATE. Nothing below re-derives a
 * player value, a trade verdict or a waiver ranking — it arranges what Decision
 * OS returned. A second grader is worse than no grader, because when the two
 * disagree the quiet one wins and nobody is told.
 */

import { buildDecisionEnvelope } from './buildEnvelope'
import { resolveDecisionContext, type ContextResolutionInput } from './contextResolver'
import { markStaleness } from './evidenceAuthority'
import { defaultScopeFor, effectOf, scopedRefusal, type ScopedRefusal } from './refusalScope'
import { renderEnvelopeForPrompt, serializeEnvelopeForClient } from './serialize'
import { validateEvidence } from './validateEvidence'
import type {
  CompetitiveWindow,
  ConfirmedStrategy,
  DecisionResponseEnvelopeV1,
  EnvelopeCalculation,
  EnvelopeConfidence,
  EnvelopeFact,
  EnvelopeGap,
  PermittedAction,
} from './types'

/**
 * What Decision OS produced for this request.
 *
 * ⚠ SUPPLIED BY THE CALLER RATHER THAN FETCHED HERE. The grounding providers
 * already run on the route behind their own caches and timeouts; calling them
 * again from this module would be a second set of reads racing the first. This
 * takes their output.
 */
export type DecisionOsResult = {
  facts?: EnvelopeFact[]
  calculations?: EnvelopeCalculation[]
  recommendation?: string | null
  /** Fact keys the recommendation rests on. Empty is itself a finding. */
  recommendationSupportKeys?: string[]
  alternatives?: string[]
  confidence?: EnvelopeConfidence
  gaps?: EnvelopeGap[]
  /** Refusals the engines raised. Scoped here if they arrive unscoped. */
  refusals?: Array<ScopedRefusal | Omit<ScopedRefusal, 'scope' | 'severity'>>
  competitiveWindow?: CompetitiveWindow | null
  confirmedStrategy?: ConfirmedStrategy | null
  actions?: PermittedAction[]
}

export type OrchestrationResult = {
  envelope: DecisionResponseEnvelopeV1
  /** The fenced block to hand the model. */
  promptBlock: string
  /** The allowlisted payload for the client. */
  clientPayload: Record<string, unknown>
  /** True when something was withheld and the wording must say so. */
  partial: boolean
}

function ensureScoped(
  r: ScopedRefusal | Omit<ScopedRefusal, 'scope' | 'severity'>
): ScopedRefusal {
  return 'scope' in r ? (r as ScopedRefusal) : scopedRefusal(r, defaultScopeFor(r.code))
}

export async function orchestrateInformationalAnswer(args: {
  context: ContextResolutionInput
  /**
   * Runs only when a league was resolved AND authorized. The signature makes
   * that structural: it receives the authorized identity, never a request field.
   */
  decisionOs?: (ctx: Awaited<ReturnType<typeof resolveDecisionContext>>) => Promise<DecisionOsResult>
  traceId?: string
  now?: Date
}): Promise<OrchestrationResult> {
  const now = args.now ?? new Date()
  const context = await resolveDecisionContext(args.context)

  /*
   * ⚠ CONTEXT REFUSALS ARE SCOPED BEFORE ANY ENGINE RUNS, and a blocking one
   * skips the engines entirely. Running them anyway would spend league reads for
   * an answer that cannot be given — and for `not_authorized` specifically, it
   * would be reading a league we just declined to open.
   */
  const contextRefusals = context.refusals.map((r) => scopedRefusal(r, defaultScopeFor(r.code)))
  const blocked = effectOf(contextRefusals).suppressAll

  /*
   * ⚠ `?? {}` ON THE RESULT, NOT ONLY ON THE CALL. A producer that returns
   * nothing is a real shape — a caller wired up before it has anything to
   * contribute — and it should degrade to an empty envelope, not throw on
   * the first property read.
   */
  const os: DecisionOsResult =
    blocked || !args.decisionOs ? {} : ((await args.decisionOs(context)) ?? {})

  const staleMarked = markStaleness(os.facts ?? [], context.temporalScope, now)

  const validation = validateEvidence({
    facts: staleMarked,
    calculations: os.calculations ?? [],
    recommendation: os.recommendation ?? null,
    recommendationSupportKeys: os.recommendationSupportKeys,
  })

  const refusals: ScopedRefusal[] = [
    ...contextRefusals,
    ...(os.refusals ?? []).map(ensureScoped),
    ...validation.refusals,
  ]
  const effect = effectOf(refusals)

  /*
   * 🛑 THE SCOPED SUPPRESSION. A league-recommendation refusal withholds the
   * conclusion and NOTHING ELSE — the facts, the market evidence and the gaps
   * all survive, which is the whole reason scope exists. An action refusal
   * touches neither.
   */
  const recommendation =
    effect.suppressAll || effect.suppressLeagueRecommendation ? null : (os.recommendation ?? null)
  const alternatives = effect.suppressAll ? [] : (os.alternatives ?? [])
  const actions = effect.suppressActions ? [] : (os.actions ?? [])

  const envelope = buildDecisionEnvelope({
    context: { ...context, refusals },
    traceId: args.traceId,
    facts: validation.facts,
    calculations: validation.calculations,
    recommendation,
    alternatives,
    confidence: os.confidence,
    gaps: [...(os.gaps ?? []), ...validation.gaps],
    /*
     * Refusals reach `buildDecisionEnvelope` through the context, so passing
     * them again here would duplicate every one of them in the output.
     */
    competitiveWindow: os.competitiveWindow ?? null,
    confirmedStrategy: os.confirmedStrategy ?? null,
    actions,
    // The scoping above already decided; do not let the blanket rule re-suppress.
    recommendationAlreadyScoped: true,
    now,
  })

  const promptBlock = effect.partial
    ? [
        renderEnvelopeForPrompt(envelope),
        /*
         * ⚠ OUTSIDE THE FENCE, DELIBERATELY. It is an instruction to the model
         * about how to word the answer, not evidence — and the fence's whole
         * claim is that everything inside it is data.
         */
        'PARTIAL ANSWER: something above was withheld. Say plainly what you could not determine; do not word this as a complete answer.',
      ].join('\n')
    : renderEnvelopeForPrompt(envelope)

  return {
    envelope,
    promptBlock,
    clientPayload: serializeEnvelopeForClient(envelope),
    partial: effect.partial,
  }
}
