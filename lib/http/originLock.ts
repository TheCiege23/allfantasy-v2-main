/**
 * Refuse requests that did not come through Cloudflare.
 *
 * Measured 2026-09-24: the Railway origin answered directly — both on its
 * `.up.railway.app` domain and on `www.allfantasy.ai` sent straight to Railway's
 * edge IP (valid certificate, 200). The app trusted forged Cloudflare headers
 * completely, so `cf-ipcountry: CA` unlocked every state restriction and a forged
 * `cf-connecting-ip` reset every per-IP rate limit. Railway has no inbound IP
 * allow-list and cannot verify Cloudflare's client certificate, so the proof of
 * transit is a secret that a Cloudflare Transform Rule stamps on every request.
 *
 * Configuration (both on `allfantasy-v2-main` ONLY):
 *
 *   CF_ORIGIN_AUTH_SECRET   the value the Cloudflare rule sets in ORIGIN_AUTH_HEADER
 *   CF_ORIGIN_LOCK_MODE     "report" — log what would be refused, refuse nothing
 *                           "enforce" — refuse it
 *                           anything else, or unset — off
 *
 * ⚠ OFF UNLESS BOTH ARE SET, AND AN UNKNOWN MODE IS OFF. The worker runs this same
 * middleware and the crons call its `.up.railway.app` domain directly, where no
 * Cloudflare exists; and a typo in the mode must not take the site down.
 *
 * ⚠ ROLL OUT IN THIS ORDER, or the site goes down: Cloudflare rule first (a
 * header nobody checks is harmless), then secret + `report`, read the logs for
 * legitimate direct callers, then `enforce`.
 *
 * Edge-runtime safe: no Node APIs, no I/O.
 */

export const ORIGIN_AUTH_HEADER = "x-af-origin-auth"

/**
 * Paths answered without the secret. Railway's healthcheck calls the container
 * over its internal network, never through Cloudflare, and a refused healthcheck
 * fails the deploy. It returns liveness only.
 */
const EXEMPT_PATHS = new Set(["/api/health"])

export type OriginLockMode = "off" | "report" | "enforce"

export interface OriginLockEnv {
  CF_ORIGIN_AUTH_SECRET?: string
  CF_ORIGIN_LOCK_MODE?: string
}

export type OriginLockDecision =
  | { action: "allow" }
  | { action: "report"; reason: "missing" | "mismatch" }
  | { action: "refuse"; reason: "missing" | "mismatch" }

function modeOf(env: OriginLockEnv): OriginLockMode {
  const secret = env.CF_ORIGIN_AUTH_SECRET?.trim()
  if (!secret) return "off"
  const mode = env.CF_ORIGIN_LOCK_MODE?.trim().toLowerCase()
  return mode === "report" || mode === "enforce" ? mode : "off"
}

/**
 * Constant-time for equal lengths. A length mismatch returns early, which leaks
 * the length — acceptable for a long random secret, and `crypto.timingSafeEqual`
 * is not available in the Edge runtime.
 */
export function secretsMatch(expected: string, actual: string): boolean {
  if (!expected || !actual) return false
  if (expected.length !== actual.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i)
  return diff === 0
}

export function checkOriginLock(
  headers: { get(name: string): string | null },
  pathname: string,
  // Read by name, not by passing `process.env`: OriginLockEnv is all-optional (a
  // "weak type"), and with this repo's ambient ProcessEnv declarations the whole
  // object fails TS2559 — which CI's ratchet caught and an isolated tsc did not.
  env: OriginLockEnv = {
    CF_ORIGIN_AUTH_SECRET: process.env.CF_ORIGIN_AUTH_SECRET,
    CF_ORIGIN_LOCK_MODE: process.env.CF_ORIGIN_LOCK_MODE,
  },
): OriginLockDecision {
  const mode = modeOf(env)
  if (mode === "off" || EXEMPT_PATHS.has(pathname)) return { action: "allow" }

  const presented = headers.get(ORIGIN_AUTH_HEADER)
  if (presented && secretsMatch(env.CF_ORIGIN_AUTH_SECRET!.trim(), presented)) return { action: "allow" }

  const reason = presented ? "mismatch" : "missing"
  return mode === "enforce" ? { action: "refuse", reason } : { action: "report", reason }
}

