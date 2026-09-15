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
    scrubEvent(target)
  } catch {
    delete target.request
    delete target.breadcrumbs
    delete target.extra
  }
  return event
}
