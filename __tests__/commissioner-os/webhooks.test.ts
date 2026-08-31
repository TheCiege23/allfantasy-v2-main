/**
 * Commissioner OS · T-113 acceptance.
 *
 * "Tests reject `localhost`, `10.0.0.0/8`, and `169.254.169.254`, including via
 * a hostname that resolves to them (rebinding). A replayed signature outside
 * the tolerance window is rejected."
 */

import { describe, it, expect } from 'vitest'
import {
  DISABLE_AFTER_CONSECUTIVE_FAILURES,
  MAX_ATTEMPTS,
  SIGNATURE_TOLERANCE_MS,
  WEBHOOK_FETCH_OPTIONS,
  assertSafeWebhookUrl,
  isBlockedAddress,
  newWebhookSecret,
  nextBackoffMs,
  shouldDisable,
  shouldRetry,
  signWebhook,
  verifyWebhookSignature,
} from '@/lib/domain/webhooks'

/** A resolver that answers whatever the test says, so rebinding is expressible. */
const resolving = (map: Record<string, string[]>) => async (host: string) => {
  if (!(host in map)) throw new Error(`no such host: ${host}`)
  return map[host]
}

const PUBLIC = ['93.184.216.34']

describe('T-113 · address classification', () => {
  it.each([
    ['loopback v4', '127.0.0.1'],
    ['loopback, whole /8', '127.99.1.2'],
    ['🛑 10.0.0.0/8', '10.0.0.1'],
    ['10/8 upper', '10.255.255.254'],
    ['172.16/12', '172.16.5.4'],
    ['192.168/16', '192.168.1.1'],
    ['🛑 cloud metadata', '169.254.169.254'],
    ['link-local generally', '169.254.1.1'],
    ['CGNAT', '100.64.0.1'],
    ['unspecified', '0.0.0.0'],
    ['multicast', '224.0.0.1'],
    ['reserved', '240.0.0.1'],
    ['loopback v6', '::1'],
    ['unspecified v6', '::'],
    ['unique-local v6', 'fd00::1'],
    ['link-local v6', 'fe80::1'],
    ['multicast v6', 'ff02::1'],
  ])('blocks %s', (_label, ip) => {
    expect(isBlockedAddress(ip)).toBe(true)
  })

  it.each(['93.184.216.34', '8.8.8.8', '2606:2800:220:1:248:1893:25c8:1946'])(
    'allows public %s',
    (ip) => {
      // Without these the blocker could be "return true" and every test above
      // would pass while the feature was unusable.
      expect(isBlockedAddress(ip)).toBe(false)
    },
  )

  it('🛑 unwraps IPv4-mapped IPv6', () => {
    // The most common bypass for a guard written IPv4-first with IPv6 bolted
    // on: ::ffff:10.0.0.1 IS 10.0.0.1, in a notation the v6 branch does not
    // pattern-match.
    expect(isBlockedAddress('::ffff:10.0.0.1')).toBe(true)
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true)
  })

  it('blocks anything it cannot parse', () => {
    // "I could not tell" must never be the permissive branch — a guard that
    // does not understand an address has not established it is safe.
    for (const junk of ['', '   ', 'not-an-ip', '1.2.3', '999.1.1.1', '1.2.3.4.5']) {
      expect(isBlockedAddress(junk), junk).toBe(true)
    }
  })
})

describe('T-113 · the URL guard', () => {
  it('accepts a public https endpoint (positive control)', async () => {
    // Without this, every rejection below could be "the guard refuses
    // everything" and the tests would pass on a webhook feature that cannot
    // deliver at all.
    const r = await assertSafeWebhookUrl(
      'https://hooks.dynastyco.com/commish',
      resolving({ 'hooks.dynastyco.com': PUBLIC }),
    )
    expect(r.ok).toBe(true)
  })

  it('rejects http', async () => {
    const r = await assertSafeWebhookUrl('http://hooks.dynastyco.com/x', resolving({ 'hooks.dynastyco.com': PUBLIC }))
    expect(r.ok).toBe(false)
  })

  it.each(['file:///etc/passwd', 'gopher://x/', 'ftp://x/'])('rejects %s', async (u) => {
    // An allowlist, not a denylist — whatever scheme the runtime adds next is
    // refused without anyone having to think of it.
    expect((await assertSafeWebhookUrl(u, resolving({}))).ok).toBe(false)
  })

  it('rejects credentials in the URL', async () => {
    // They would be sent to whatever the host resolves to, and they land in
    // logs and in the TenantWebhook row.
    const r = await assertSafeWebhookUrl(
      'https://user:pass@hooks.dynastyco.com/x',
      resolving({ 'hooks.dynastyco.com': PUBLIC }),
    )
    expect(r.ok).toBe(false)
  })

  it('rejects a literal blocked IP without needing DNS', async () => {
    // https://169.254.169.254/ walks past a guard that only inspects resolved
    // names, because there is nothing to resolve.
    for (const host of ['169.254.169.254', '127.0.0.1', '10.0.0.1']) {
      const r = await assertSafeWebhookUrl(`https://${host}/hook`, resolving({}))
      expect(r.ok, host).toBe(false)
    }
  })

  it('rejects a host that does not resolve', async () => {
    expect((await assertSafeWebhookUrl('https://nope.invalid/x', resolving({}))).ok).toBe(false)
  })

  it('rejects a host that resolves to nothing', async () => {
    const r = await assertSafeWebhookUrl('https://empty.example/x', resolving({ 'empty.example': [] }))
    expect(r.ok).toBe(false)
  })
})

