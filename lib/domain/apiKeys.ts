/**
 * Commissioner OS · API key issuance and verification. T-111.
 *
 * ─── SHA-256, NOT bcrypt/argon2 — AND THIS IS NOT THE USUAL ADVICE ───────────
 * `CLAUDE.md` lists "password-hashing an API key" as an anti-pattern, and the
 * reasoning is worth keeping next to the code because a reviewer's instinct
 * will say otherwise:
 *
 *   A slow KDF exists to make GUESSING expensive, and guessing is only a threat
 *   when the secret has low entropy — i.e. when a human chose it. An API key is
 *   256 bits from a CSPRNG. There is nothing to guess, so the KDF buys nothing,
 *   while costing ~100ms on EVERY API call, opening a CPU-exhaustion vector
 *   (unauthenticated requests each burning 100ms of CPU), and — with bcrypt —
 *   silently truncating at 72 bytes.
 *
 * ─── THE PREFIX IS THE PART THAT GOES WRONG ──────────────────────────────────
 * `TenantApiKey.prefix` is `@unique`. The obvious implementation — "store the
 * first 8 characters" — makes every live key's prefix the literal string
 * `cos_live`, so the unique constraint permits EXACTLY ONE KEY in the entire
 * system and the second issuance fails with a constraint violation nobody
 * expects. tenancy.prisma calls this out by name; T-111's acceptance is a test
 * that two keys can coexist, which is that bug and no other.
 *
 * So the prefix carries its own random segment: `cos_live_` + 8 hex = 17 chars.
 * It is a LOOKUP KEY, not a secret — it is stored in full, shown in the UI, and
 * safe in a log.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { type DomainError, forbidden } from './errors'
import { type Result, err, ok } from './result'

export type ApiKeyEnvironment = 'live' | 'test'

/** `cos_live_` / `cos_test_`. */
export const KEY_PREFIX_TAG: Record<ApiKeyEnvironment, string> = {
  live: 'cos_live_',
  test: 'cos_test_',
}

/** Hex characters of randomness in the prefix's own segment. */
export const PREFIX_RANDOM_HEX = 8
/** Bytes of secret. 32 bytes = 256 bits — nothing to guess. */
export const SECRET_BYTES = 32
/** tenancy.prisma: "~17 chars". `cos_live_` (9) + 8 = 17. */
export const MIN_PREFIX_LENGTH = 17

export type GeneratedApiKey = {
  /** Shown EXACTLY ONCE, at creation. Never stored, never logged. */
  readonly plaintext: string
  /** Stored, indexed, unique, safe to display. */
  readonly prefix: string
  /** SHA-256 of the full plaintext, hex. */
  readonly hash: string
}

export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex')
}

/**
 * Mint a key.
 *
 * ⚠ THE RETURNED `plaintext` IS THE ONLY COPY THAT WILL EVER EXIST. Nothing
 * here writes it anywhere, and `hashApiKey` is one-way — so a caller that
 * discards it has destroyed the key, not misplaced it.
 */
export function generateApiKey(
  environment: ApiKeyEnvironment = 'live',
  randomHex: (bytes: number) => string = (n) => randomBytes(n).toString('hex'),
): GeneratedApiKey {
  const tag = KEY_PREFIX_TAG[environment]
  // The prefix's OWN randomness. This is what makes prefixes unique, and it is
  // the whole fix for the constraint bug described above.
  const prefix = `${tag}${randomHex(PREFIX_RANDOM_HEX / 2)}`
  const secret = randomHex(SECRET_BYTES)
  const plaintext = `${prefix}_${secret}`
  return { plaintext, prefix, hash: hashApiKey(plaintext) }
}

/** Pull the prefix out of a presented key, for the bootstrap lookup. */
export function prefixOf(plaintext: string): string | null {
  const parts = plaintext.split('_')
  // cos, live, <prefixRandom>, <secret>
  if (parts.length < 4) return null
  const prefix = parts.slice(0, 3).join('_')
  return prefix.length >= MIN_PREFIX_LENGTH ? prefix : null
}

