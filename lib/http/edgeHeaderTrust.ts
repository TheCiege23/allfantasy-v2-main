/**
 * Which edge-location headers a request is allowed to carry into the app.
 *
 * Every geo gate, the VPN check and every per-IP rate limit read `cf-*` (and, as a
 * fallback, `x-vercel-ip-*`) through lib/geo/geoHeaders and lib/http/clientIp. Those
 * headers are only facts when an edge we control SET them. A caller that reaches the
 * origin directly can send any value, and `cf-ipcountry: US` + `cf-region-code: <an
 * allowed state>` + a rotating `cf-connecting-ip` then unlocks every state restriction
 * and resets every rate limit.
 *
 * Measured 2026-11-12: `allfantasy-v2-main` runs the origin lock in ENFORCE mode, so an
 * unproven request never gets that far there. `allfantasy-v2-worker` runs the same
 * middleware with the lock OFF by design (the crons call its public
 * `.up.railway.app` domain directly, and no Cloudflare is in front of it) — so on the
 * worker every `cf-*` header was attacker-chosen and still trusted.
 *
 * The rule, on Railway (anywhere else nothing changes):
 *
 *   - `cf-*` is trusted only when the request carries a valid Cloudflare origin proof
 *     (lib/http/originLock). No proof configured, or none presented, means no
 *     Cloudflare can be vouched for, so the headers are removed before anything
 *     reads them. Geo then falls back to the IP lookup, and rate limits key on the
 *     platform-set peer address (lib/http/clientIp's second rule) — which this file
 *     never reads itself; that file stays the one rule for "which address is the client".
 *   - `x-vercel-*` is never trusted: Railway is not Vercel, so it can only be forged.
 *
 * ⚠ IF THE ORIGIN LOCK IS EVER TURNED OFF ON A SERVICE THAT *IS* BEHIND CLOUDFLARE,
 * this strips the real headers too, and every visitor is placed by IP lookup of a
 * Cloudflare edge address and shares that edge's rate limit. `AF_TRUST_UNVERIFIED_CF_HEADERS=1`
 * restores the old behaviour for that emergency; it is not a fix.
 *
 * Edge-runtime safe: no Node APIs, no I/O.
 */
import { ORIGIN_AUTH_HEADER, secretsMatch } from "@/lib/http/originLock"

export interface EdgeTrustEnv {
  RAILWAY_ENVIRONMENT_NAME?: string
  RAILWAY_DEPLOYMENT_ID?: string
  RAILWAY_SERVICE_NAME?: string
  CF_ORIGIN_AUTH_SECRET?: string
  AF_TRUST_UNVERIFIED_CF_HEADERS?: string
}

function readEnv(): EdgeTrustEnv {
  return {
    RAILWAY_ENVIRONMENT_NAME: process.env.RAILWAY_ENVIRONMENT_NAME,
    RAILWAY_DEPLOYMENT_ID: process.env.RAILWAY_DEPLOYMENT_ID,
    RAILWAY_SERVICE_NAME: process.env.RAILWAY_SERVICE_NAME,
    CF_ORIGIN_AUTH_SECRET: process.env.CF_ORIGIN_AUTH_SECRET,
    AF_TRUST_UNVERIFIED_CF_HEADERS: process.env.AF_TRUST_UNVERIFIED_CF_HEADERS,
  }
}

function onRailway(env: EdgeTrustEnv): boolean {
  return Boolean(env.RAILWAY_ENVIRONMENT_NAME?.trim() || env.RAILWAY_DEPLOYMENT_ID?.trim() || env.RAILWAY_SERVICE_NAME?.trim())
}

/** True when the request proves it came through our Cloudflare (the same proof the origin lock checks). */
export function hasCloudflareProof(headers: { get(name: string): string | null }, env: EdgeTrustEnv = readEnv()): boolean {
  const secret = env.CF_ORIGIN_AUTH_SECRET?.trim()
  const presented = headers.get(ORIGIN_AUTH_HEADER)
  return Boolean(secret && presented && secretsMatch(secret, presented))
}

const isCloudflareHeader = (name: string) => name.toLowerCase().startsWith("cf-")
const isVercelHeader = (name: string) => name.toLowerCase().startsWith("x-vercel-")

/**
 * The header names that must be removed from this request before anything reads it.
 * Empty when nothing needs removing — the common case — so callers can skip cloning.
 */
export function untrustedEdgeHeaderNames(
  headers: Headers,
  env: EdgeTrustEnv = readEnv(),
): string[] {
  if (!onRailway(env)) return []
  const trustCloudflare = env.AF_TRUST_UNVERIFIED_CF_HEADERS === "1" || hasCloudflareProof(headers, env)
  const names: string[] = []
  headers.forEach((_value, name) => {
    if (isVercelHeader(name) || (!trustCloudflare && isCloudflareHeader(name))) names.push(name)
  })
  return names
}
