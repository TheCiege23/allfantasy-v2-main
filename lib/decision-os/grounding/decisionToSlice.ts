import type { Decision, RuleVerdict } from '../core/decision'
import { isLegal } from '../core/decision'
import type { ConclusivenessBlocker, ConclusivenessVerdict } from '../conclusive'
import type { GroundedSlice, GroundingGap } from './packet'

/**
 * R2.1 — `Decision<TAction>` → `GroundedSlice<DecisionFact>`. The bridge from Pipeline A into the
 * grounding packet.
 *
 * ── 🛑 WHY THIS EXISTS: TWO PIPELINES THAT SHARE NO CODE ────────────────────────────────────
 * `lib/decision-os/world/` feeds four decision engines that are LIVE in production and that users
 * see. `lib/decision-os/{domain}-os/` feeds the grounding packet that Chimmy reads. They share no
 * code, so the half of the system that works does not feed Chimmy, and the half that feeds Chimmy
 * had never run. This file is the read-only seam between them.
 *
 * ⚠ IT IS AN ADAPTER, NOT AN INTEGRATION, AND THE ENGINES ARE NOT TO BE TOUCHED. They are live,
 * load-bearing and correct; a rewrite would risk working production behaviour to serve a path that
 * is newer. Everything here reads a `Decision` that some caller already produced. If a change here
 * seems to require an engine change, that is the signal to stop and re-scope.
 *
 * ── ✅ THE MAPPING IS TRANSLATION, NOT INVENTION ────────────────────────────────────────────
 * `Decision` already measures its own honesty, and it does so on the same principle the packet
 * does — independently, which is why the fields line up so closely:
 *
 *   data_completeness   "separate from confidence"        -> conclusiveness
 *   provenance          "the weakest required input drives confidence/completeness honesty"
 *   uncertainty_sources                                   -> the gap detail
 *   four_answers        the four mandatory contract answers -> what Chimmy actually reads
 *   rule_verdicts                                         -> hard constraints Chimmy must not contradict
 *
 * The adapter's job is therefore to avoid LOSING the honesty already expressed, not to invent one.
 *
 * ── ⚠ SUMMARISED, NEVER DUMPED ─────────────────────────────────────────────────────────────
 * `recommended_actions` can hold a full roster's worth of items. `toEvidencePacket.ts` already
 * learned this lesson in the other direction: never `JSON.stringify(value)`, because the target
 * exists to be small. Actions are counted always and described only when the caller supplies a
 * describer that knows the concrete type.
 */

/** How complete the inputs must be before a decision is treated as conclusive. */
const COMPLETENESS_FLOOR = 60

/** Trust levels at which the decision is reported but must not be leaned on. */
const WEAK_TRUST: ReadonlySet<string> = new Set(['low', 'unverified'])

/** At most this many action descriptions reach the packet. Mirrors the serializer's item cap. */
const MAX_ACTIONS_DESCRIBED = 8

/**
 * One engine's decision, in the shape the packet carries and the serializer renders.
 *
 * ⚠ THIS IS A SUMMARY OF A `Decision`, NOT A `Decision`. The full object carries action arrays and
 * telemetry that no prompt should be asked to read.
 */
export interface DecisionFact {
  /** e.g. `manager.lineup.set` — the decision type, verbatim from the engine. */
  decisionType: string
  /** The four mandatory contract answers. */
  whatHappened: string
  whyItMatters: string
  howConfident: string
  whatToDo: string
  /** Plain-language "why", already safe for display — the engine guarantees it names no model. */
  explanation: string
  /**
   * Hard constraints from the rules layer.
   *
   * 🛑 CHIMMY MUST NOT CONTRADICT AN `illegal` VERDICT. This is the half of a decision that is not
   * advice — it is what the league's own rules permit.
   */
  verdicts: RuleVerdict[]
  /** False when any rule returned `illegal`. */
  legal: boolean
  /** Always reported, even when the actions themselves are not described. */
  actionCount: number
  /** Present only when the caller supplied a describer for the concrete action type. */
  actionSummary: string[]
  /** Named uncertainties, verbatim from the engine. */
  uncertaintySources: string[]
  /** 0–100, the engine's own view of how complete its inputs were. */
  dataCompleteness: number
  /** The weakest input the decision rests on, and how far it is trusted. */
  weakestSource: string
  weakestTrust: string
}

export interface DecisionToSliceOptions<TAction> {
  /**
   * Turns one recommended action into a short line.
   *
   * ⚠ OPTIONAL, AND ITS ABSENCE IS HANDLED HONESTLY RATHER THAN GENERICALLY. Without it the fact
   * still reports `actionCount` but carries no descriptions — "three actions, not described here"
   * is true, whereas a best-effort stringifier on an unknown shape produces `[object Object]` and
   * puts it in a prompt as though it were a fact.
   */
  describeAction?: (action: TAction) => string | null
  /** When the decision was produced. Null when the caller does not know — never `now` as a stand-in. */
  asOf?: string | null
}

