/**
 * Scrub credentials out of telemetry before it leaves the process.
 *
 * WHY IN THE SDK AND NOT ONLY IN SENTRY. Sentry's server-side scrubber does catch some of this —
 * measured 2026-09-15, all 18,300 Rolling Insights `http.client` spans in the week store
 * `http.query` as `[Filtered]` — but that is a project setting in someone else's product, and the
 * token has already left our process by the time it runs. Two defaults in @sentry/core 10.50 make
 * the exposure real rather than theoretical: `requestDataIntegration` includes COOKIES and request
 * BODIES unless told otherwise ("TODO(v11)" in its source), and every cron dispatch carries
 * `authorization: Bearer <CRON_SECRET>`. Sampling more requests multiplies all of it, so this ships
 * with — and before — any sampling increase.
 *
 * Built on `redactSecrets`, the repo's one redactor, rather than a fifth private copy of it.
 */

import { redactSecrets } from '@/lib/security/redactSecrets'

export const FILTERED = '[Filtered]'

/** Header names whose VALUE is a credential. The name is kept, so presence is still debuggable. */
const SENSITIVE_HEADER_NAME = /authorization|cookie|token|secret|passw|session|signature|credential|api[-_]?key|csrf|x-cron|x-sentry-auth/i

/**
 * Query parameters that grant access but that `redactSecrets` has no reason to know about: OAuth
 * `code`/`state`, one-time codes, and invite links, which grant league access to whoever holds them.
 */
const ACCESS_GRANTING_PARAM = /([?&](?:code|state|otp|invite|invite_?code|invite_?token|magic|ticket|nonce)=)[^&#\s]*/gi

export function scrubUrl(value: string): string {
  return redactSecrets(value).replace(ACCESS_GRANTING_PARAM, '$1***')
}

function scrubUnknownString(value: unknown): unknown {
  return typeof value === 'string' ? scrubUrl(value) : value
}

export function isSensitiveHeaderName(name: string): boolean {
  return SENSITIVE_HEADER_NAME.test(name)
}

export function scrubHeaders(headers: unknown): Record<string, string> | undefined {
  if (!headers || typeof headers !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [name, raw] of Object.entries(headers as Record<string, unknown>)) {
    if (raw == null) continue
    const value = Array.isArray(raw) ? raw.join(', ') : String(raw)
    out[name] = isSensitiveHeaderName(name) ? FILTERED : scrubUrl(value)
  }
  return out
}

/**
 * One parameter's value, scrubbed by the same rules as a whole URL. The `?` prefix matters: the
 * access-granting rule anchors on `?`/`&`, so a bare `code=…` would sail through. If a rule rewrote
 * the key as well as the value, the prefix no longer matches and the value is filtered outright —
 * over-redaction is the safe direction.
 */
function scrubParamValue(key: string, value: string): string {
  const prefix = `?${key}=`
  const scrubbed = scrubUrl(`${prefix}${value}`)
  return scrubbed.startsWith(prefix) ? scrubbed.slice(prefix.length) : FILTERED
}

/** Sentry normalises a query string as a string, an array of `[key, value]` pairs, or an object. */
function scrubQueryString(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('?')) return scrubUrl(value)
    return scrubUrl(`?${value}`).slice(1)
  }
  if (Array.isArray(value)) {
    return value.map((pair) =>
      Array.isArray(pair) && pair.length === 2 && typeof pair[1] === 'string'
        ? [pair[0], scrubParamValue(String(pair[0]), pair[1])]
        : pair,
    )
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = typeof entry === 'string' ? scrubParamValue(key, entry) : entry
    }
    return out
  }
  return value
}

export type RequestLikeEvent = {
  url?: string
  method?: string
  headers?: Record<string, unknown>
  cookies?: unknown
  data?: unknown
  query_string?: unknown
  env?: unknown
}

/**
 * Strip a Sentry `event.request`: cookies and bodies are dropped outright (a body is where a login
 * password lives), header values that are credentials are filtered, and URLs lose their tokens.
 */
export function scrubRequest<R extends RequestLikeEvent | undefined>(request: R): R {
  if (!request || typeof request !== 'object') return request
  const next: RequestLikeEvent = { ...(request as RequestLikeEvent) }
  delete next.cookies
  delete next.data
  delete next.env
  if (next.headers) next.headers = scrubHeaders(next.headers)
  if (typeof next.url === 'string') next.url = scrubUrl(next.url)
  if (next.query_string !== undefined) next.query_string = scrubQueryString(next.query_string)
  return next as R
}

type AttributeBag = Record<string, unknown>

/**
 * Span attributes, breadcrumb data and `contexts.trace.data`.
 *
 * ⚠ EVERY STRING VALUE IS SCRUBBED, WHATEVER ITS KEY. The first version scrubbed only keys that
 * sounded like URLs (`url`, `query`, `path`…), and a real `next dev` trace carried a planted invite
 * code and token straight through under `next.span_name` — Next's own tracing puts the full request
 * line there. Instrumentation we do not own decides attribute names, so an allow-list of names is a
 * guess. `redactSecrets` is a no-op on text without secrets; numbers and booleans pass untouched.
 */
export function scrubAttributes(bag: AttributeBag | undefined): AttributeBag | undefined {
  if (!bag || typeof bag !== 'object') return bag
  const out: AttributeBag = {}
  for (const [key, value] of Object.entries(bag)) {
    if (/^http\.(?:request|response)\.header\./i.test(key)) {
      const headerName = key.replace(/^http\.(?:request|response)\.header\./i, '')
      out[key] = isSensitiveHeaderName(headerName) ? FILTERED : scrubUnknownString(value)
    } else {
      out[key] = Array.isArray(value) ? value.map(scrubUnknownString) : scrubUnknownString(value)
    }
  }
  return out
}

/**
 * The fields the scrubbers touch, and nothing else. ⚠ No index signatures on these `*Like` types:
 * Sentry's `SpanJSON`, `Breadcrumb` and `Event` are interfaces, and TypeScript will not assign an
 * interface to a type with an index signature — the hooks would stop type-checking where they are
 * wired into `Sentry.init`.
 */
export type SpanJsonLike = { description?: string; data?: AttributeBag }

/** For `beforeSendSpan`: a provider call's description and URL attributes lose their credentials. */
export function scrubSpanJson<S extends SpanJsonLike>(span: S): S {
  if (!span || typeof span !== 'object') return span
  const target = span as SpanJsonLike
  if (typeof target.description === 'string') target.description = scrubUrl(target.description)
  if (target.data) target.data = scrubAttributes(target.data)
  return span
}

export type BreadcrumbLike = { message?: string; data?: AttributeBag }

export function scrubBreadcrumb<B extends BreadcrumbLike | null>(breadcrumb: B): B {
  if (!breadcrumb || typeof breadcrumb !== 'object') return breadcrumb
  const target = breadcrumb as BreadcrumbLike
  if (typeof target.message === 'string') target.message = scrubUrl(target.message)
  if (target.data) target.data = scrubAttributes(target.data)
  return breadcrumb
}
