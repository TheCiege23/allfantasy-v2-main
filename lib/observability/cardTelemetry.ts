/**
 * One span per /core home card, so a budget can name the card that is slow — not just the screen.
 *
 * Since the home's cards stream independently, the request's duration is its slowest card and
 * `af.shell_ms` is the time to the shell; neither says WHICH card the user was waiting for. Each
 * card's read runs inside a `core.card` span named for the read, and the database spans it issues take
 * that span as their parent, so the slowest card is one query away (see docs/observability/TRACING.md).
 *
 * ⚠ A CHAINED READ IS TRACED FROM THE START OF ITS CHAIN. `trades` waits for the current week and
 * `since-last-visit` waits for `trades`; each span opens when its chain does, so a span's duration is
 * how long that card waited — not only its own query, which would rank a card that waited behind two
 * slow reads as fast.
 *
 * ⚠ CLOSED VOCABULARY. The name is a `CoreCardRead` literal, never a league or player id — an
 * unbounded span name would make the dimension useless and the bill larger. It names the READ that
 * feeds a card (`dash34` feeds eight), not the card itself; `CoreCardBoundary` tags render failures
 * by card.
 *
 * ⚠ TELEMETRY MUST NEVER BREAK A CARD. If Sentry throws starting the span, the read runs untraced;
 * the read's own result or rejection is always what the caller gets. Outside a traced request
 * (`onlyIfParent`) no span is created at all.
 */

import * as Sentry from '@sentry/nextjs'
import { recordBudgetOnActiveSpan } from '@/lib/sports-os/budgetTelemetry'

export type CoreCardRead =
  | 'dash34'
  | 'trade-week'
  | 'career'
  | 'week'
  | 'exposure'
  | 'rivals'
  | 'user-os'
  | 'schedule'
  | 'today-strip'
  | 'plays'
  | 'regular-season'
  | 'trades'
  | 'following'
  | 'receipts'
  | 'routine-facts'
  | 'since-last-visit'
  | 'win-probability'
  | 'drafts'
  | 'urgency-badges'

export function traceCard<T>(card: CoreCardRead, load: () => Promise<T>): Promise<T> {
  // Always a promise: a loader that throws synchronously still reaches the caller's `.catch`.
  const run = (): Promise<T> => {
    try {
      return load()
    } catch (error) {
      return Promise.reject(error)
    }
  }
  let pending: Promise<T> | undefined
  try {
    return Sentry.startSpan({ name: card, op: 'core.card', onlyIfParent: true, attributes: { 'af.card': card } }, () => {
      const startedAt = Date.now()
      pending = run()
      /*
       * The card's duration against its declared budget (`lib/sports-os/budgets.ts`), written on
       * THIS span rather than the root — see `recordBudgetOnActiveSpan`. Nineteen cards all writing
       * `af.budget.card_*` to one root span would be one arbitrary winner, not nineteen readings.
       *
       * ⚠ SETTLED THROUGH `.then`, NOT `.finally`, ON PURPOSE. Sentry ends the span when the
       * promise this callback returns settles; attaching a side-effect and returning the ORIGINAL
       * promise races the span's own close, and a late attribute write on a closed span is silently
       * dropped. Returning the derived promise makes the write strictly precede the close.
       *
       * ⚠ A REJECTION IS STILL MEASURED. A read that fails after nine seconds is the most
       * over-budget thing on the page, and dropping it because it threw is how a timeout looks
       * fast in the data. The rejection is re-thrown unchanged.
       *
       * ⚠ DEVICE-NEUTRAL, WHICH IS A KNOWN LIMIT RATHER THAN AN OVERSIGHT. `traceCard` has no
       * request headers in scope, so the verdict uses the `unknown` multiplier — a middle value
       * between desktop and mobile. `af.budget.card_ms` is exact regardless, and the root span's
       * `af.device` is there to split by in Sentry. Threading a device through all nineteen call
       * sites is the fix when the verdict itself needs to be per-device.
       */
      const settle = <R,>(fn: () => R): R => {
        try {
          recordBudgetOnActiveSpan({ phase: 'card', name: card }, Date.now() - startedAt)
        } catch {
          // Telemetry must never break a card.
        }
        return fn()
      }
      return pending.then(
        (value) => settle(() => value),
        (error) => settle(() => { throw error }),
      )
    })
  } catch {
    // Sentry failed. If the read already started, hand back THAT read — never start it twice.
    return pending ?? run()
  }
}
