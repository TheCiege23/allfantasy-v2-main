/**
 * Commissioner OS · T-111 acceptance.
 *
 * "A test proving two keys can coexist (catches the prefix-uniqueness bug),
 * that an expired key is rejected, and that plaintext is unrecoverable after
 * creation."
 */

import { describe, it, expect } from 'vitest'
import {
  KEY_PREFIX_TAG,
  LAST_USED_THROTTLE_MS,
  MIN_PREFIX_LENGTH,
  type StoredApiKey,
  displayApiKey,
  generateApiKey,
  hashApiKey,
  prefixOf,
  safeDigestEqual,
  shouldTouchLastUsed,
  shouldTouchLastUsed as touch,
  verifyApiKey,
} from '@/lib/domain/apiKeys'

const NOW = new Date('2026-08-31T12:00:00.000Z')

function stored(over: Partial<StoredApiKey> = {}): StoredApiKey {
  const key = generateApiKey('live')
  return {
    tenantId: 't1',
    keyId: 'k1',
    hash: key.hash,
    scopes: ['leagues:read'],
    ...over,
  }
}

describe('T-111 · 🛑 two keys can coexist', () => {
  it('generates distinct prefixes', () => {
    // THE bug this criterion exists for. `prefix` is @unique, and the obvious
    // implementation — "the first 8 characters" — is the literal string
    // "cos_live" for every live key, so the constraint permits exactly ONE key
    // in the entire system and the second issuance fails.
    const a = generateApiKey('live')
    const b = generateApiKey('live')
    expect(a.prefix).not.toBe(b.prefix)
  })

  it('stays distinct across many keys', () => {
    // One pair passing could be luck. A thousand could not.
    const prefixes = new Set(Array.from({ length: 1000 }, () => generateApiKey('live').prefix))
    expect(prefixes.size).toBe(1000)
  })

  it('the prefix is NOT just the environment tag', () => {
    // The precise shape of the bug, asserted directly rather than inferred from
    // uniqueness — so a future implementation that is unique for some other
    // reason still has to keep this property.
    const key = generateApiKey('live')
    expect(key.prefix).not.toBe('cos_live')
    expect(key.prefix).not.toBe(KEY_PREFIX_TAG.live)
    expect(key.prefix.length).toBeGreaterThanOrEqual(MIN_PREFIX_LENGTH)
  })

  it('carries the environment so a test key is visibly a test key', () => {
    expect(generateApiKey('live').prefix.startsWith('cos_live_')).toBe(true)
    expect(generateApiKey('test').prefix.startsWith('cos_test_')).toBe(true)
  })

  it('the prefix is a strict prefix of the plaintext', () => {
    // The lookup only works if the presented key yields the stored prefix.
    const key = generateApiKey('live')
    expect(key.plaintext.startsWith(key.prefix)).toBe(true)
    expect(prefixOf(key.plaintext)).toBe(key.prefix)
  })

  it.each(['', 'nonsense', 'cos_live', 'cos_live_abc'])('prefixOf rejects %j', (bad) => {
    expect(prefixOf(bad)).toBeNull()
  })
})

