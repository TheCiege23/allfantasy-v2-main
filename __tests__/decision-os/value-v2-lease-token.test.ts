import { describe, expect, it } from 'vitest'
import {
  InvalidWorkerIdError,
  LEASE_TOKEN_MAX_LENGTH,
  LEASE_TOKEN_PATTERN,
  isLeaseToken,
  newLeaseToken,
  normalizeWorkerId,
  redactLeaseToken,
  type LeaseTokenDeps,
} from '@/lib/decision-os/value-v2/leaseToken'

/** Deterministic deps: a fixed clock and a counter-driven byte source. */
function deps(startCounter = 0, nowMs = 1_700_000_000_000): LeaseTokenDeps {
  let counter = startCounter
  return {
    now: () => nowMs,
    randomBytes: (size) => {
      const out = new Uint8Array(size)
      const n = counter++
      for (let i = 0; i < size; i += 1) out[i] = (n + i * 31) & 0xff
      return out
    },
  }
}

describe('token shape', () => {
  it('fits VARCHAR(64) with headroom', () => {
    const token = newLeaseToken('worker-a3f1')
    expect(token.length).toBeLessThanOrEqual(LEASE_TOKEN_MAX_LENGTH)
    expect(token.length).toBeLessThan(50)
  })

  it('stays inside the allowed character set', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(newLeaseToken('wkr')).toMatch(LEASE_TOKEN_PATTERN)
    }
  })

  it('carries the worker id only as a diagnostic prefix', () => {
    expect(newLeaseToken('Worker-A3F1!!').split('-')[0]).toBe('workera3')
  })

  it('accepts a maximum-length worker identifier without overflowing', () => {
    const token = newLeaseToken('a'.repeat(512))
    expect(token.split('-')[0]).toBe('a'.repeat(8))
    expect(token.length).toBeLessThanOrEqual(LEASE_TOKEN_MAX_LENGTH)
    expect(isLeaseToken(token)).toBe(true)
  })

  it('validates its own output', () => {
    expect(isLeaseToken(newLeaseToken('wkr'))).toBe(true)
    expect(isLeaseToken('')).toBe(false)
    expect(isLeaseToken('not a token')).toBe(false)
    expect(isLeaseToken('a'.repeat(65))).toBe(false)
    expect(isLeaseToken(null)).toBe(false)
  })
})

describe('illegal worker identifiers are refused, not mangled', () => {
  it.each(['', '   ', '!!!', '---', '\t\n'])('rejects %j', (workerId) => {
    expect(() => newLeaseToken(workerId)).toThrow(InvalidWorkerIdError)
  })

  it('normalizes a legal id deterministically', () => {
    expect(normalizeWorkerId('  Worker_A3-F1  ')).toBe('workera3')
    expect(normalizeWorkerId('AB')).toBe('ab')
  })
})

describe('uniqueness — a stable worker id must never be the lease identity', () => {
  it('mints a different token on every claim by the same worker', () => {
    const tokens = new Set<string>()
    for (let i = 0; i < 5_000; i += 1) tokens.add(newLeaseToken('wkr-a'))
    expect(tokens.size).toBe(5_000)
  })

  it('differs even when the clock does not move', () => {
    const d = deps(0, 1_700_000_000_000)
    const first = newLeaseToken('wkr', d)
    const second = newLeaseToken('wkr', d)
    expect(first).not.toBe(second)
  })

  it('an old token never equals a later token — the ABA guarantee', () => {
    const earlier: string[] = []
    for (let i = 0; i < 500; i += 1) {
      const token = newLeaseToken('wkr')
      expect(earlier).not.toContain(token)
      earlier.push(token)
    }
  })

  it('two workers with the same prefix still produce distinct tokens', () => {
    expect(newLeaseToken('wkr')).not.toBe(newLeaseToken('wkr'))
  })
})

describe('deterministic injection', () => {
  it('is reproducible given the same clock and bytes', () => {
    expect(newLeaseToken('wkr', deps(7, 1_234_567_890_123)))
      .toBe(newLeaseToken('wkr', deps(7, 1_234_567_890_123)))
  })

  it('changes when the injected randomness changes', () => {
    expect(newLeaseToken('wkr', deps(1))).not.toBe(newLeaseToken('wkr', deps(2)))
  })

  it('changes when the injected clock changes', () => {
    expect(newLeaseToken('wkr', deps(5, 1_000))).not.toBe(newLeaseToken('wkr', deps(5, 2_000)))
  })

  it('refuses a randomness source that returns the wrong size', () => {
    const short: LeaseTokenDeps = { now: () => 0, randomBytes: () => new Uint8Array(4) }
    expect(() => newLeaseToken('wkr', short)).toThrow(/random bytes/)
  })
})

/**
 * The secret is everything after the SECOND `-`, not `split('-')[2]`.
 *
 * ⚠ The random segment is base64url, whose alphabet INCLUDES `-` — the same character
 * that separates the token's three parts (`leaseToken.ts` maps `+` to `-`). So
 * `split('-')[2]` is only the secret up to its first inner `-`, sometimes a single
 * character, and the 4-character redacted tail contains that fragment by chance. With
 * real randomness the old check was a coin toss; it failed CI on PR #754 as
 * `expected 'wkra-…JmzA' not to contain 'A'`.
 */
function secretOf(token: string): string {
  return token.split('-').slice(2).join('-')
}

/** 16 bytes whose base64url is `A-BCDEFGHIJKLMNOPQRAAA`: a `-` at index 1, an `A` in the tail. */
const DASH_IN_SECRET: LeaseTokenDeps = {
  now: () => 1_700_000_000_000,
  randomBytes: () => new Uint8Array([3, 224, 66, 12, 65, 70, 28, 130, 74, 44, 195, 78, 61, 4, 64, 0]),
}

describe('redaction', () => {
  it('never returns the full token', () => {
    const token = newLeaseToken('wkr-a')
    const redacted = redactLeaseToken(token)
    expect(redacted).not.toBe(token)
    expect(secretOf(token)).toHaveLength(22)
    expect(redacted).not.toContain(secretOf(token))
    expect(redacted.startsWith('wkra-')).toBe(true)
  })

  it('reveals only a 4-character tail even when the secret contains the separator', () => {
    const token = newLeaseToken('wkr-a', DASH_IN_SECRET)
    const redacted = redactLeaseToken(token)
    expect(isLeaseToken(token)).toBe(true)
    // Premise: this is exactly the input that fooled the old `split('-')[2]` check.
    expect(token.split('-')[2]).toBe('A')
    expect(redacted).toContain(token.split('-')[2])
    expect(secretOf(token)).toBe('A-BCDEFGHIJKLMNOPQRAAA')
    expect(redacted).not.toContain(secretOf(token))
    expect(redacted).toBe('wkra-…RAAA')
  })

  it('handles malformed input without throwing', () => {
    expect(redactLeaseToken('')).toBe('<invalid>')
    expect(redactLeaseToken(undefined as unknown as string)).toBe('<invalid>')
  })
})
