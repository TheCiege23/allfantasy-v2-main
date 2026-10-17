// @vitest-environment node
/**
 * POST /api/leagues/[leagueId]/trades/screenshot — only reads the image, and only for a league member,
 * inside a per-minute and a durable daily bound. Every AI call here costs money per request.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  member: vi.fn(),
  daily: vi.fn(),
  read: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: m.member }))
vi.mock('@/lib/rate-limit-daily', () => ({ consumeDailyLimit: m.daily }))
vi.mock('@/lib/trade-screenshot/readOfferScreenshot', () => ({
  MAX_OFFER_SCREENSHOT_BYTES: 5 * 1024 * 1024,
  OFFER_SCREENSHOT_TYPES: new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  readOfferScreenshot: m.read,
}))

import { POST } from '@/app/api/leagues/[leagueId]/trades/screenshot/route'

let userSeq = 0
const call = (file: File | null) => {
  const form = new FormData()
  if (file) form.append('image', file)
  const req = new Request('http://x/api/leagues/L1/trades/screenshot', { method: 'POST', body: form })
  return POST(req as never, { params: Promise.resolve({ leagueId: 'L1' }) })
}
const png = (bytes = 10) => new File([new Uint8Array(bytes)], 'offer.png', { type: 'image/png' })

beforeEach(() => {
  vi.clearAllMocks()
  // A fresh user per test, so the in-memory per-minute limiter never carries across tests.
  m.session.mockResolvedValue({ user: { id: `u${++userSeq}` } })
  m.member.mockResolvedValue({ ok: true })
  m.daily.mockResolvedValue({ success: true, retryAfterSec: 0 })
  m.read.mockResolvedValue({ status: 'read', read: { kind: 'not_a_trade' } })
})

describe('trade screenshot route', () => {
  it('signed out → 401, and nothing is read', async () => {
    m.session.mockResolvedValue(null)
    expect((await call(png())).status).toBe(401)
    expect(m.read).not.toHaveBeenCalled()
  })

  it('not in the league → refused, and nothing is read', async () => {
    m.member.mockResolvedValue({ ok: false, status: 403 })
    expect((await call(png())).status).toBe(403)
    expect(m.read).not.toHaveBeenCalled()
  })

  it('no file, a non-image, or an oversized image → 4xx before any AI call', async () => {
    expect((await call(null)).status).toBe(400)
    expect((await call(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).status).toBe(400)
    expect((await call(png(5 * 1024 * 1024 + 1))).status).toBe(413)
    expect(m.read).not.toHaveBeenCalled()
  })

  it('over the daily cap → 429 with Retry-After, and nothing is read', async () => {
    m.daily.mockResolvedValue({ success: false, retryAfterSec: 3600 })
    const r = await call(png())
    expect(r.status).toBe(429)
    expect(r.headers.get('Retry-After')).toBe('3600')
    expect(m.read).not.toHaveBeenCalled()
  })

  it('a sixth read inside a minute → 429', async () => {
    for (let i = 0; i < 5; i++) expect((await call(png())).status).toBe(200)
    expect((await call(png())).status).toBe(429)
  })

  it('returns the read; AI switched off or unreachable → 503 that points at entering it by hand', async () => {
    const ok = await call(png())
    expect(await ok.json()).toEqual({ read: { kind: 'not_a_trade' } })
    m.read.mockResolvedValue({ status: 'disabled' })
    const off = await call(png())
    expect(off.status).toBe(503)
    expect((await off.json()).error).toMatch(/by hand/)
  })
})