/**
 * Build the conclusiveness verdict for a decision.
 *
 * 🛑 AN `illegal` RULE VERDICT DOES NOT MAKE A DECISION INCONCLUSIVE — IT IS THE MOST CONCLUSIVE
 * THING IT CAN SAY. "This trade is not legal under your league's rules" is a finding, not a gap,
 * and treating it as a blocker would suppress precisely the answer the user most needs. Only the
 * QUALITY OF THE INPUTS can block a decision, never its content.
 */
function verdictFor(d: Decision<unknown>): ConclusivenessVerdict {
  const blockers: ConclusivenessBlocker[] = []

  if (d.data_completeness < COMPLETENESS_FLOOR) {
    blockers.push({
      assertion: 'coverage',
      detail:
        `The ${d.decision_type} engine ran with ${d.data_completeness}% of the inputs it wants` +
        (d.uncertainty_sources.length > 0 ? ` (missing: ${d.uncertainty_sources.slice(0, 3).join(', ')})` : ''),
      remedy: 'Re-run after the league sync completes, so the engine sees the full roster and schedule.',
    })
  }

  if (WEAK_TRUST.has(d.provenance.weakest_trust)) {
    blockers.push({
      assertion: 'coverage',
      detail: `Rests on "${d.provenance.weakest_source}", which is only ${d.provenance.weakest_trust}-trust`,
      remedy: 'Connect or re-sync that source so the decision does not rest on its weakest input.',
    })
  }

  return blockers.length > 0 ? { ok: false, blockedBy: blockers } : { ok: true }
}

/**
 * Adapt one engine decision into a packet slice.
 *
 * ⚠ RETURNS AN ABSENT SLICE RATHER THAN THROWING. A missing decision is a normal state — the
 * engine may not have been asked to run, or its inputs may not exist for this league — and the
 * packet's whole design is that an absent fact carries a reason and a remedy instead of an error.
 */
export function decisionToSlice<TAction>(
  decision: Decision<TAction> | null | undefined,
  gapWhenAbsent: GroundingGap,
  opts: DecisionToSliceOptions<TAction> = {},
): GroundedSlice<DecisionFact> {
  if (!decision) {
    return { present: false, value: null, asOf: null, servedFrom: null, confidence: null, conclusive: { ok: true }, gap: gapWhenAbsent }
  }

  const a = decision.four_answers
  /*
   * ⚠ THE CONTRACT SAYS ALL FOUR ANSWERS ARE MANDATORY, AND `assertFourAnswers` THROWS ON A
   * VIOLATION. We do not call it. A malformed decision reaching a chat turn should degrade to a
   * reported gap, not take down the packet build for every other slice in it — the same reason
   * every other producer here is wrapped in `.catch(() => null)`.
   */
  const missing = !a?.what_happened?.trim() || !a?.why_it_matters?.trim() || !a?.how_confident?.trim() || !a?.what_to_do?.trim()
  if (missing) {
    return {
      present: false,
      value: null,
      asOf: opts.asOf ?? null,
      servedFrom: null,
      confidence: null,
      conclusive: { ok: true },
      gap: {
        reason: 'not_computed',
        detail: `The ${decision.decision_type} engine returned a decision missing one of its four required answers`,
        remedy: 'This is an engine defect rather than missing data — report the decision id.',
      },
    }
  }

  const described: string[] = []
  if (opts.describeAction) {
    for (const action of decision.recommended_actions.slice(0, MAX_ACTIONS_DESCRIBED)) {
      const line = opts.describeAction(action)
      if (line) described.push(line)
    }
  }

  const value: DecisionFact = {
    decisionType: decision.decision_type,
    whatHappened: a.what_happened,
    whyItMatters: a.why_it_matters,
    howConfident: a.how_confident,
    whatToDo: a.what_to_do,
    explanation: decision.explanation,
    verdicts: decision.rule_verdicts,
    legal: isLegal(decision.rule_verdicts),
    actionCount: decision.recommended_actions.length,
    actionSummary: described,
    uncertaintySources: decision.uncertainty_sources,
    dataCompleteness: decision.data_completeness,
    weakestSource: decision.provenance.weakest_source,
    weakestTrust: decision.provenance.weakest_trust,
  }

  return {
    present: true,
    value,
    asOf: opts.asOf ?? null,
    /*
     * The decision was computed for this request, not served from the feed store. `live` is the
     * honest answer — and it matters, because a reader deciding whether a fact is warm or fresh
     * gets a different answer for a bridged decision than for a stored feed fact.
     */
    servedFrom: 'live',
    /*
     * ⚠ 0–100 -> 0..1. The engine always expresses a confidence, so this is never null here — the
     * slice's "null means the producer does not express one" case cannot arise for a decision.
     * Note the core contract calls this "placeholder calibration in Slice 1", so it is the
     * engine's stated confidence, not a validated probability. It is passed through unchanged
     * rather than re-scaled, because inventing a second calibration on top of a stated one is how
     * two rival confidence stories start.
     */
    confidence: decision.confidence / 100,
    conclusive: verdictFor(decision),
    gap: null,
  }
}
