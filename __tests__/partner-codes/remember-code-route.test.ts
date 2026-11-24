// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/partner-codes/remember: a code typed on /signup, checked and saved before Apple or
 * Google sign-in. Pins: only a real, active code sets the cookie; the cookie survives Sign in with
 * Apple's cross-site POST back (SameSite=None on https); off means not found.
 */

const h = vi.hoisted(() => ({ codes: new Map<string, { code: string; status: string }>() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/partner-codes/service', () => ({
  findPartnerCode: vi.fn(async (raw: string) => h.codes.get(raw.toLowerCase()) ?? null),
}))

import { POST } from '@/app/api/partner-codes/remember/route'

const post = (body: unknown, url = 'https://allfantasy.ai/api/partner-codes/remember', ip = '203.0.113.7') =>
  POST(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body) }))

let ipN = 0
const freshIp = () => `198.51.100.${++ipN}`

beforeEach(() => {
  vi.stubEnv('PARTNER_CODES_ENABLED', '1')
  h.codes.clear()
  h.codes.set('theciege', { code: 'TheCiege', status: 'active' })
  h.codes.set('paused1', { code: 'Paused1', status: 'paused' })
})
afterEach(() => vi.unstubAllEnvs())

describe('remember a typed partner code', () => {
  it('sets the code cookie for an active code, in its canonical spelling', async () => {
    const res = await post({ code: 'theciege' }, undefined, freshIp())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, code: 'TheCiege' })
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/^af_partner_code=TheCiege;/)
    expect(cookie).toMatch(/HttpOnly/i)
    // Sign in with Apple on the web returns with a cross-site POST; a Lax cookie would not ride it.
    expect(cookie).toMatch(/SameSite=none/i)
    expect(cookie).toMatch(/Secure/i)
  })

  it('refuses an unknown or inactive code and sets nothing', async () => {
    for (const code of ['nope1234', 'paused1']) {
      const res = await post({ code }, undefined, freshIp())
      expect(res.status, code).toBe(400)
      expect((await res.json()).error).toMatch(/don't recognize that partner code/)
      expect(res.headers.get('set-cookie')).toBeNull()
    }
  })

  it('is not found while the program is off', async () => {
    vi.stubEnv('PARTNER_CODES_ENABLED', '0')
    const res = await post({ code: 'theciege' }, undefined, freshIp())
    expect(res.status).toBe(404)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('uses Lax on plain-http dev, where browsers refuse SameSite=None without Secure', async () => {
    const res = await post({ code: 'theciege' }, 'http://localhost:3000/api/partner-codes/remember', freshIp())
    expect(res.headers.get('set-cookie') ?? '').toMatch(/SameSite=lax/i)
  })

  it('is rate limited per visitor', async () => {
    const ip = freshIp()
    let last = 0
    for (let i = 0; i < 21; i++) last = (await post({ code: 'nope1234' }, undefined, ip)).status
    expect(last).toBe(429)
  })
})
