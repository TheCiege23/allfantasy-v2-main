/**
 * Sports OS — point 8's half of point 1: a measured duration, recorded against the budget it was
 * measured against.
 *
 * `lib/observability/rootTiming.ts` stamps a duration. This stamps the VERDICT alongside it, so
 * "which screens are over budget on mobile" is a filter in Sentry rather than a spreadsheet join
 * against a table of thresholds someone has to remember to keep in sync.
 *
 * Attributes written on the request's root span:
 *
 *   af.budget.<phase>_ms          the observed duration
 *   af.budget.<phase>_verdict     within | warn | over
 *   af.budget.<phase>_ratio       observed / target
 *
 * ⚠ TELEMETRY MUST NEVER BREAK A RENDER — the rule `cardTelemetry.ts` already carries. Every entry
 * point here swallows its own failures, and `measure` always returns the wrapped promise's own
 * result or rejection, never a telemetry error.
 *
 * ⚠ AND NOTHING HERE DECIDES ANYTHING. A budget verdict is an observation; it never shortens a
 * timeout, sheds a card or changes what the user sees. A performance budget that can fail a request
 * turns a slow page into a broken one.
 */

import * as Sentry from '@sentry/nextjs'
import { evaluateBudget, type BudgetEvaluation, type BudgetKey } from './budgets'

/**
 * ⚠ TYPED AGAINST SENTRY'S OWN `Span`, NOT A STRUCTURAL SHAPE. `setAttributes` takes `SpanAttributes`
 * — a narrower value type than `Record<string, unknown>` — so a hand-written structural parameter
 * does not accept a real `Span`. The ratchet caught that; the first version of this helper added two
 * errors to the baseline.
 */
function applyAttributes(span: Pick<Sentry.Span, 'setAttributes'>, evaluation: BudgetEvaluation): void {
  const prefix = `af.budget.${evaluation.phase}`
  span.setAttributes({
    [`${prefix}_ms`]: evaluation.observedMs,
    [`${prefix}_verdict`]: evaluation.verdict,
    [`${prefix}_ratio`]: evaluation.ratio,
  })
}

/**
 * Stamp an already-measured duration against its budget, on the request's ROOT span.
 *
 * 🛑 ONLY FOR A PHASE THAT HAPPENS ONCE PER REQUEST — `shell`, `screen`, `db`, `import`, `job`.
 * The attribute name is keyed on the PHASE, so a phase that occurs many times per request would
 * have every occurrence overwrite the last on one span and leave an arbitrary winner: nineteen
 * cards writing `af.budget.card_ms` to one root span is not nineteen measurements, it is one
 * measurement of whichever card happened to finish last. Use `recordBudgetOnActiveSpan` for those.
 */
export function recordBudget(key: BudgetKey, observedMs: number): BudgetEvaluation {
  const evaluation = evaluateBudget(key, observedMs)
  try {
    const active = Sentry.getActiveSpan()
    if (!active) return evaluation
    const root = Sentry.getRootSpan(active)
    if (!root.isRecording()) return evaluation
    applyAttributes(root, evaluation)
  } catch {
    // Telemetry must never fail a render.
  }
  return evaluation
}

/**
 * The same, on the CURRENT span rather than the root — for a phase that repeats within one request.
 *
 * Each occurrence already has its own span (a `core.card` span per card, for instance), so the
 * verdict lands beside the thing it describes and nothing overwrites anything. The root span's
 * `af.device` and `af.screen` are still available to cross-tab against in Sentry.
 */
export function recordBudgetOnActiveSpan(key: BudgetKey, observedMs: number): BudgetEvaluation {
  const evaluation = evaluateBudget(key, observedMs)
  try {
    const active = Sentry.getActiveSpan()
    if (!active || !active.isRecording()) return evaluation
    applyAttributes(active, evaluation)
  } catch {
    // Telemetry must never fail a render.
  }
  return evaluation
}

/** Stamp the duration from `startedAtMs` until now. The `rootTiming` shape, with a verdict attached. */
export function recordBudgetSince(key: BudgetKey, startedAtMs: number, nowMs: number = Date.now()): BudgetEvaluation {
  return recordBudget(key, nowMs - startedAtMs)
}

/**
 * Time `work` and record it.
 *
 * ⚠ A REJECTION IS STILL MEASURED. A read that fails after 9 seconds is the most over-budget thing
 * on the page, and dropping it because it threw is how a timeout looks fast in the data. The
 * rejection is re-thrown unchanged.
 */
export async function measure<T>(key: BudgetKey, work: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  const startedAt = now()
  try {
    const result = await work()
    recordBudget(key, now() - startedAt)
    return result
  } catch (error) {
    try {
      recordBudget(key, now() - startedAt)
    } catch {
      // Never let the measurement replace the caller's error.
    }
    throw error
  }
}
