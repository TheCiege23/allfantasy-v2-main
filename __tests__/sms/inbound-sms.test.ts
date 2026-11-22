// @vitest-environment node
import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Texts sent back to AllFantasy's number (2026-11-15). STOP withdraws SMS consent at once, START undoes a
 * STOP, HELP is left to Twilio's own reply, and any other text gets — a few times a day at most — a link that
 * opens Chimmy with the question already typed. Every request must carry a valid Twilio signature.
 */

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  optOut: vi.fn(async () => 1),
  handle: vi.fn(),
}))
vi.mock('@/lib/sms/smsOptOut', () => ({ recordSmsOptOut: h.optOut }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  CHIMMY_PROMPT_MAX,
  classifyInboundSms,
  memberReplyText,
  signedUrlCandidates,
  strangerReplyText,
  twimlResponse,
} from '@/lib/sms/inboundSms'
import { hasSmsConsent, restoreSmsConsentAfterStart } from '@/lib/sms/smsConsent'
import { handleInboundSms } from '@/lib/sms/inboundSmsHandler'

const PHONE = '+15555550123'
const BASE = 'https://allfantasy.ai'

describe('what a text is', () => {
  it('the whole message is the keyword, the way Twilio matches it', () => {
    expect(classifyInboundSms('STOP')).toBe('stop')
    expect(classifyInboundSms('  Stop. ')).toBe('stop')
    expect(classifyInboundSms('unsubscribe')).toBe('stop')
    expect(classifyInboundSms('start')).toBe('start')
    expect(classifyInboundSms('Yes')).toBe('start')
    expect(classifyInboundSms('help')).toBe('help')
    expect(classifyInboundSms('stop texting me about waivers')).toBe('reply')
    expect(classifyInboundSms('who should I start at flex?')).toBe('reply')
    expect(classifyInboundSms('')).toBe('reply')
  })

  it("Twilio's own verdict wins", () => {
    expect(classifyInboundSms('arret', 'STOP')).toBe('stop')
    expect(classifyInboundSms('whatever', 'START')).toBe('start')
  })
})

describe('START brings back only a consent the person withdrew by texting STOP', () => {
  const consented = { consentedAt: '2026-10-01T00:00:00.000Z', phone: PHONE }
  const now = new Date('2026-11-15T12:00:00Z')

  it('restores a STOP and keeps the trail', () => {
    for (const reason of ['sms_stop', 'twilio_21610']) {
      const prefs = { other: 1, smsConsent: { ...consented, revokedAt: '2026-11-01T00:00:00.000Z', revokedReason: reason } }
      const restored = restoreSmsConsentAfterStart(prefs, PHONE, now)!
      expect(hasSmsConsent(restored, PHONE)).toBe(true)
      expect(restored.other).toBe(1)
      expect(restored.smsConsent).toMatchObject({ restoredVia: 'sms_start', lastRevokedReason: reason, consentedAt: consented.consentedAt })
    }
  })

  it('does nothing for a number that never opted in, a phone removed from the account, or another number', () => {
    expect(restoreSmsConsentAfterStart({}, PHONE, now)).toBeNull()
    expect(restoreSmsConsentAfterStart({ smsConsent: { ...consented } }, PHONE, now)).toBeNull()
    expect(restoreSmsConsentAfterStart({ smsConsent: { ...consented, revokedAt: 'x', revokedReason: 'phone_removed' } }, PHONE, now)).toBeNull()
    expect(restoreSmsConsentAfterStart({ smsConsent: { ...consented, revokedAt: 'x', revokedReason: 'sms_stop' } }, '+15555550999', now)).toBeNull()
  })
})

describe('the answers', () => {
  it("a member's text opens Chimmy with it already typed, cut to a short question", () => {
    const text = memberReplyText(BASE, 'Who should I start at flex,  Puka or Nabers?')
    expect(text).toContain(`${BASE}/chimmy/chat?prompt=Who+should+I+start+at+flex%2C+Puka+or+Nabers%3F`)
    const long = memberReplyText(BASE, 'x'.repeat(500))
    expect(long).toContain(`prompt=${'x'.repeat(CHIMMY_PROMPT_MAX)}`)
    expect(long).not.toContain('x'.repeat(CHIMMY_PROMPT_MAX + 1))
    expect(strangerReplyText(BASE)).toContain(`${BASE}/contact`)
  })

  it('TwiML is escaped, and no answer is an empty response', () => {
    expect(twimlResponse(null)).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
    expect(twimlResponse('a & b <c>')).toContain('<Message>a &amp; b &lt;c&gt;</Message>')
  })

  it('tries the configured address first, then the public one rebuilt from the forwarded host', () => {
    expect(
      signedUrlCandidates({
        configured: 'https://allfantasy.ai/api/webhooks/twilio/sms',
        forwardedHost: 'allfantasy.ai',
        forwardedProto: 'https',
        host: 'internal:8080',
        appBaseUrl: 'https://allfantasy.ai/',
        pathAndQuery: '/api/webhooks/twilio/sms',
      }),
    ).toEqual(['https://allfantasy.ai/api/webhooks/twilio/sms', 'https://internal:8080/api/webhooks/twilio/sms'])
  })
})

describe('handling a text', () => {
  const profile = (prefs: unknown) => ({ userId: 'u-1', notificationPreferences: prefs })
  function db(profiles: Array<{ userId: string; notificationPreferences: unknown }>) {
    return {
      userProfile: { findMany: vi.fn(async () => profiles), update: vi.fn(async () => ({})) },
      analyticsEvent: { create: vi.fn(async () => ({})) },
    }
  }
  beforeEach(() => h.optOut.mockClear())

  it('STOP withdraws consent now, and we add no reply of our own', async () => {
    const d = db([profile({})])
    const r = await handleInboundSms({ from: PHONE, body: 'STOP' }, { db: d as never, baseUrl: BASE })
    expect(r).toMatchObject({ kind: 'stop', reply: null })
    expect(h.optOut).toHaveBeenCalledWith(PHONE, 'sms_stop')
  })

  it('START restores a STOP on that number', async () => {
    const d = db([profile({ smsConsent: { consentedAt: 'a', phone: PHONE, revokedAt: 'b', revokedReason: 'sms_stop' } })])
    const r = await handleInboundSms({ from: '(555) 555-0123', body: 'START' }, { db: d as never, baseUrl: BASE })
    expect(r.reply).toBeNull()
    expect(d.userProfile.update).toHaveBeenCalledTimes(1)
    const data = (d.userProfile.update.mock.calls[0] as unknown as [{ data: { notificationPreferences: unknown } }])[0].data
    expect(hasSmsConsent(data.notificationPreferences, PHONE)).toBe(true)
  })

  it('HELP is left to Twilio', async () => {
    const r = await handleInboundSms({ from: PHONE, body: 'HELP' }, { db: db([profile({})]) as never, baseUrl: BASE })
    expect(r).toMatchObject({ kind: 'help', reply: null })
  })

  it("a member's question gets the Chimmy link, branded with the STOP line; a stranger is told nobody reads it", async () => {
    const member = await handleInboundSms({ from: PHONE, body: 'start Puka?' }, { db: db([profile({})]) as never, baseUrl: BASE, allowReply: async () => true })
    expect(member.kind).toBe('reply')
    expect(member.reply).toMatch(/^AllFantasy: /)
    expect(member.reply).toContain('/chimmy/chat?prompt=start+Puka%3F')
    expect(member.reply).toMatch(/Reply STOP to opt out\.$/)
    const stranger = await handleInboundSms({ from: PHONE, body: 'hi' }, { db: db([]) as never, baseUrl: BASE, allowReply: async () => true })
    expect(stranger.reply).toContain('/contact')
  })

  it('🛑 over the daily allowance it answers nothing, so two auto-responders cannot loop', async () => {
    const r = await handleInboundSms({ from: PHONE, body: 'hello' }, { db: db([profile({})]) as never, baseUrl: BASE, allowReply: async () => false })
    expect(r.reply).toBeNull()
  })

  it('counts the text without keeping what it said', async () => {
    const d = db([profile({})])
    await handleInboundSms({ from: PHONE, body: 'my secret lineup plan' }, { db: d as never, baseUrl: BASE, allowReply: async () => true })
    const row = JSON.stringify(d.analyticsEvent.create.mock.calls[0])
    expect(row).toContain('sms.inbound_received')
    expect(row).not.toContain('secret')
    expect(row).not.toContain(PHONE)
  })
})

describe('the webhook', () => {
  const TOKEN = 'test-auth-token'
  const URL_ = 'https://allfantasy.ai/api/webhooks/twilio/sms'

  /** Twilio's algorithm, written out here so the route is checked against it rather than against itself. */
  function sign(url: string, params: Record<string, string>): string {
    const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('')
    return createHmac('sha1', TOKEN).update(Buffer.from(data, 'utf-8')).digest('base64')
  }

  async function call(params: Record<string, string>, signature: string | null, token: string | undefined = TOKEN) {
    vi.resetModules()
    vi.stubEnv('TWILIO_AUTH_TOKEN', token ?? '')
    vi.stubEnv('TWILIO_INBOUND_WEBHOOK_URL', URL_)
    vi.doMock('@/lib/sms/inboundSmsHandler', () => ({ handleInboundSms: h.handle }))
    const { POST } = await import('@/app/api/webhooks/twilio/sms/route')
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', host: 'internal:8080' }
    if (signature !== null) headers['x-twilio-signature'] = signature
    return POST(new Request('http://internal:8080/api/webhooks/twilio/sms', { method: 'POST', headers, body: new URLSearchParams(params).toString() }) as never)
  }

  beforeEach(() => {
    h.handle.mockReset()
    h.handle.mockResolvedValue({ kind: 'reply', reply: 'AllFantasy: hi', knownUser: true })
  })

  it('answers a correctly signed text with TwiML', async () => {
    const params = { From: PHONE, Body: 'hi', MessageSid: 'SM1' }
    const res = await call(params, sign(URL_, params))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/xml')
    expect(await res.text()).toContain('<Message>AllFantasy: hi</Message>')
    expect(h.handle).toHaveBeenCalledWith(expect.objectContaining({ from: PHONE, body: 'hi' }), expect.anything())
  })

  it('🛑 refuses a forged or unsigned request, and touches nothing', async () => {
    const params = { From: PHONE, Body: 'STOP' }
    expect((await call(params, sign(URL_, { ...params, Body: 'START' }))).status).toBe(403)
    expect((await call(params, null)).status).toBe(403)
    expect(h.handle).not.toHaveBeenCalled()
  })

  it('🛑 refuses everything when there is no Auth Token to check signatures with', async () => {
    const params = { From: PHONE, Body: 'STOP' }
    expect((await call(params, sign(URL_, params), '')).status).toBe(503)
    expect(h.handle).not.toHaveBeenCalled()
  })
})