describe('T-113 · 🛑 rebinding — a hostname that RESOLVES to a blocked address', () => {
  it.each([
    ['localhost', ['127.0.0.1']],
    ['10.0.0.0/8', ['10.0.0.7']],
    ['cloud metadata', ['169.254.169.254']],
    ['IPv6 loopback', ['::1']],
    ['IPv4-mapped', ['::ffff:169.254.169.254']],
  ])('rejects a public-looking host resolving to %s', async (_label, answers) => {
    // The named acceptance criterion. The hostname is unremarkable; only the
    // answer is hostile, which is the whole point — a name-based denylist
    // catches none of these.
    const r = await assertSafeWebhookUrl(
      'https://totally-normal.example/hook',
      resolving({ 'totally-normal.example': answers }),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('INVARIANT')
  })

  it('🛑 rejects when only ONE of several answers is blocked', async () => {
    // A host answering with one public and one private address is the standard
    // way past a guard that checks `addresses[0]`. Which address a later
    // connect() picks is not ours to choose, so any blocked answer refuses the
    // whole endpoint.
    const r = await assertSafeWebhookUrl(
      'https://mixed.example/hook',
      resolving({ 'mixed.example': ['93.184.216.34', '169.254.169.254'] }),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.detail).toContain('169.254.169.254')
  })

  it('🛑 returns the ADDRESS it validated, so the caller need not re-resolve', () => {
    // The test that a check-then-fetch implementation fails.
    //
    // "Reject after DNS resolution" is not satisfied by resolving, checking,
    // and then calling fetch(url): those are two separate lookups and nothing
    // makes them agree. Between them the attacker's DNS answers differently —
    // that IS rebinding. The guard therefore hands back the address it
    // approved, and the caller must connect to that.
    return assertSafeWebhookUrl(
      'https://hooks.dynastyco.com/commish',
      resolving({ 'hooks.dynastyco.com': PUBLIC }),
    ).then((r) => {
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.value.address).toBe('93.184.216.34')
      expect(r.value.hostname).toBe('hooks.dynastyco.com')
      expect(r.value.port).toBe(443)
    })
  })

  it('🛑 delivery must not follow redirects', () => {
    // Following one re-resolves a NEW host that no guard has seen, so an
    // endpoint that passes every check above can 302 us to 169.254.169.254 and
    // the entire SSRF guard is bypassed by one response header.
    expect(WEBHOOK_FETCH_OPTIONS.redirect).toBe('manual')
    expect(WEBHOOK_FETCH_OPTIONS.timeoutMs).toBeGreaterThan(0)
  })
})

describe('T-113 · signing', () => {
  const secret = 'sekrit'
  const body = '{"type":"draft.completed"}'
  const now = 1_756_000_000_000

  it('is deterministic and hex', () => {
    expect(signWebhook(secret, now, body)).toBe(signWebhook(secret, now, body))
    expect(signWebhook(secret, now, body)).toMatch(/^v1=[0-9a-f]{64}$/)
  })

  it('changes with the body', () => {
    expect(signWebhook(secret, now, body)).not.toBe(signWebhook(secret, now, body + ' '))
  })

  it('changes with the timestamp', () => {
    expect(signWebhook(secret, now, body)).not.toBe(signWebhook(secret, now + 1, body))
  })

  it('changes with the secret', () => {
    expect(signWebhook(secret, now, body)).not.toBe(signWebhook('other', now, body))
  })

  it('🛑 the delimiter prevents a boundary collision', () => {
    // Without a separator, timestamp 1 + body "23" and timestamp 12 + body "3"
    // sign the same bytes — two different messages, one signature.
    expect(signWebhook(secret, 1, '23')).not.toBe(signWebhook(secret, 12, '3'))
  })

  it('secrets are long and random', () => {
    const a = newWebhookSecret()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(newWebhookSecret())
  })
})