// ─── Verification ────────────────────────────────────────────────────────────

/** What `app.resolve_api_key(prefix)` returns. */
export type StoredApiKey = {
  readonly tenantId: string
  readonly keyId: string
  readonly hash: string
  readonly scopes: readonly string[]
  readonly revokedAt?: Date | null
  readonly expiresAt?: Date | null
  readonly lastUsedAt?: Date | null
}

export type VerifiedApiKey = {
  readonly tenantId: string
  readonly keyId: string
  readonly scopes: readonly string[]
}

/**
 * Constant-time comparison of two hex digests.
 *
 * ⚠ `timingSafeEqual` THROWS ON LENGTH MISMATCH — it does not return false.
 * Passing a truncated or malformed stored hash straight in turns a bad row into
 * a 500 instead of a rejection, and the length check has to come first. The
 * length check itself is not timing-safe, and does not need to be: digest
 * length is not secret.
 */
export function safeDigestEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

/**
 * Verify a presented key against the stored record.
 *
 * ⚠ REVOCATION AND EXPIRY ARE CHECKED HERE **AND** IN THE SQL FUNCTION, WHICH
 * IS A DELIBERATE SECOND SOURCE OF TRUTH — the one place in this codebase where
 * that is the right call.
 *
 * T-106 argues against duplicate enforcement, and that argument holds when the
 * two can DISAGREE about something ongoing. Here they cannot drift: both read
 * the same two columns, and the failure directions are asymmetric. If the SQL
 * filter is right, this is redundant and costs a comparison. If it is ever
 * loosened — a rewritten bootstrap function, a caller that resolved the row
 * some other way — this is the only thing between a revoked key and a valid
 * session. Redundant-and-cheap against catastrophic-and-silent.
 */
export function verifyApiKey(
  presented: string,
  stored: StoredApiKey | null,
  now: Date = new Date(),
): Result<VerifiedApiKey, DomainError> {
  // One refusal for every failure, deliberately identical. Distinguishing
  // "unknown key" from "revoked key" tells an attacker which of their guesses
  // was once real.
  const refuse = () => err(forbidden('api.authenticate', 'Invalid API key.'))

  if (!stored) return refuse()
  if (stored.revokedAt) return refuse()
  if (stored.expiresAt && stored.expiresAt.getTime() <= now.getTime()) return refuse()
  if (!safeDigestEqual(hashApiKey(presented), stored.hash)) return refuse()

  return ok({ tenantId: stored.tenantId, keyId: stored.keyId, scopes: stored.scopes })
}

// ─── lastUsedAt, throttled ───────────────────────────────────────────────────

/** tenancy.prisma: "throttle writes to hourly; don't write per request". */
export const LAST_USED_THROTTLE_MS = 60 * 60 * 1000

/**
 * Should this request update `lastUsedAt`?
 *
 * ⚠ WITHOUT THE THROTTLE, EVERY AUTHENTICATED REQUEST BECOMES A WRITE. That
 * turns a read-only API call into a row update — taking a row lock on the key
 * every busy client is authenticating with, so the tenant's own traffic
 * serialises on it. The column exists to answer "is this key still in use",
 * which an hour's granularity answers just as well.
 */
export function shouldTouchLastUsed(
  lastUsedAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastUsedAt) return true
  return now.getTime() - lastUsedAt.getTime() >= LAST_USED_THROTTLE_MS
}

// ─── Display ─────────────────────────────────────────────────────────────────

/**
 * What the UI shows for an existing key.
 *
 * The prefix in full — it is a lookup key, not a secret — and nothing else. No
 * masked plaintext, because there is no plaintext to mask: a "sk_live_••••1234"
 * style display implies the last four are recoverable, and here they are not.
 */
export function displayApiKey(key: { prefix: string; label: string }): string {
  return `${key.label} (${key.prefix}…)`
}
