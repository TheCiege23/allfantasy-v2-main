import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The /partners contact form's server half: lib/partner-portal/inquiry.ts + app/api/partners/inquiry/route.ts. */

const h = vi.hoisted(() => ({
  send: vi.fn(async (_a: { to: string; subject: string; bodyHtml: string }) => ({ ok: true }) as { ok: boolean; error?: string }),
  allow: vi.fn(() => ({ success: true, remaining: 2 })),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/resend-client', () => ({ sendNotificationEmail: h.send }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.allow, getClientIp: () => '203.0.113.9' }))
vi.mock('@/lib/notifications/notifyOwnerOfNewSignup', () => ({ OWNER_EMAIL: 'owner@example.com' }))

import { inquiryEmail, parsePartnerInquiry } from '@/lib/partner-portal/inquiry'
import { POST } from '@/app/api/partners/inquiry/route'

const good = { name: 'Pat Lee', email: 'Pat@Acme.io', company: 'Acme Fantasy', website: 'acme.io', leagueCount: '1,000 to 10,000', message: 'Hi.' }

const post = (body: unknown, contentType = 'application/json') =>
  POST(new Request('https://allfantasy.ai/api/partners/inquiry', { method: 'POST', headers: { 'content-type': contentType }, body: typeof body === 'string' ? body : JSON.stringify(body) }))

beforeEach(() => {
  h.send.mockReset()
  h.send.mockResolvedValue({ ok: true })
  h.allow.mockReset()
  h.allow.mockReturnValue({ success: true, remaining: 2 })
})

describe('parsePartnerInquiry', () => {
  it('normalizes a good inquiry: lowercased email, https website, optional fields null when empty', () => {
    expect(parsePartnerInquiry(good)).toEqual({
      ok: true,
      value: { name: 'Pat Lee', email: 'pat@acme.io', company: 'Acme Fantasy', website: 'https://acme.io/', leagueCount: '1,000 to 10,000', message: 'Hi.' },
    })
    const bare = parsePartnerInquiry({ name: 'Pat', email: 'pat@acme.io', company: 'Acme' })
    expect(bare.ok && bare.value).toMatchObject({ website: null, leagueCount: null, message: null })
  })

  it('says which fields need fixing', () => {
    const r = parsePartnerInquiry({ name: '', email: 'nope', company: 'x'.repeat(121), website: 'not a site', leagueCount: 'a zillion', message: 'm'.repeat(2001) })
    expect(r.ok === false && !r.bot && Object.keys(r.errors).sort()).toEqual(['company', 'email', 'leagueCount', 'message', 'name', 'website'])
  })

  it('🛑 strips line breaks and control characters from anything that reaches the email subject', () => {
    const r = parsePartnerInquiry({ ...good, company: 'Acme\r\nBcc: victim@example.com', name: 'Pat\u0000Lee' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { subject } = inquiryEmail(r.value, new Date('2026-11-17T00:00:00Z'))
    expect(subject).toBe('Partner inquiry: Acme Bcc: victim@example.com (Pat Lee)')
    expect(subject).not.toMatch(/[\r\n\u0000]/)
  })

  it('the honeypot marks a bot', () => {
    expect(parsePartnerInquiry({ ...good, fax: '555-0100' })).toEqual({ ok: false, bot: true })
  })
})

describe('POST /api/partners/inquiry', () => {
  it('emails the owner and says "sent" only when the email was accepted', async () => {
    const res = await post(good)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(h.send).toHaveBeenCalledTimes(1)
    const arg = h.send.mock.calls[0]![0]
    expect(arg.to).toBe('owner@example.com')
    expect(arg.subject).toBe('Partner inquiry: Acme Fantasy (Pat Lee)')
    expect(arg.bodyHtml).toContain('Reply to pat@acme.io')
    expect(arg.bodyHtml).toContain('Leagues: 1,000 to 10,000')
  })

  it.each([
    ['the provider refuses it', () => h.send.mockResolvedValue({ ok: false, error: 'not configured' })],
    ['the send throws', () => h.send.mockRejectedValue(new Error('network'))],
  ])('🛑 %s → 503 with the address to write to, never a false "sent"', async (_label, setup) => {
    setup()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await post(good)
    spy.mockRestore()
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.message).toContain('support@allfantasy.ai')
  })

  it('a bot gets the same "sent" a person would, and nothing is emailed', async () => {
    const res = await post({ ...good, fax: 'x' })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('field errors come back as 400, nothing emailed', async () => {
    const res = await post({ ...good, email: 'nope' })
    expect(res.status).toBe(400)
    expect((await res.json()).errors).toEqual({ email: 'Check the email address.' })
    expect(h.send).not.toHaveBeenCalled()
  })

  it('rate-limited per address, 3 per 10 minutes', async () => {
    h.allow.mockReturnValue({ success: false, remaining: 0 })
    const res = await post(good)
    expect(res.status).toBe(429)
    expect(h.allow).toHaveBeenCalledWith('partner-inquiry:203.0.113.9', 3, 600_000)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('JSON only (a cross-site form post cannot send it without a preflight); a broken body is a 400', async () => {
    expect((await post('name=Pat', 'application/x-www-form-urlencoded')).status).toBe(415)
    expect((await post('{not json')).status).toBe(400)
    expect(h.send).not.toHaveBeenCalled()
  })
})
