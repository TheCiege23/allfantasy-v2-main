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
