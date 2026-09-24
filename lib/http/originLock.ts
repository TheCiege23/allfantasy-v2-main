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

export function reportOriginLock(reason: string, host: string | null, pathname: string, mode: "report" | "enforce"): void {
  const key = `${reason}|${host ?? ""}|${pathname}`
  if (reported.has(key) || reported.size >= MAX_REPORTED) return
  reported.add(key)
  console.warn(
    `[origin-lock] ${mode === "enforce" ? "refused" : "would refuse"} a request that did not come through Cloudflare ` +
      `(edge secret ${reason}) host=${host ?? "-"} path=${pathname}. Logged once per path per process.`,
  )
}

/** Test seam. */
export function __resetOriginLockReports(): void {
  reported.clear()
}
