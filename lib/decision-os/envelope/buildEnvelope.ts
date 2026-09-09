/**
 * Assemble a `DecisionResponseEnvelopeV1` from a resolved context and whatever
 * Decision OS produced.
 *
 * 🛑 THIS MODULE COMPUTES NO FANTASY VALUE, EVER. It arranges what the engines
 * returned. The moment it starts deciding that a trade is fair, or that a value
 * looks wrong, there are two graders and the quiet one wins whenever they
 * disagree — which is the failure mode Chimmy is supposed to be free of.
 *
 * ⚠ AND IT DOES NOT OVERWRITE A REFUSAL. If Decision OS declined, the envelope
 * carries the refusal and no recommendation. `assertEngineRefusalPreserved`
 * exists because that is exactly the property a well-meaning later edit removes.
 */

import { randomUUID } from 'node:crypto'

import type { ResolvedContext } from './contextResolver'
import { DECISION_ENVELOPE_VERSION } from './types'
import type {
  Citation,
  CompetitiveWindow,
  ConfirmedStrategy,
  DecisionResponseEnvelopeV1,
  EnvelopeCalculation,
  EnvelopeConfidence,
  EnvelopeFact,
  EnvelopeGap,
  EnvelopeRefusal,
  PermittedAction,
} from './types'

export type EnvelopeInput = {
  context: ResolvedContext
  traceId?: string
  facts?: EnvelopeFact[]
  calculations?: EnvelopeCalculation[]
  recommendation?: string | null
  alternatives?: string[]
  confidence?: EnvelopeConfidence
  gaps?: EnvelopeGap[]
  /** Refusals from the engines, ADDED to the context's own. Never replacing them. */
  refusals?: EnvelopeRefusal[]
  competitiveWindow?: CompetitiveWindow | null
  confirmedStrategy?: ConfirmedStrategy | null
  actions?: PermittedAction[]
  now?: Date
}

/** Label from a 0..1 score. `unknown` when there is no score — never "low". */
export function confidenceLabelFor(score: number | null): EnvelopeConfidence['label'] {
  if (score === null || !Number.isFinite(score)) return 'unknown'
  if (score >= 0.7) return 'high'
  if (score >= 0.4) return 'medium'
  return 'low'
}

/**
 * Every citation on the envelope, deduped, newest first.
 *
 * ⚠ DERIVED FROM THE FACTS RATHER THAN SUPPLIED SEPARATELY. A citation list a
 * caller passes in can drift from the facts it claims to support; one computed
 * from them cannot.
 */
function citationsFrom(facts: EnvelopeFact[]): Citation[] {
  const seen = new Set<string>()
  const out: Citation[] = []
  for (const f of facts) {
    const key = `${f.citation.source}|${f.citation.reference ?? ''}|${f.citation.observedAt ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f.citation)
  }
  return out.sort((a, b) => String(b.observedAt ?? '').localeCompare(String(a.observedAt ?? '')))
}

/**
 * A fact asserted without a real source is a GAP, not a fact.
 *
 * 🛑 THE ALTERNATIVE IS A MANUFACTURED CITATION, which is worse than none at
 * all: it is checkable and wrong, and it teaches a reader to trust the next one.
 * A fact whose basis is `unavailable`, or which names no source, is reported as
 * an evidence gap and its value is not stated.
 */
export function partitionUncitedFacts(facts: EnvelopeFact[]): {
  cited: EnvelopeFact[]
  gaps: EnvelopeGap[]
} {
  const cited: EnvelopeFact[] = []
  const gaps: EnvelopeGap[] = []
  for (const f of facts) {
    const hasSource = typeof f.citation?.source === 'string' && f.citation.source.trim().length > 0
    if (hasSource && f.citation.basis !== 'unavailable') {
      cited.push(f)
      continue
    }
    gaps.push({
      reason: 'not_computed',
      detail: `${f.label} has no source on file, so it is not stated.`,
      remedy: 'It will appear once the producing feed reports it.',
      factKey: f.key,
    })
  }
  return { cited, gaps }
}

/** Newest and oldest observation times across the facts. */
function freshnessFrom(facts: EnvelopeFact[]): { newestAt: string | null; oldestAt: string | null } {
  const stamps = facts
    .map((f) => f.citation.observedAt)
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .sort()
  if (stamps.length === 0) return { newestAt: null, oldestAt: null }
  return { newestAt: stamps[stamps.length - 1], oldestAt: stamps[0] }
}

export function buildDecisionEnvelope(input: EnvelopeInput): DecisionResponseEnvelopeV1 {
  const { context } = input
  const now = input.now ?? new Date()

  const { cited, gaps: citationGaps } = partitionUncitedFacts(input.facts ?? [])
  const refusals = [...context.refusals, ...(input.refusals ?? [])]

  /*
   * 🛑 A REFUSAL SUPPRESSES THE RECOMMENDATION. Carrying both would let a
   * renderer show the advice and drop the refusal — and the refusal is the part
   * that protects the user. If an engine declined, there is nothing to
   * recommend, and the envelope says so structurally rather than by convention.
   */
  const hasBlockingRefusal = refusals.length > 0
  const recommendation = hasBlockingRefusal ? null : (input.recommendation ?? null)
  const alternatives = hasBlockingRefusal ? [] : (input.alternatives ?? [])

  const confidence: EnvelopeConfidence =
    input.confidence ??
    (hasBlockingRefusal
      ? { score: null, label: 'unknown', basis: 'No answer was produced.' }
      : { score: null, label: 'unknown', basis: 'No producer expressed a confidence.' })

  const actions = input.actions ?? []

  return {
    contractVersion: DECISION_ENVELOPE_VERSION,
    traceId: input.traceId ?? randomUUID(),
    builtAt: now.toISOString(),

    intent: context.intent,
    sport: context.sport,
    temporalScope: context.temporalScope,
    contextScope: context.contextScope,
    league: context.league,

    facts: cited,
    calculations: input.calculations ?? [],
    recommendation,
    alternatives,
    confidence,
    freshness: freshnessFrom(cited),
    evidenceGaps: [...(input.gaps ?? []), ...citationGaps],
    refusals,
    citations: citationsFrom(cited),

    competitiveWindow: input.competitiveWindow ?? null,
    confirmedStrategy: input.confirmedStrategy ?? null,

    actions,
    /*
     * ⚠ TRUE WHEN ANY RECOGNISED ACTION NEEDS CONFIRMATION, and an empty action
     * list is false rather than true. "Nothing to confirm" and "confirm this"
     * are different states and a renderer must be able to tell them apart.
     */
    requiresUserConfirmation: actions.some((a) => a.requiresConfirmation),
  }
}
