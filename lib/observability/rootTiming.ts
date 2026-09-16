/**
 * Durations stamped on the request's ROOT span, so a budget can be read per screen and device
 * alongside the `af.screen` / `af.device` dimensions and the `af.db.*` totals already there.
 *
 * First use: `af.shell_ms` on /core — how long the page took to have everything the shell
 * needs (session, league list, the parallel chrome reads). With the screen streaming in behind
 * the shell, the request's own duration measures the slowest screen read, not what the user
 * waited for before the app appeared; this is that second number.
 *
 * Never throws, and does nothing outside a sampled request.
 */

import * as Sentry from '@sentry/nextjs'

export function recordRootDuration(attribute: string, startedAtMs: number, nowMs: number = Date.now()): void {
  try {
    const active = Sentry.getActiveSpan()
    if (!active) return
    const root = Sentry.getRootSpan(active)
    if (!root.isRecording()) return
    root.setAttributes({ [attribute]: Math.max(0, Math.round(nowMs - startedAtMs)) })
  } catch {
    // Telemetry must never fail a render.
  }
}

/**
 * Record a phase that has ALREADY FINISHED as its own span, back-dated to when it started.
 *
 * 🛑 THIS EXISTS BECAUSE A NUMERIC ATTRIBUTE IS NOT QUERYABLE AND A SPAN'S DURATION IS.
 * Measured 2026-09-16 against the `all-fantasy` Sentry org: `af.shell_ms` and `af.db.ms` both come
 * back as `INVALID — Unknown attribute`, typed as strings, while the string attributes on the very
 * same spans (`af.surface`, `af.screen`, `af.card`) query fine. So a duration stamped with
 * `recordRootDuration` can be read on an individual trace and cannot be aggregated — no p75, no
 * percentile, no calibration. `span.duration` is a native field and has none of that problem, which
 * is how the per-card numbers were obtained.
 *
 * ⚠ CREATED RETROACTIVELY, AND THAT IS THE WHOLE POINT OF THE SHAPE. The obvious alternative —
 * opening a span where the phase begins and ending it where it finishes — leaks on every early
 * return between the two, and `/core` has several between its auth gate and its shell. A span that
 * is created and ended on the same line cannot leak: if control never reaches here, no span exists.
 *
 * ⚠ INACTIVE, SO IT PARENTS NOTHING. `startInactiveSpan` does not put itself on the scope, so the
 * streamed screen's `core.card` spans keep the request root as their parent. Making the shell span
 * active would silently re-parent every card under a span that had already ended.
 *
 * ⚠ `onlyIfParent` SO AN UNSAMPLED REQUEST CREATES NOTHING, matching `traceCard`.
 *
 * Never throws. Telemetry must never fail a render.
 */
export function recordCompletedSpan(options: {
  name: string
  op: string
  startedAtMs: number
  /** Defaults to now. */
  endedAtMs?: number
  attributes?: Record<string, string | number | boolean>
}): void {
  try {
    const endedAtMs = options.endedAtMs ?? Date.now()
    const span = Sentry.startInactiveSpan({
      name: options.name,
      op: options.op,
      onlyIfParent: true,
      startTime: new Date(options.startedAtMs),
      attributes: options.attributes,
    })
    // A clock that went backwards must not produce a negative duration.
    span.end(new Date(Math.max(options.startedAtMs, endedAtMs)))
  } catch {
    // Telemetry must never fail a render.
  }
}
