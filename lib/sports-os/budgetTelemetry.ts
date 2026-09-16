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

/** Stamp an already-measured duration against its budget. Returns the evaluation for a caller log. */
export function recordBudget(key: BudgetKey, observedMs: number): BudgetEvaluation {
  const evaluation = evaluateBudget(key, observedMs)
  try {
    const active = Sentry.getActiveSpan()
    if (!active) return evaluation
    const root = Sentry.getRootSpan(active)
    if (!root.isRecording()) return evaluation
    const prefix = `af.budget.${key.phase}`
    root.setAttributes({
      [`${prefix}_ms`]: evaluation.observedMs,
      [`${prefix}_verdict`]: evaluation.verdict,
      [`${prefix}_ratio`]: evaluation.ratio,
    })
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
