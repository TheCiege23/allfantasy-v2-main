/**
 * Phase 1 of the script-restricting Content-Security-Policy: REPORT-ONLY.
 *
 * Nothing here blocks anything. Browsers evaluate this policy, load the page exactly
 * as before, and POST a report for every resource the policy would have refused.
 * The point is to learn the real set of origins the site depends on — including
 * whatever Google Tag Manager injects at runtime, which no grep of this repo can
 * see — before any of it is enforced. An enforced CSP that misses one origin breaks
 * checkout or analytics silently, which is why the baseline in middleware.ts
 * enforces only `frame-ancestors`.
 *
 * ⚠ `'unsafe-inline'` IN script-src IS DELIBERATE FOR THIS PHASE. Next.js emits
 * inline bootstrap scripts, and the root layout carries the Meta Pixel, gtag, GTM
 * and analytics-healthcheck inline scripts. Without it every page would report a
 * flood of inline violations that tell us nothing new. This phase therefore
 * measures EXTERNAL hosts only; removing 'unsafe-inline' (via nonces or hashes) is
 * a separate later decision, and enforcing this policy as written would not stop an
 * inline-script XSS.
 *
 * img-src and media-src are deliberately broad (`https:`): the app renders player
 * headshots, team logos and highlight media from many CDNs, none of which can run
 * script. Narrowing them is not what this rollout is for.
 *
 * Reports go to app/api/security/csp-report, which keeps origins and paths only.
 *
 * ⚠ Sleeper's API host is deliberately NOT in connect-src, although some client
 * components fetch it directly. Listing a vendor data host here trips
 * scripts/check-db-first-api-boundary.mjs (it matches the URL, not the intent), and
 * leaving it out costs nothing while this is report-only: the reports then name
 * exactly which pages call Sleeper from the browser — evidence the DB-first
 * migration wants anyway. Decide it deliberately before enforcing.
 */

export const CSP_REPORT_PATH = '/api/security/csp-report'

const SENTRY_INGEST = ['https://*.ingest.sentry.io', 'https://*.ingest.us.sentry.io']

const GOOGLE_ANALYTICS = [
  'https://www.googletagmanager.com',
  'https://www.google-analytics.com',
  'https://*.google-analytics.com',
  'https://*.analytics.google.com',
]

const META = ['https://connect.facebook.net', 'https://www.facebook.com']

export const CSP_REPORT_ONLY_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': [
    "'self'",
    "'unsafe-inline'",
    ...GOOGLE_ANALYTICS,
    'https://connect.facebook.net',
    'https://js.stripe.com', // /support's buy button
    'https://sdk.scdn.co', // Spotify Web Playback SDK
  ],
  'connect-src': [
    "'self'", // also covers same-host ws(s): and PostHog, which is proxied via /ingest
    ...GOOGLE_ANALYTICS,
    ...META,
    ...SENTRY_INGEST,
    'https://api.stripe.com',
  ],
  'img-src': ["'self'", 'data:', 'blob:', 'https:'],
  'media-src': ["'self'", 'blob:', 'https:'],
  'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  'frame-src': [
    "'self'",
    'https://js.stripe.com',
    'https://www.youtube-nocookie.com',
    'https://sdk.scdn.co',
    'https://open.spotify.com',
    'https://www.facebook.com',
    'https://www.googletagmanager.com',
  ],
  'worker-src': ["'self'", 'blob:'],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  // report-uri ONLY. Do not add `report-to` without testing delivery first: when a
  // policy carries report-to, Chrome ignores report-uri entirely, and a report-to
  // endpoint Chrome will not use (measured: a plain-http origin) means Chrome — most
  // of the traffic — sends nothing at all. report-uri reaches us from Chrome, Firefox
  // and Safari today; verified end to end with headless Chromium.
  'report-uri': [CSP_REPORT_PATH],
}

export function serializeCsp(directives: Record<string, string[]>): string {
  return Object.entries(directives)
    .map(([name, values]) => [name, ...values].join(' '))
    .join('; ')
}

export const CSP_REPORT_ONLY_POLICY = serializeCsp(CSP_REPORT_ONLY_DIRECTIVES)

// ── Report sanitising ──────────────────────────────────────────────────────────

export type CspViolationSummary = {
  directive: string
  blocked: string
  page: string
  source: string | null
  disposition: string
}

const MAX_FIELD = 120

function clip(value: string): string {
  return value.length > MAX_FIELD ? `${value.slice(0, MAX_FIELD)}…` : value
}

/**
 * Reduce a URL to something safe to log. Query strings and fragments are dropped
 * because they can carry tokens (this repo already has a provider that passes its
 * credential as a query parameter); for our own pages only the path is kept, and
 * for third parties only the origin.
 *
 * Keywords the CSP spec uses in place of a URL (`inline`, `eval`, `data`, …) pass
 * through unchanged.
 */
export function redactUrl(raw: unknown, mode: 'origin' | 'path'): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  if (!raw.includes(':') || /^[a-z-]+$/i.test(raw)) return clip(raw)
  try {
    const url = new URL(raw)
    if (url.protocol === 'data:' || url.protocol === 'blob:') return url.protocol.slice(0, -1)
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      return clip(url.protocol)
    }
    return clip(mode === 'path' ? url.pathname : url.origin)
  } catch {
    return clip(raw.split(/[?#]/)[0] ?? '')
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Accepts both report shapes browsers send and returns one summary per violation:
 * - `report-uri`: `{ "csp-report": { "violated-directive", "blocked-uri", … } }`
 * - Reporting API (`report-to`): `[ { type: "csp-violation", body: { effectiveDirective, blockedURL, … } } ]`
 *
 * Anything that is not a recognisable CSP report yields an empty list.
 */
export function summarizeCspReports(payload: unknown): CspViolationSummary[] {
  const out: CspViolationSummary[] = []

  const legacy = (payload as { 'csp-report'?: Record<string, unknown> } | null)?.['csp-report']
  if (legacy && typeof legacy === 'object') {
    out.push({
      directive: clip(str(legacy['effective-directive']) || str(legacy['violated-directive']).split(' ')[0] || 'unknown'),
      blocked: redactUrl(legacy['blocked-uri'], 'origin') ?? 'unknown',
      page: redactUrl(legacy['document-uri'], 'path') ?? 'unknown',
      source: redactUrl(legacy['source-file'], 'origin'),
      disposition: clip(str(legacy['disposition']) || 'report'),
    })
    return out
  }

  if (Array.isArray(payload)) {
    for (const entry of payload.slice(0, 50)) {
      const report = entry as { type?: unknown; body?: Record<string, unknown> } | null
      if (!report || report.type !== 'csp-violation' || !report.body || typeof report.body !== 'object') continue
      const body = report.body
      out.push({
        directive: clip(str(body.effectiveDirective) || 'unknown'),
        blocked: redactUrl(body.blockedURL, 'origin') ?? 'unknown',
        page: redactUrl(body.documentURL, 'path') ?? 'unknown',
        source: redactUrl(body.sourceFile, 'origin'),
        disposition: clip(str(body.disposition) || 'report'),
      })
    }
  }

  return out
}
