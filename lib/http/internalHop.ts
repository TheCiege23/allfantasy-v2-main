/**
 * Proof that a request is OUR OWN SERVER calling one of its own routes back
 * through the public hostname — not a person.
 *
 * ⚠ WHY THIS EXISTS. `/api/app/*` and `/api/shared/*` proxy to other routes by
 * fetching `https://www.allfantasy.ai/api/...`, and a few routes do the same
 * directly (zombie universe create, the C2C import preview/commit). That inner
 * request leaves Railway and comes back through Cloudflare, so Cloudflare
 * stamps `cf-connecting-ip` with RAILWAY'S egress address — a data centre. The
 * VPN gate refuses data centres, so without this every proxied call, for every
 * user, would have been refused as a VPN. Census 2026-09-24.
 *
 * The OUTER request is the one a person made, and it has already been through
 * the gate with the person's real address. This header lets the middleware
 * recognise the inner hop and not judge it a second time by the wrong address.
 *
 * ⚠ It is an HMAC, not a flag. A static "I am internal" header would be a free
 * pass for anyone who read this file — the repo is public. The token binds the
 * method, the path and a timestamp, is keyed on the auth secret the middleware
 * already holds, and lives 60 seconds. It never reaches a browser: the proxy
 * builds it and sends it only to our own hostname.
 *
 * Edge-runtime safe: Web Crypto only, so the middleware and Node route handlers
 * share one implementation.
 */

import { resolveAuthSecret } from "@/lib/auth/resolve-auth-secret"

export const INTERNAL_HOP_HEADER = "x-af-internal-hop"

const MAX_AGE_MS = 60_000
/** A signer and verifier on different replicas may disagree slightly about "now". */
const MAX_FUTURE_SKEW_MS = 5_000

/** Domain-separated, so this can never be mistaken for any other use of the auth secret. */
function hopMessage(ts: number, method: string, pathname: string): string {
  return `af-internal-hop|v1|${ts}|${method.toUpperCase()}|${pathname}`
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ])
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message))
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("")
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * The header value for one self-call, or `null` when no auth secret is
 * configured (in which case the middleware cannot verify it either).
 *
 * `pathname` is the TARGET's path, exactly as the middleware will see it —
 * `new URL(target).pathname`, never the full URL.
 */
export async function signInternalHop(
  method: string,
  pathname: string,
  secret: string | undefined = resolveAuthSecret(),
  now: number = Date.now(),
): Promise<string | null> {
  if (!secret) return null
  return `${now}.${await hmacHex(secret, hopMessage(now, method, pathname))}`
}

/** Headers to add to a fetch of our own `url`. Empty when there is nothing to sign with. */
export async function internalHopHeaders(method: string, url: string | URL): Promise<Record<string, string>> {
  const token = await signInternalHop(method, new URL(url).pathname)
  return token ? { [INTERNAL_HOP_HEADER]: token } : {}
}

export async function verifyInternalHop(
  headers: { get(name: string): string | null },
  method: string,
  pathname: string,
  secret: string | undefined = resolveAuthSecret(),
  now: number = Date.now(),
): Promise<boolean> {
  const raw = headers.get(INTERNAL_HOP_HEADER)?.trim()
  if (!raw || !secret) return false
  const dot = raw.indexOf(".")
  if (dot <= 0) return false
  const tsText = raw.slice(0, dot)
  if (!/^\d{1,16}$/.test(tsText)) return false
  const ts = Number(tsText)
  if (now - ts > MAX_AGE_MS || ts - now > MAX_FUTURE_SKEW_MS) return false
  const expected = await hmacHex(secret, hopMessage(ts, method, pathname))
  return constantTimeEqual(expected, raw.slice(dot + 1))
}