/**
 * One log line per (reason, host, path) per process. Report mode exists to find
 * legitimate direct callers, which means reading this log; a line per request
 * would bury them and cost money. Never logs the presented header's value.
 */
const reported = new Set<string>()
const MAX_REPORTED = 500

export type OriginLockOutcome = "would-refuse" | "refused" | "redirected"

const OUTCOME_WORDS: Record<OriginLockOutcome, string> = {
  "would-refuse": "would refuse",
  refused: "refused",
  redirected: "redirected to the canonical host",
}

export function reportOriginLock(reason: string, host: string | null, pathname: string, outcome: OriginLockOutcome): void {
  const key = `${reason}|${host ?? ""}|${pathname}`
  if (reported.has(key) || reported.size >= MAX_REPORTED) return
  reported.add(key)
  console.warn(
    `[origin-lock] ${OUTCOME_WORDS[outcome]} a request that did not come through Cloudflare ` +
      `(edge secret ${reason}) host=${host ?? "-"} path=${pathname}. Logged once per path per process.`,
  )
}

export type OriginLockRefusal = { kind: "redirect"; location: string } | { kind: "forbidden" }

/**
 * How to refuse a request the lock has rejected in enforce mode.
 *
 * A PAGE request (GET/HEAD, outside /api/) that reached the origin under a
 * non-canonical host is 308'd to the canonical host with the same path and
 * query. Measured 2026-09-24: AdsBot-Google fetches an ad landing page on the
 * origin's own `.up.railway.app` host, and a 403 there is how an ad gets
 * disapproved. The redirected request comes back through Cloudflare, which sets
 * its own location headers over any forged ones, so this is no less secure.
 *
 * Everything else is a 403:
 *   - API calls and non-GET methods: a machine gets a clear refusal, and a
 *     redirect would change what a POST means.
 *   - A request that already claims the canonical host (Host: www sent straight
 *     to Railway's IP). Redirecting it to itself would loop — and if the
 *     Cloudflare rule were ever removed, every visitor would get
 *     ERR_TOO_MANY_REDIRECTS instead of a clear 403.
 *   - A canonical host that is itself a Railway origin host (a misconfigured
 *     deployment falls back to RAILWAY_PUBLIC_DOMAIN): it bypasses Cloudflare
 *     too, so redirecting there loops.
 *   - No Host header: nothing to reason about.
 *
 * The Location is built by assigning pathname/search onto a URL for the
 * canonical host — never by resolving the path against it — so a path like
 * `//evil.example/x` cannot become a protocol-relative open redirect, and
 * X-Forwarded-Host is never read.
 */
export function originLockRefusal(
  req: { method: string; pathname: string; search: string; host: string | null },
  canonicalHost: string,
): OriginLockRefusal {
  const method = req.method.toUpperCase()
  const isApi = req.pathname === "/api" || req.pathname.startsWith("/api/")
  if ((method !== "GET" && method !== "HEAD") || isApi) return { kind: "forbidden" }

  const host = (req.host ?? "").split(":")[0].trim().toLowerCase()
  const canonical = canonicalHost.trim().toLowerCase()
  if (!host || !canonical || host === canonical) return { kind: "forbidden" }
  if (canonical.endsWith(".up.railway.app") || canonical.endsWith(".railway.internal")) return { kind: "forbidden" }

  const url = new URL(`https://${canonical}`)
  url.pathname = req.pathname
  url.search = req.search
  if (url.hostname !== canonical) return { kind: "forbidden" }
  return { kind: "redirect", location: url.toString() }
}

/** Test seam. */
export function __resetOriginLockReports(): void {
  reported.clear()
}
