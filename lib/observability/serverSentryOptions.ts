/**
 * The server `Sentry.init` options, in one place.
 *
 * ⚠ THIS IS THE SERVER CONFIG THAT ACTUALLY RUNS. `sentry.server.config.ts` looked like it, but
 * @sentry/nextjs 10 only injects `sentry.client.config.ts`; the server is initialised by
 * `initSentryServer()` (`lib/error-tracking/sentry.ts`, called from `instrumentation.ts`), which
 * builds its options here.
 *
 * `sentry` is the module that `initSentryServer` loaded, passed in rather than imported, because
 * that module is deliberately loaded outside webpack and this file must work against that instance.
 */

import { enrichAndScrubEvent, type SentryEventLike } from './eventProcessing'
import { scrubBreadcrumb, scrubSpanJson, type BreadcrumbLike, type SpanJsonLike } from './redaction'
import { createTracesSampler } from './sampling'

export type SentryServerModuleLike = {
  requestDataIntegration?: (options: { include?: Record<string, boolean> }) => unknown
}

export type ServerSentryOptionsInput = {
  dsn: string
  environment: string | undefined
  sentry: SentryServerModuleLike
  env?: Record<string, string | undefined>
  now?: () => number
}

export function buildServerSentryOptions(input: ServerSentryOptionsInput): Record<string, unknown> {
  const env = input.env ?? process.env
  const production = (input.environment ?? env.NODE_ENV) === 'production'

  const integrations: unknown[] = []
  if (typeof input.sentry.requestDataIntegration === 'function') {
    // Headers stay (the user-agent drives device classification, and they are scrubbed before
    // sending); cookies and bodies go. Both default to ON in @sentry/core 10.50 — see redaction.ts.
    integrations.push(input.sentry.requestDataIntegration({ include: { cookies: false, data: false } }))
  }

  return {
    dsn: input.dsn,
    environment: input.environment,
    // No `tracesSampleRate`: the sampler replaces the flat 10% this project ran until now.
    tracesSampler: createTracesSampler({ production, sampleAll: env.AF_TRACE_SAMPLE_ALL === '1', now: input.now }),
    integrations,
    beforeSend: (event: SentryEventLike) => enrichAndScrubEvent(event),
    beforeSendTransaction: (event: SentryEventLike) => enrichAndScrubEvent(event),
    beforeSendSpan: (span: SpanJsonLike) => scrubSpanJson(span),
    beforeBreadcrumb: (breadcrumb: BreadcrumbLike | null) => scrubBreadcrumb(breadcrumb),
  }
}
