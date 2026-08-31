/**
 * Commissioner OS · webhook delivery, signing, and the SSRF guard. T-113.
 *
 * TENANCY.md §7: "Webhook URLs are operator-controlled and the platform makes
 * outbound requests to them — https only, reject private/link-local/loopback
 * **after DNS resolution** (rebinding), no redirect following. Sign with an
 * HMAC over a timestamp plus body, with a tolerance window, so signatures
 * can't be replayed."
 *
 * ─── 🛑 "AFTER DNS RESOLUTION" IS NOT THE SAME AS "CHECK THEN FETCH" ─────────
 * The obvious implementation resolves the hostname, checks the addresses, and
 * then calls `fetch(url)`. That is still vulnerable, and the vulnerability is
 * the entire point of the word "rebinding": between the check and the fetch,
 * the attacker's DNS server answers again with a different address. The
 * validated answer and the connected-to answer are two separate lookups, and
 * nothing makes them agree.
 *
 * So `assertSafeWebhookUrl` returns the ADDRESS it validated, and the caller is
 * required to connect to THAT — see `SafeTarget`. Re-resolving is the bug.
 *
 * A guard that only checks-then-fetches would pass every test in this file
 * except the one that exists to catch it, which is why that test asserts on the
 * returned address rather than on the boolean.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { type DomainError, invariant } from './errors'
import { type Result, err, ok } from './result'

// ─── SSRF ────────────────────────────────────────────────────────────────────

/**
 * IPv4 ranges an outbound webhook must never reach.
 *
 * `169.254.0.0/16` is the one that matters most and the one people leave out:
 * it carries `169.254.169.254`, the cloud instance metadata endpoint, which on
 * an unpatched host hands out IAM credentials to anything that asks.
 *
 * `100.64.0.0/10` (CGNAT) and `198.18.0.0/15` (benchmarking) are here because
 * "private" is not only RFC1918 — both are routable-looking and neither belongs
 * to anyone an operator can legitimately point at.
 */
const BLOCKED_V4: ReadonlyArray<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

function v4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const b = Number(p)
    if (b > 255) return null
    n = (n << 8) | b
  }
  return n >>> 0
}

/**
 * Is this address one we must not connect to?
 *
 * ⚠ IPv4-MAPPED IPv6 IS UNWRAPPED FIRST. `::ffff:10.0.0.1` is 10.0.0.1 wearing
 * a different notation, and a checker that only pattern-matches IPv6 prefixes
 * waves it straight through. It is the single most common bypass for guards
 * that were written IPv4-first and had IPv6 bolted on.
 */
export function isBlockedAddress(address: string): boolean {
  const ip = address.trim().toLowerCase()
  if (ip === '') return true

  // IPv4-mapped / IPv4-compatible IPv6 → check as IPv4.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip) ?? /^::(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip)
  if (mapped) return isBlockedAddress(mapped[1])

  if (ip.includes(':')) {
    if (ip === '::' || ip === '::1') return true
    // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast.
    if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true
    if (/^fe[89ab][0-9a-f]:/.test(ip)) return true
    if (/^ff[0-9a-f]{2}:/.test(ip)) return true
    return false
  }

  const n = v4ToInt(ip)
  // Unparseable is BLOCKED, not allowed. A guard that cannot understand an
  // address has not established it is safe, and "I could not tell" must never
  // be the permissive branch.
  if (n === null) return true

  return BLOCKED_V4.some(([base, bits]) => {
    const b = v4ToInt(base)!
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    return (n & mask) >>> 0 === (b & mask) >>> 0
  })
}

/**
 * A destination that has been validated AND the address it was validated at.
 *
 * The caller must connect to `address`, not re-resolve `url`. That is what
 * closes the rebinding window — see the header.
 */
export type SafeTarget = {
  readonly url: string
  readonly hostname: string
  readonly address: string
  readonly port: number
}

export type DnsResolver = (hostname: string) => Promise<string[]>

/**
 * Validate an operator-supplied webhook URL.
 *
 * Order matters: cheap syntactic refusals first, DNS last, because resolution
 * is the only step that costs a network round trip and the only one an attacker
 * can use to make us do work.
 */
export async function assertSafeWebhookUrl(
  rawUrl: string,
  resolve: DnsResolver,
): Promise<Result<SafeTarget, DomainError>> {
  const refuse = (why: string) => err(invariant('webhook.url', why))

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return refuse('Not a valid URL.')
  }

  // https only. Not "not http" — an allowlist, so file:, gopher:, and whatever
  // the runtime adds next are refused without anyone having to think of them.
  if (url.protocol !== 'https:') {
    return refuse('Webhook URLs must be https. Plaintext delivery would put the signed payload on the wire.')
  }

  // Credentials in the URL would be sent to whatever the host resolves to, and
  // they end up in logs and in the TenantWebhook row.
  if (url.username || url.password) {
    return refuse('Webhook URLs must not contain credentials.')
  }

  // A literal IP skips DNS but must still be checked — otherwise
  // https://169.254.169.254/ walks straight past a guard that only inspects
  // resolved names.
  const bare = url.hostname.replace(/^\[|\]$/g, '')
  if (isBlockedAddress(bare) && /^[0-9a-f:.]+$/i.test(bare)) {
    return refuse(`Refusing a private, loopback or link-local address (${bare}).`)
  }

  let addresses: string[]
  try {
    addresses = await resolve(url.hostname)
  } catch {
    return refuse(`Could not resolve ${url.hostname}.`)
  }

  if (addresses.length === 0) return refuse(`${url.hostname} resolved to no addresses.`)

  // 🛑 EVERY address, not the first. A hostname that answers with one public
  // address and one private one is the standard way past a guard that checks
  // `addresses[0]` — and which address a later connect() picks is not ours to
  // choose.
  const blocked = addresses.filter(isBlockedAddress)
  if (blocked.length > 0) {
    return refuse(
      `${url.hostname} resolves to a private, loopback or link-local address (${blocked.join(', ')}).`,
    )
  }

  return ok({
    url: rawUrl,
    hostname: url.hostname,
    // The address the caller MUST connect to. Re-resolving reopens the window.
    address: addresses[0],
    port: url.port ? Number(url.port) : 443,
  })
}

