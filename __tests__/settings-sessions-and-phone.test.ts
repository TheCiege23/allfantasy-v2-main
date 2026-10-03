// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Settings › Security, 2026-10-03: "Sign out everywhere" and "Remove phone".
 *
 * Sign out everywhere rides lib/auth/sessionRevocation, which FAILS OPEN — so the one thing these
 * tests pin hardest is that an unrecorded revocation is reported as a failure, never as done.
 */

// ── revokeAllSessionsForUser now reports whether it was recorded ─────────────────────────────

const ENV = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'] as const
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('revokeAllSessionsForUser', () => {
  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://upstash.test'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-upstash-token-not-real'
  })

  it('true only when Redis answered OK', async () => {
    const { revokeAllSessionsForUser } = await vi.importActual<typeof import('@/lib/auth/sessionRevocation')>('@/lib/auth/sessionRevocation')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: 'OK' }))))
    expect(await revokeAllSessionsForUser('u-1')).toBe(true)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    expect(await revokeAllSessionsForUser('u-1')).toBe(false)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    expect(await revokeAllSessionsForUser('u-1')).toBe(false)
  })

  it('false when Redis is not configured at all (local dev)', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL
    const { revokeAllSessionsForUser } = await vi.importActual<typeof import('@/lib/auth/sessionRevocation')>('@/lib/auth/sessionRevocation')
    expect(await revokeAllSessionsForUser('u-1')).toBe(false)
  })
})

// ── withdrawSmsConsent ───────────────────────────────────────────────────────────────────────

import { hasSmsConsent, withdrawSmsConsent } from '@/lib/sms/smsConsent'

describe('withdrawSmsConsent', () => {
  const NOW = new Date('2026-10-03T12:00:00Z')
  const prefs = { smsConsent: { consentedAt: '2026-01-01T00:00:00Z', phone: '+15555550100' }, quietHours: { enabled: true } }

  it('marks a live consent withdrawn and keeps every other preference', () => {
    const out = withdrawSmsConsent(prefs, 'phone_removed', NOW)
    expect(out.quietHours).toEqual({ enabled: true })
    expect(out.smsConsent).toEqual({ ...prefs.smsConsent, revokedAt: NOW.toISOString(), revokedReason: 'phone_removed' })
    // The same number re-added later is NOT covered by the old opt-in.
    expect(hasSmsConsent(prefs, '+15555550100')).toBe(true)
    expect(hasSmsConsent(out, '+15555550100')).toBe(false)
  })

  it('leaves an already-withdrawn or absent record alone', () => {
    const withdrawn = { smsConsent: { consentedAt: 'a', revokedAt: '2025-05-05T00:00:00.000Z', revokedReason: 'twilio_21610' } }
    expect(withdrawSmsConsent(withdrawn, 'phone_removed', NOW)).toEqual(withdrawn)
    expect(withdrawSmsConsent(null, 'phone_removed', NOW)).toEqual({})
    expect(withdrawSmsConsent({ a: 1 }, 'phone_removed', NOW)).toEqual({ a: 1 })
  })
})

// ── the routes ───────────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  userId: null as string | null,
  recorded: true as boolean | 'throw',
  user: null as null | { emailVerified: Date | null },
  profile: null as null | Record<string, unknown>,
  updates: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/auth-guard', () => ({
  requireAuth: async () =>
    h.userId
      ? { ok: true, userId: h.userId, session: {} }
      : { ok: false, response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }) },
}))
vi.mock('@/lib/auth/sessionRevocation', () => ({
  revokeAllSessionsForUser: async () => {
    if (h.recorded === 'throw') throw new Error('boom')
    return h.recorded
  },
}))
vi.mock('@/lib/prisma', () => {
  const tx = {
    appUser: { findUnique: async () => h.user },
    userProfile: {
      findUnique: async () => h.profile,
      update: async (args: { data: Record<string, unknown> }) => {
        h.updates.push(args.data)
        return {}
      },
    },
  }
  return { prisma: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } }
})

import { POST as revokeAll } from '@/app/api/user/sessions/revoke-all/route'
import { DELETE as removePhone } from '@/app/api/user/phone/route'

let n = 0
beforeEach(() => {
  h.userId = `u-route-${++n}` // fresh rate-limit bucket per test
  h.recorded = true
  h.user = { emailVerified: new Date('2026-01-01') }
  h.profile = null
  h.updates = []
})

describe('POST /api/user/sessions/revoke-all', () => {
  it('refuses without a session', async () => {
    h.userId = null
    expect((await revokeAll()).status).toBe(401)
  })

  it('200 when the revocation was recorded', async () => {
    const res = await revokeAll()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('503 — and says the other devices are STILL signed in — when it was not recorded', async () => {
    for (const r of [false, 'throw'] as const) {
      h.recorded = r
      const res = await revokeAll()
      expect(res.status).toBe(503)
      expect((await res.json()).message).toMatch(/still signed in/i)
    }
  })
})

describe('DELETE /api/user/phone', () => {
  it('removes the phone and withdraws SMS consent when the email is verified', async () => {
    h.profile = {
      phone: '+15555550100',
      phoneVerifiedAt: new Date('2026-02-01'),
      notificationPreferences: { smsConsent: { consentedAt: '2026-02-01T00:00:00Z', phone: '+15555550100' }, x: 1 },
    }
    const res = await removePhone()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, removed: true })
    expect(h.updates).toHaveLength(1)
    const data = h.updates[0] as { phone: unknown; phoneVerifiedAt: unknown; notificationPreferences: any }
    expect(data.phone).toBeNull()
    expect(data.phoneVerifiedAt).toBeNull()
    expect(data.notificationPreferences.x).toBe(1)
    expect(data.notificationPreferences.smsConsent.revokedReason).toBe('phone_removed')
  })

  it('409s — and writes nothing — when the phone is the only verification', async () => {
    h.user = { emailVerified: null }
    h.profile = { phone: '+15555550100', phoneVerifiedAt: new Date('2026-02-01'), notificationPreferences: null }
    const res = await removePhone()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('PHONE_IS_ONLY_VERIFICATION')
    expect(h.updates).toEqual([])
  })

  it('an UNVERIFIED phone can always be removed (it verifies nothing)', async () => {
    h.user = { emailVerified: null }
    h.profile = { phone: '+15555550100', phoneVerifiedAt: null, notificationPreferences: null }
    expect((await removePhone()).status).toBe(200)
    expect(h.updates).toHaveLength(1)
  })

  it('no phone on file is a no-op, not an error', async () => {
    h.profile = { phone: null, phoneVerifiedAt: null, notificationPreferences: null }
    const res = await removePhone()
    expect(await res.json()).toEqual({ ok: true, removed: false })
    expect(h.updates).toEqual([])
  })

  it('refuses without a session', async () => {
    h.userId = null
    expect((await removePhone()).status).toBe(401)
  })
})
