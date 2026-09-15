/**
 * Sentry client-side SDK initialization (Next.js App Router).
 * Loaded automatically by @sentry/nextjs when withSentryConfig wraps next.config.js — and, in
 * @sentry/nextjs 10, it is the ONLY `sentry.*.config.ts` file the SDK injects. The server is set
 * up by `initSentryServer()` via `instrumentation.ts`, not by a config file.
 *
 * This is the one client init in practice. `ErrorTrackingInit` also calls `initSentryClient()`,
 * but that loads `@sentry/nextjs` through a bare-specifier dynamic `import()`, which a browser
 * cannot resolve, so it never initialises a second client.
 *
 * Sampling, span attributes and the resource-span filter live in
 * `lib/observability/clientTelemetry.ts`, with the reasoning and the measurements behind them.
 */
import * as Sentry from '@sentry/nextjs'

import {
  CLIENT_IGNORED_RESOURCE_OPS,
  beforeStartClientSpan,
  clientTracesSampler,
} from '@/lib/observability/clientTelemetry'
import { enrichAndScrubEvent } from '@/lib/observability/eventProcessing'
import { scrubBreadcrumb, scrubSpanJson } from '@/lib/observability/redaction'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
/*
 * ⚠ FAIL OPEN. This file is injected into the entry chunk of EVERY page, so a throw here is not a
 * telemetry bug, it is every page's JavaScript failing. And no CI build exercises it: withSentryConfig
 * only wraps the build when a DSN is present, which is production alone. Losing tracing for a deploy
 * is cheap; a broken app is not.
 */
if (dsn) {
  try {
    initClient(dsn)
  } catch (error) {
    console.error('[Sentry] client init failed; tracing and error reporting are off for this page load', error)
  }
}

function initClient(dsn: string): void {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,

    // Per-surface page-load/navigation rates (/core traced far more than marketing pages).
    tracesSampler: clientTracesSampler,

    integrations: [
      Sentry.browserTracingIntegration({
        // One span per fetched file was most of what the browser sent; web vitals are unaffected.
        ignoreResourceSpans: CLIENT_IGNORED_RESOURCE_OPS,
        // Screen, device class and network type, stamped when the span starts.
        beforeStartSpan: beforeStartClientSpan,
      }),
    ],

    // Same classify-then-scrub pass as the server: tokens in URLs (reset links, OAuth callbacks,
    // invite codes) never leave the browser.
    beforeSend: enrichAndScrubEvent,
    beforeSendTransaction: enrichAndScrubEvent,
    beforeSendSpan: scrubSpanJson,
    beforeBreadcrumb: scrubBreadcrumb,

    // 100 % of sessions that already have an error get a replay recorded.
    replaysOnErrorSampleRate: 1.0,
    // 1 % of all sessions get a replay (baseline).
    replaysSessionSampleRate: 0.01,

    // Don't flood the console in development.
    debug: false,
  })
}
