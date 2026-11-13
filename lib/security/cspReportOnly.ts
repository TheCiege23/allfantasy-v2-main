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

/*
 * Ad and analytics vendors that Google Tag Manager injects at runtime. Every origin
 * below was MEASURED, not guessed: they are the top of the production csp-report log
 * for 2026-11-11 → 11-12 (501 reports), and each matches a vendor named in
 * docs/play-store/RUNBOOK.md's network capture and in /privacy's Section 5 table.
 * Listing them turns those reports off so the remaining ones are signal.
 *
 * ⚠ DELIBERATELY STILL MISSING, so they keep reporting until someone decides:
 *   - `eval` (script-src) — a GTM custom template; allowing it is 'unsafe-eval'.
 *   - `mpc-pilot-*.a.run.app` / `mpc2-prod-*.a.run.app` — an unidentified fetch that
 *     fires right after the Meta SDK (see the runbook). Its hostname rotates, so a
 *     single entry would not hold, and an unknown third party should not be waved
 *     through by an allowlist.
 */
const AD_VENDOR_SCRIPTS = [
  'https://analytics.tiktok.com',
  'https://www.redditstatic.com',
  'https://googleads.g.doubleclick.net',
  'https://static.cloudflareinsights.com',
]

const AD_VENDOR_CONNECT = [
  'https://analytics.tiktok.com',
  'https://analytics-ipv6.tiktokw.us',
  'https://alb.reddit.com',
  'https://pixel-config.reddit.com',
  'https://analytics.google.com',
  'https://www.google.com',
  'https://ad.doubleclick.net',
  'https://stats.g.doubleclick.net',
  'https://googleads.g.doubleclick.net',
  'https://cloudflareinsights.com',
]

export const CSP_REPORT_ONLY_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': [
    "'self'",
    "'unsafe-inline'",
    ...GOOGLE_ANALYTICS,
    'https://connect.facebook.net',
    'https://js.stripe.com', // /support's buy button
    'https://sdk.scdn.co', // Spotify Web Playback SDK
    'https://platform.twitter.com', // opt-in X posts
    ...AD_VENDOR_SCRIPTS,
  ],
  'connect-src': [
    "'self'", // also covers same-host ws(s): and PostHog, which is proxied via /ingest
    ...GOOGLE_ANALYTICS,
    ...META,
    ...SENTRY_INGEST,
    ...AD_VENDOR_CONNECT,
    'https://api.stripe.com',
    'https://syndication.twitter.com',
  ],
  'img-src': ["'self'", 'data:', 'blob:', 'https:'],
  'media-src': ["'self'", 'blob:', 'https:'],
  'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  'frame-src': [
    "'self'",
    'https://js.stripe.com',
    'https://www.youtube-nocookie.com',
    'https://platform.twitter.com',
    'https://syndication.twitter.com',
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

// ── Phase 2: ENFORCED ─────────────────────────────────────────────────────────
//
// Built from the report-only policy plus what a WEEK of production reports showed it
// still missed (csp-report log 2026-11-07 → 11-12, 1,503 reports). Every addition
// below is measured, and each one would otherwise have broken a live tag on the
// first enforced page view:
//
//  - `'unsafe-eval'` (script-src): 98 reports, inline (document-sourced) — a GTM
//    custom template. Given `'unsafe-inline'` is already required, refusing eval
//    stops no XSS that inline script cannot already do; it would only break the tag.
//  - The apex `allfantasy.ai` (script-src): `'self'` names only the host serving the
//    page, and assets were requested from the apex while the page was on www.
//  - `connect-src` is `https:` rather than a host list. Google Ads remarketing beacons
//    to `www.google.<country>` (google.es / .ca / .lk seen) and a GTM tag fetches a
//    rotating `*.a.run.app` host; neither can be listed exhaustively. This costs
//    almost nothing: with `img-src https:` (required for player headshots from many
//    CDNs) any script can already exfiltrate with an image request, so a connect-src
//    host list was never the barrier.
//  - `form-action` adds `https://www.facebook.com` (the Meta pixel submits there).
//  - `frame-src` adds `https://hooks.stripe.com`, Stripe's documented 3-D Secure frame
//    for the /support buy button — too rare to have appeared in a week of reports,
//    and the one place a block would cost a payment.
//
// What this enforces that nothing did before: scripts load only from the listed
// origins (an injected <script src="https://evil…"> is refused), frames only from the
// listed origins, forms post only to us (and Meta), plus no plugins, no <base>
// hijack, no framing. What it does NOT do: stop an INLINE-script XSS — that needs
// `'unsafe-inline'` replaced by per-request nonces, which forces every page dynamic
// and is its own project.

const APEX_AND_WWW = ['https://allfantasy.ai', 'https://www.allfantasy.ai']

export const CSP_ENFORCED_DIRECTIVES: Record<string, string[]> = {
  ...CSP_REPORT_ONLY_DIRECTIVES,
  'script-src': [...CSP_REPORT_ONLY_DIRECTIVES['script-src'], "'unsafe-eval'", ...APEX_AND_WWW],
  'connect-src': ["'self'", 'https:', 'wss:'],
  'frame-src': [...CSP_REPORT_ONLY_DIRECTIVES['frame-src'], 'https://hooks.stripe.com'],
  'form-action': ["'self'", 'https://www.facebook.com'],
  // Only meaningful in an ENFORCED header (browsers ignore it in Report-Only).
  'frame-ancestors': ["'none'"],
}

export const CSP_ENFORCED_POLICY = serializeCsp(CSP_ENFORCED_DIRECTIVES)

