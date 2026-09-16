/**
 * The one `beforeSend` / `beforeSendTransaction` body, shared by the server and the browser SDK.
 *
 * ORDER IS THE WHOLE DESIGN: classify first, scrub second. Classification needs the raw
 * `user-agent` and URL; scrubbing then removes what must not leave the process. The tags it adds are
 * closed vocabularies (see `requestContext.ts`), so nothing derived here can carry a credential.
 *
 * ⚠ ENRICHMENT MAY FAIL, SCRUBBING MAY NOT. If classification throws, the event is sent untagged.
 * If scrubbing throws, the request block and breadcrumbs are dropped rather than sent raw — losing
 * debugging context is recoverable, publishing a session cookie is not.
 */

import { classifyRequest, requestTags } from './requestContext'
import { scrubAttributes, scrubBreadcrumb, scrubRequest, scrubUrl, type BreadcrumbLike, type RequestLikeEvent } from './redaction'

type TraceContextLike = { data?: Record<string, unknown> }

/** Only the fields this module reads or writes — no index signatures (see `SpanJsonLike` in redaction.ts). */
export type SentryEventLike = {
  type?: string
  request?: RequestLikeEvent
  tags?: Record<string, unknown>
  extra?: Record<string, unknown>
  contexts?: { trace?: TraceContextLike }
  measurements?: Record<string, { value: number; unit: string }>
  breadcrumbs?: BreadcrumbLike[]
  exception?: { values?: Array<{ value?: string }> }
  message?: string
  transaction?: string
}

function tagEvent(event: SentryEventLike): void {
  const request = event.request
  if (!request || typeof request.url !== 'string') return
  const derived = requestTags(
    classifyRequest({
      url: request.url,
      method: request.method,
      headers: request.headers as Record<string, string | string[] | undefined> | undefined,
    }),
  )

  // Attributes set when the span STARTED win over values derived when the event is SENT: in the
  // browser a pageload span is sent after the user may already have navigated elsewhere.
  const traceData = event.contexts?.trace?.data ?? {}
  const merged: Record<string, string> = {}
  for (const [key, value] of Object.entries(derived)) {
    const atStart = traceData[key]
    merged[key] = typeof atStart === 'string' ? atStart : value
  }

  event.tags = { ...(event.tags ?? {}), ...merged }
  if (event.type === 'transaction') {
    const contexts = (event.contexts ??= {})
    const trace = (contexts.trace ??= {})
    trace.data = { ...merged, ...(trace.data ?? {}) }
  }
}

/**
 * 🛑 A NUMBER ON THE ROOT SPAN IS SENT BUT CANNOT BE QUERIED, AND THE TWO LOOK IDENTICAL IN THE UI.
 *
 * Measured 2026-09-16 off the wire: `af.shell_ms` and every `af.db.*` really do arrive, sitting in
 * `contexts.trace.data` — the writers work. But Sentry only indexes a TRANSACTION's searchable
 * fields from tags and measurements, so an aggregate over root-span data fails with "Unknown
 * attribute", and four of the five budget queries in docs/observability/TRACING.md could not run.
 * (`af.card` was fine throughout: it lives on CHILD spans, which the spans dataset does index.)
 *
 * Promoting here rather than at each writer is deliberate — `rootTiming`, `dbTelemetry` and
 * `jobTelemetry` keep setting plain span data, one place decides what is budgetable, and a future
 * numeric attribute becomes queryable by adding a line to this table rather than by touching the
 * code that measures it.
 *
 * ⚠ CLOSED VOCABULARY, like the tags. Promoting "anything numeric" would put unbounded cardinality
 * in the bill, and `af.db.slowest` is a STRING (a query description) that must never land here.
 */
const BUDGET_MEASUREMENTS: Record<string, 'millisecond' | 'none'> = {
  'af.shell_ms': 'millisecond',
  'af.db.ms': 'millisecond',
  'af.db.max_ms': 'millisecond',
  'af.db.count': 'none',
  'af.db.errors': 'none',
}

/**
 * The same defect in its STRING flavour, and it needs a tag rather than a measurement.
 * `af.sync_job` is set on the root span by `jobTelemetry`, is documented in TRACING.md as a
 * groupable dimension, and was equally unqueryable — "Unknown attribute", measured the same way.
 */
const BUDGET_TAGS = ['af.sync_job'] as const

function measureEvent(event: SentryEventLike): void {
  if (event.type !== 'transaction') return
  const data = event.contexts?.trace?.data
  if (!data) return
  for (const [key, unit] of Object.entries(BUDGET_MEASUREMENTS)) {
    const value = data[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const measurements = (event.measurements ??= {})
    // A measurement the SDK already set wins: it was closer to the thing it measured.
    if (measurements[key] === undefined) measurements[key] = { value, unit }
  }
  for (const key of BUDGET_TAGS) {
    const value = data[key]
    if (typeof value !== 'string' || value === '') continue
    const tags = (event.tags ??= {})
    // `tagEvent` ran first and its request-derived tags win; this only fills a gap.
    if (tags[key] === undefined) tags[key] = value
  }
}

function scrubEvent(event: SentryEventLike): void {
  if (event.request) event.request = scrubRequest(event.request)
  if (Array.isArray(event.breadcrumbs)) event.breadcrumbs = event.breadcrumbs.map((crumb) => scrubBreadcrumb(crumb))
  const trace = event.contexts?.trace
  if (trace?.data) trace.data = scrubAttributes(trace.data)
  // Provider errors routinely carry the URL they failed on, and Rolling Insights puts its token there.
  for (const entry of event.exception?.values ?? []) {
    if (typeof entry.value === 'string') entry.value = scrubUrl(entry.value)
  }
  if (typeof event.message === 'string') event.message = scrubUrl(event.message)
  // Route patterns normally, but instrumentation we do not own has named spans with the raw request line.
  if (typeof event.transaction === 'string') event.transaction = scrubUrl(event.transaction)
  if (event.extra && typeof event.extra === 'object') {
    for (const [key, value] of Object.entries(event.extra)) {
      if (typeof value === 'string') event.extra[key] = scrubUrl(value)
    }
  }
}

export function enrichAndScrubEvent<E extends SentryEventLike | null>(event: E): E {
  if (!event || typeof event !== 'object') return event
  const target = event as SentryEventLike
  try {
    tagEvent(target)
  } catch {
    // Untagged is fine.
  }
  try {
    measureEvent(target)
  } catch {
    // Unbudgeted is fine — the value is still on the span for a single-trace read.
  }
  try {
    scrubEvent(target)
  } catch {
    delete target.request
    delete target.breadcrumbs
    delete target.extra
  }
  return event
}