// ─── Signing ─────────────────────────────────────────────────────────────────

export const SIGNATURE_HEADER = 'x-commish-signature'
export const SIGNATURE_VERSION = 'v1'
/** How far a timestamp may be from now, in either direction. */
export const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000

/**
 * `v1=<hex>` over `<timestamp>.<body>`.
 *
 * ⚠ THE TIMESTAMP IS INSIDE THE SIGNED STRING, NOT BESIDE IT. Signing only the
 * body and sending the timestamp alongside means an attacker replays the same
 * body with a fresh timestamp and the signature still verifies — the tolerance
 * window would then be decoration. Binding them together is what makes the
 * window mean anything.
 *
 * ⚠ AND THE SEPARATOR MATTERS. Without a delimiter, timestamp `1` + body `23`
 * and timestamp `12` + body `3` produce identical signed strings.
 */
export function signWebhook(secret: string, timestampMs: number, body: string): string {
  const payload = `${timestampMs}.${body}`
  return `${SIGNATURE_VERSION}=${createHmac('sha256', secret).update(payload, 'utf8').digest('hex')}`
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false
  // timingSafeEqual throws on a length mismatch rather than returning false.
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

/**
 * Verify a received signature.
 *
 * Used by an operator's own receiver; shipped here so the reference
 * implementation and the signer cannot drift, and so the tolerance rule is
 * tested rather than described in a doc page.
 */
export function verifyWebhookSignature(args: {
  secret: string
  signature: string
  timestampMs: number
  body: string
  now?: number
  toleranceMs?: number
}): Result<void, DomainError> {
  const now = args.now ?? Date.now()
  const tolerance = args.toleranceMs ?? SIGNATURE_TOLERANCE_MS
  const refuse = (why: string) => err(invariant('webhook.signature', why))

  // ⚠ ABSOLUTE DIFFERENCE — both directions. A window that only rejects OLD
  // timestamps accepts one from the year 3000, which never expires and is a
  // replay token with no shelf life.
  if (Math.abs(now - args.timestampMs) > tolerance) {
    return refuse('Timestamp outside the tolerance window.')
  }

  // Compared AFTER the window check, so a replayed-but-valid signature is
  // rejected on the window rather than on the comparison — same refusal either
  // way, but the ordering keeps the expensive branch behind the cheap one.
  if (!safeEqual(signWebhook(args.secret, args.timestampMs, args.body), args.signature)) {
    return refuse('Signature does not match.')
  }

  return ok(undefined)
}

export function newWebhookSecret(): string {
  return randomBytes(32).toString('hex')
}

// ─── Delivery policy ─────────────────────────────────────────────────────────

export const MAX_ATTEMPTS = 6
export const DISABLE_AFTER_CONSECUTIVE_FAILURES = 20
export const BASE_BACKOFF_MS = 1000
export const MAX_BACKOFF_MS = 60 * 60 * 1000

/**
 * Exponential backoff with jitter.
 *
 * ⚠ THE JITTER IS NOT DECORATION. Every webhook for a tenant fails at the same
 * moment when their endpoint goes down, so a deterministic schedule retries all
 * of them in the same millisecond — repeatedly, and harder each round. That is
 * a thundering herd aimed at an endpoint that is already unhealthy, from the
 * platform they are paying.
 *
 * `random` is injected so the test can be deterministic without the production
 * path losing the jitter.
 */
export function nextBackoffMs(attempt: number, random: () => number = Math.random): number {
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS)
  // Full jitter: uniform in [0, exponential]. Spreads a herd better than
  // "exponential ± 10%", which keeps everyone in the same narrow band.
  return Math.floor(random() * exponential)
}

export function shouldRetry(attempt: number, status: number | null): boolean {
  if (attempt >= MAX_ATTEMPTS) return false
  // A transport failure has no status and is always worth retrying.
  if (status === null) return true
  // 4xx means the receiver understood and refused — retrying sends the same
  // rejected payload five more times. 408 and 429 are the exceptions: both mean
  // "not now" rather than "not this".
  if (status === 408 || status === 429) return true
  if (status >= 400 && status < 500) return false
  return status >= 500
}

export function shouldDisable(consecutiveFailures: number): boolean {
  return consecutiveFailures >= DISABLE_AFTER_CONSECUTIVE_FAILURES
}

/**
 * The fetch options a delivery must use.
 *
 * `redirect: 'manual'` is the load-bearing one: following a redirect re-resolves
 * a NEW host that no guard has seen, so an endpoint that passes every check can
 * 302 us to 169.254.169.254 and the whole SSRF guard is bypassed by one header.
 */
export const WEBHOOK_FETCH_OPTIONS = {
  redirect: 'manual' as const,
  // A slow endpoint must not hold a worker open indefinitely.
  timeoutMs: 10_000,
} as const
