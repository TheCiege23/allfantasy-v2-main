/**
 * One span per /core home card, so a budget can name the card that is slow — not just the screen.
 *
 * Since the home's cards stream independently, the request's duration is its slowest card and
 * `af.shell_ms` is the time to the shell; neither says WHICH card the user was waiting for. Each
 * card's read runs inside a `core.card` span named for the card, so the database spans it issues
 * nest under it and the slowest card is one query away (see docs/observability/TRACING.md).
 *
 * ⚠ CLOSED VOCABULARY. The name is a `CoreCardRead` literal, never a league or player id — an
 * unbounded span name would make the dimension useless and the bill larger. It names the READ that
 * feeds a card (`dash34` feeds five), not the card itself; `CoreCardBoundary` tags render failures by
 * card.
 *
 * ⚠ TELEMETRY MUST NEVER BREAK A CARD. If Sentry throws starting the span, the read runs untraced;
 * the read's own result or rejection is always what the caller gets. Outside a traced request
 * (`onlyIfParent`) no span is created at all.
 */

import * as Sentry from '@sentry/nextjs'

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
      pending = run()
      return pending
    })
  } catch {
    // Sentry failed. If the read already started, hand back THAT read — never start it twice.
    return pending ?? run()
  }
}