describe('T-113 · 🛑 a replayed signature outside the window is rejected', () => {
  const secret = 'sekrit'
  const body = '{"type":"draft.completed"}'
  const now = 1_756_000_000_000

  const verify = (timestampMs: number, at: number) =>
    verifyWebhookSignature({
      secret,
      signature: signWebhook(secret, timestampMs, body),
      timestampMs,
      body,
      now: at,
    })

  it('accepts a fresh one (positive control)', () => {
    expect(verify(now, now).ok).toBe(true)
  })

  it('accepts one at the edge of the window', () => {
    expect(verify(now - SIGNATURE_TOLERANCE_MS, now).ok).toBe(true)
  })

  it('🛑 rejects a REPLAY just past the window', () => {
    // The signature is perfectly valid — it is the same one we issued. Only the
    // clock has moved. That is exactly what a replay is.
    const r = verify(now - SIGNATURE_TOLERANCE_MS - 1, now)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.detail).toContain('tolerance')
  })

  it('🛑 rejects a FUTURE timestamp too', () => {
    // A window that only rejects old timestamps accepts one from the year 3000,
    // which never expires — a replay token with no shelf life.
    expect(verify(now + SIGNATURE_TOLERANCE_MS + 1, now).ok).toBe(false)
    expect(verify(now + 10 ** 12, now).ok).toBe(false)
  })

  it('rejects a tampered body even inside the window', () => {
    const r = verifyWebhookSignature({
      secret,
      signature: signWebhook(secret, now, body),
      timestampMs: now,
      body: body.replace('draft', 'trade'),
      now,
    })
    expect(r.ok).toBe(false)
  })

  it('rejects a signature reused with a DIFFERENT timestamp', () => {
    // The timestamp is inside the signed string, so moving it invalidates the
    // signature. If it were merely sent alongside, this would verify.
    const r = verifyWebhookSignature({
      secret,
      signature: signWebhook(secret, now, body),
      timestampMs: now + 1000,
      body,
      now,
    })
    expect(r.ok).toBe(false)
  })

  it('rejects a wrong secret', () => {
    const r = verifyWebhookSignature({
      secret: 'wrong',
      signature: signWebhook(secret, now, body),
      timestampMs: now,
      body,
      now,
    })
    expect(r.ok).toBe(false)
  })

  it('does not throw on a malformed signature', () => {
    // timingSafeEqual throws on a length mismatch rather than returning false.
    expect(() =>
      verifyWebhookSignature({ secret, signature: 'v1=short', timestampMs: now, body, now }),
    ).not.toThrow()
  })
})

describe('T-113 · retry and disable policy', () => {
  it('retries a transport failure', () => {
    expect(shouldRetry(1, null)).toBe(true)
  })

  it('retries 5xx', () => {
    expect(shouldRetry(1, 500)).toBe(true)
    expect(shouldRetry(1, 503)).toBe(true)
  })

  it('does NOT retry an ordinary 4xx', () => {
    // The receiver understood and refused. Retrying sends the same rejected
    // payload five more times.
    for (const s of [400, 401, 403, 404, 422]) expect(shouldRetry(1, s), String(s)).toBe(false)
  })

  it('DOES retry 408 and 429', () => {
    // "Not now" rather than "not this" — the two 4xx codes that are about
    // timing, and 429 is the one an overloaded operator endpoint returns.
    expect(shouldRetry(1, 408)).toBe(true)
    expect(shouldRetry(1, 429)).toBe(true)
  })

  it('stops at the attempt ceiling', () => {
    expect(shouldRetry(MAX_ATTEMPTS, 500)).toBe(false)
    expect(shouldRetry(MAX_ATTEMPTS - 1, 500)).toBe(true)
  })

  it('backs off exponentially and caps', () => {
    const noJitter = () => 1
    expect(nextBackoffMs(1, noJitter)).toBe(1000)
    expect(nextBackoffMs(2, noJitter)).toBe(2000)
    expect(nextBackoffMs(3, noJitter)).toBe(4000)
    expect(nextBackoffMs(40, noJitter)).toBe(60 * 60 * 1000)
  })

  it('🛑 applies jitter, not a fixed schedule', () => {
    // Every webhook for a tenant fails at the same moment when their endpoint
    // goes down. A deterministic schedule retries all of them in the same
    // millisecond, repeatedly and harder each round — a thundering herd aimed
    // at an endpoint that is already unhealthy, from the platform they pay.
    expect(nextBackoffMs(5, () => 0)).toBe(0)
    expect(nextBackoffMs(5, () => 0.5)).toBe(8000)
    expect(nextBackoffMs(5, () => 1)).toBe(16000)
  })

  it('never returns a negative delay', () => {
    for (const attempt of [0, -1, 1]) expect(nextBackoffMs(attempt, () => 0)).toBeGreaterThanOrEqual(0)
  })

  it('disables at the failure threshold', () => {
    expect(shouldDisable(DISABLE_AFTER_CONSECUTIVE_FAILURES - 1)).toBe(false)
    expect(shouldDisable(DISABLE_AFTER_CONSECUTIVE_FAILURES)).toBe(true)
  })
})