// ── Phase 3: per-request NONCE, no 'unsafe-inline' ─────────────────────────────
//
// The allowlist above cannot stop an INLINE-script XSS: 'unsafe-inline' runs any
// <script> an attacker manages to inject. This policy drops it. A script runs only if
//   - it carries this request's nonce (Next stamps its own; the root layout stamps
//     ours), or
//   - it was inserted by a script that already runs ('strict-dynamic') — which is how
//     GTM, gtag, fbevents, Stripe, Spotify and the X embed all load their code.
//
// `https:` and `'unsafe-inline'` stay in the list ONLY as the documented fallback for
// browsers that predate CSP3: any browser that understands 'strict-dynamic' or a
// nonce ignores both (CSP3 §8.2), so they open nothing in a modern browser. Host
// allowlists are ignored under 'strict-dynamic' for the same reason, which is why
// none is repeated here. `'unsafe-eval'` stays: GTM custom templates eval (98 inline
// reports in the week this policy was measured from).
//
// `'report-sample'` asks the browser to include the first 40 characters of a blocked
// inline script in its report — the only way to tell WHICH GTM Custom HTML tag would
// break before anything is enforced.
//
// Every page is already rendered per request (the root layout reads cookies()), so a
// per-request nonce costs no static rendering.

/** A fresh nonce: 128 random bits, base64 — Edge-runtime safe. */
export function generateCspNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function buildNonceDirectives(nonce: string): Record<string, string[]> {
  return {
    ...CSP_ENFORCED_DIRECTIVES,
    'script-src': [
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      "'unsafe-eval'",
      "'report-sample'",
      'https:', // pre-CSP3 fallback only
      "'unsafe-inline'", // pre-CSP3 fallback only; ignored when a nonce is present
    ],
  }
}

export function buildNoncePolicy(nonce: string): string {
  return serializeCsp(buildNonceDirectives(nonce))
}

/**
 * What the site sends, by `CSP_MODE` on the service (a variable write redeploys it):
 *
 *   enforce       DEFAULT. Enforce the measured allowlist (Phase 2).
 *   nonce         Enforce the nonce policy — 'unsafe-inline' is gone.
 *   report-only   Report the allowlist only (Phase 1) — the deepest rollback.
 *   nonce-report  Enforce the allowlist AND report the nonce policy. ⚠ NOT a faithful
 *                 preview of `nonce` — read why below. Kept only for its inline
 *                 `script-sample`s, never as a go/no-go signal.
 *
 * 🛑 WHY nonce-report CANNOT PREVIEW nonce, MEASURED ON PRODUCTION 2026-11-13. Next's
 * router copies every RESPONSE header the middleware sets onto the REQUEST as well
 * (next/dist/server/lib/router-utils/resolve-routes.js: `req.headers[key] = value`), and
 * the renderer takes its nonce from `content-security-policy` before
 * `content-security-policy-report-only`. With the enforced allowlist present, Next reads
 * a policy with no nonce and stamps NOTHING: 60 of 62 <script> tags on `/` went out
 * without one, so every Next chunk and flight script reports as a violation. In `nonce`
 * mode the enforced header IS the nonce policy, so Next reads the right value. Preview
 * strict mode per request with the probe cookie instead (`cspModeForRequest`).
 *
 * An unknown value is the default, so a typo cannot loosen anything.
 */
export type CspMode = 'nonce-report' | 'nonce' | 'enforce' | 'report-only'

export function cspMode(raw: string | undefined = process.env.CSP_MODE): CspMode {
  const v = raw?.trim().toLowerCase()
  if (v === 'nonce' || v === 'nonce-report' || v === 'report-only') return v
  return 'enforce'
}

/** Cookie that previews strict (nonce) mode for one browser. See `cspModeForRequest`. */
export const CSP_PROBE_COOKIE = 'af_csp_probe'

/**
 * The mode for THIS request: the service's `CSP_MODE`, except that a browser carrying
 * `af_csp_probe=nonce` gets `nonce`.
 *
 * It can only make a page STRICTER: every mode it overrides is looser than `nonce`, and
 * no cookie value selects anything else. So it is safe to leave in production, and it
 * is how strict mode is verified on the live site — real pages, the real GTM
 * container — before `CSP_MODE=nonce` applies it to everyone.
 */
export function cspModeForRequest(probeCookie: string | undefined, envMode: CspMode = cspMode()): CspMode {
  return probeCookie?.trim().toLowerCase() === 'nonce' ? 'nonce' : envMode
}

/** Whether pages in this mode need a nonce stamped on their scripts. */
export function modeUsesNonce(mode: CspMode): boolean {
  return mode === 'nonce' || mode === 'nonce-report'
}

// ── Report sanitising ──────────────────────────────────────────────────────────

export type CspViolationSummary = {
  directive: string
  blocked: string
  page: string
  source: string | null
  disposition: string
  /**
   * The browser's `script-sample` — at most the first 40 characters of a blocked INLINE
   * script, sent only because the nonce policy carries 'report-sample'. It is what
   * names the GTM tag that would break. Present only when the browser sent one.
   */
  sample?: string
}

const MAX_FIELD = 120
const MAX_SAMPLE = 40

/** The spec caps a sample at 40 characters; enforce that here too, and drop control characters. */
function sampleOf(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MAX_SAMPLE)
  return s || undefined
}

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
      ...(sampleOf(legacy['script-sample']) ? { sample: sampleOf(legacy['script-sample']) } : {}),
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
        ...(sampleOf(body.sample) ? { sample: sampleOf(body.sample) } : {}),
      })
    }
  }

  return out
}