describe('T-111 · 🛑 plaintext is unrecoverable after creation', () => {
  it('the secret half appears nowhere in the stored record', () => {
    const key = generateApiKey('live')
    const secret = key.plaintext.slice(key.prefix.length + 1)

    const record = { prefix: key.prefix, hash: key.hash, label: 'CI', scopes: [] }
    expect(JSON.stringify(record)).not.toContain(secret)
  })

  it('⚠ the PREFIX is recoverable, and that is by design', () => {
    // Stated precisely, because "plaintext is unrecoverable" is not quite true
    // and the imprecision matters: the prefix IS stored, IS shown in the UI and
    // IS safe in a log. It is a lookup key. Only the secret half is gone.
    const key = generateApiKey('live')
    expect(key.plaintext).toContain(key.prefix)
  })

  it('the hash does not reveal the key', () => {
    const key = generateApiKey('live')
    expect(key.hash).not.toContain(key.plaintext)
    expect(key.hash).toHaveLength(64)
    expect(key.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hashing is deterministic, so verification can work at all', () => {
    const key = generateApiKey('live')
    expect(hashApiKey(key.plaintext)).toBe(key.hash)
  })

  it('a one-character change gives a completely different hash', () => {
    const key = generateApiKey('live')
    const tampered = key.plaintext.slice(0, -1) + (key.plaintext.endsWith('a') ? 'b' : 'a')
    expect(hashApiKey(tampered)).not.toBe(key.hash)
  })

  it('the display form shows no secret', () => {
    const key = generateApiKey('live')
    const shown = displayApiKey({ prefix: key.prefix, label: 'CI key' })
    expect(shown).toContain(key.prefix)
    expect(shown).not.toContain(key.plaintext.slice(key.prefix.length + 1))
  })
})

describe('T-111 · verification', () => {
  it('accepts the right key', () => {
    const key = generateApiKey('live')
    const r = verifyApiKey(key.plaintext, stored({ hash: key.hash }), NOW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toMatchObject({ tenantId: 't1', keyId: 'k1', scopes: ['leagues:read'] })
  })

  it('rejects a wrong key', () => {
    const key = generateApiKey('live')
    const other = generateApiKey('live')
    expect(verifyApiKey(other.plaintext, stored({ hash: key.hash }), NOW).ok).toBe(false)
  })

  it('rejects an unknown prefix (no stored row)', () => {
    expect(verifyApiKey(generateApiKey('live').plaintext, null, NOW).ok).toBe(false)
  })

  it('🛑 rejects an EXPIRED key', () => {
    const key = generateApiKey('live')
    const r = verifyApiKey(
      key.plaintext,
      stored({ hash: key.hash, expiresAt: new Date(NOW.getTime() - 1) }),
      NOW,
    )
    expect(r.ok).toBe(false)
  })

  it('rejects a key expiring exactly now', () => {
    // `<=`, not `<`. A key that expires at 12:00:00.000 is not valid at
    // 12:00:00.000 — off-by-one on an expiry is a key that outlives its own
    // deadline by however long the tick is.
    const key = generateApiKey('live')
    expect(verifyApiKey(key.plaintext, stored({ hash: key.hash, expiresAt: NOW }), NOW).ok).toBe(
      false,
    )
  })

  it('accepts a key expiring in the future', () => {
    const key = generateApiKey('live')
    const r = verifyApiKey(
      key.plaintext,
      stored({ hash: key.hash, expiresAt: new Date(NOW.getTime() + 1000) }),
      NOW,
    )
    expect(r.ok).toBe(true)
  })

  it('accepts a key with no expiry', () => {
    const key = generateApiKey('live')
    expect(verifyApiKey(key.plaintext, stored({ hash: key.hash, expiresAt: null }), NOW).ok).toBe(
      true,
    )
  })

  it('rejects a REVOKED key even when the hash matches and it has not expired', () => {
    // Checked here as well as in the SQL bootstrap function. The two cannot
    // drift — both read the same two columns — and the failure directions are
    // asymmetric: redundant-and-cheap against catastrophic-and-silent.
    const key = generateApiKey('live')
    const r = verifyApiKey(key.plaintext, stored({ hash: key.hash, revokedAt: NOW }), NOW)
    expect(r.ok).toBe(false)
  })

  it('gives the SAME refusal for every failure', () => {
    // Distinguishing "unknown key" from "revoked key" tells an attacker which
    // of their guesses was once real.
    const key = generateApiKey('live')
    const messages = [
      verifyApiKey(key.plaintext, null, NOW),
      verifyApiKey(key.plaintext, stored({ hash: key.hash, revokedAt: NOW }), NOW),
      verifyApiKey(key.plaintext, stored({ hash: key.hash, expiresAt: new Date(0) }), NOW),
      verifyApiKey('cos_live_aaaaaaaa_x', stored(), NOW),
    ].map((r) => (r.ok ? 'ok' : JSON.stringify(r.error)))

    expect(new Set(messages).size, `refusals differ: ${messages.join(' | ')}`).toBe(1)
  })
})

describe('T-111 · constant-time comparison', () => {
  it('matches equal digests', () => {
    expect(safeDigestEqual('a'.repeat(64), 'a'.repeat(64))).toBe(true)
  })

  it('rejects different digests of equal length', () => {
    expect(safeDigestEqual('a'.repeat(64), 'b'.repeat(64))).toBe(false)
  })

  it('🛑 returns false rather than THROWING on a length mismatch', () => {
    // node's timingSafeEqual throws on unequal lengths — it does not return
    // false. Passing a truncated stored hash straight in turns a bad row into a
    // 500 instead of a rejection.
    expect(() => safeDigestEqual('abc', 'a'.repeat(64))).not.toThrow()
    expect(safeDigestEqual('abc', 'a'.repeat(64))).toBe(false)
  })

  it('rejects empty input', () => {
    expect(safeDigestEqual('', '')).toBe(false)
  })

  it('survives a malformed stored hash without throwing', () => {
    const key = generateApiKey('live')
    expect(() => verifyApiKey(key.plaintext, stored({ hash: 'truncated' }), NOW)).not.toThrow()
    expect(verifyApiKey(key.plaintext, stored({ hash: 'truncated' }), NOW).ok).toBe(false)
  })
})

describe('T-111 · lastUsedAt is throttled', () => {
  it('touches a key that has never been used', () => {
    expect(touch(null, NOW)).toBe(true)
    expect(touch(undefined, NOW)).toBe(true)
  })

  it('does NOT touch again within the window', () => {
    // Without the throttle every authenticated request becomes a row update,
    // taking a lock on the key every busy client is authenticating with — so
    // the tenant's own traffic serialises on it.
    expect(touch(new Date(NOW.getTime() - 60_000), NOW)).toBe(false)
  })

  it('touches once the window has passed', () => {
    expect(touch(new Date(NOW.getTime() - LAST_USED_THROTTLE_MS), NOW)).toBe(true)
    expect(touch(new Date(NOW.getTime() - LAST_USED_THROTTLE_MS - 1), NOW)).toBe(true)
  })

  it('the window is an hour, as tenancy.prisma specifies', () => {
    expect(LAST_USED_THROTTLE_MS).toBe(60 * 60 * 1000)
    expect(shouldTouchLastUsed(new Date(NOW.getTime() - 59 * 60_000), NOW)).toBe(false)
  })
})

describe('T-111 · the SQL bootstrap function agrees with this module', () => {
  it('resolve_api_key filters on the same two columns', async () => {
    // The function is the primary filter and this module is the second check.
    // They must at least be looking at the same fields — a function that
    // filtered on, say, only revokedAt would silently hand expired keys to a
    // verifier that happened to have its own expiry check removed later.
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const sql = readFileSync(
      path.resolve(
        process.cwd(),
        'prisma/migrations-pending/20260831160000_commissioner_os_t102_rls/migration.sql',
      ),
      'utf8',
    )
    const fn = sql.slice(sql.indexOf('FUNCTION app.resolve_api_key'))
    const body = fn.slice(0, fn.indexOf('$$;') + 3)
    expect(body).toContain('"revokedAt" IS NULL')
    expect(body).toContain('"expiresAt"')
    expect(body).toContain('prefix = p_prefix')
  })
})
