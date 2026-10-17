import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
const mocks = vi.hoisted(() => ({ session: vi.fn(), record: vi.fn(), limit: vi.fn(), admin: vi.fn(), report: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordAnalyticsEvent: mocks.record }))
vi.mock('@/lib/rate-limit', () => ({ consumeRateLimit: mocks.limit, getClientIp: () => 'test' }))
vi.mock('@/lib/adminAuth', () => ({ requireAdmin: mocks.admin }))
vi.mock('@/lib/analytics/highlightReport', () => ({ getHighlightReport: mocks.report }))
import { POST } from '@/app/api/analytics/beacon/route'
import { GET } from '@/app/api/admin/highlight-analytics/route'
import { HIGHLIGHTS } from '@/lib/analytics/highlights'
const meta = { surface: 'my_team', viewId: '12345678-1234-4234-8234-123456789012', status: 'clips', clipCount: 2, visibility: 'header' }
const request = (data: unknown) => new NextRequest('https://allfantasy.ai/api/analytics/beacon', { method: 'POST', body: JSON.stringify(data) })
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ user: { id: 'real-user' } }); mocks.limit.mockReturnValue({ success: true }); mocks.admin.mockResolvedValue({ ok: true }) })
describe('highlight telemetry boundary', () => {
  it('requires a session and takes identity only from that session', async () => {
    mocks.session.mockResolvedValueOnce(null)
    expect((await POST(request({ event: HIGHLIGHTS.VIEW, meta }))).status).toBe(401)
    expect(mocks.record).not.toHaveBeenCalled()
    const res = await POST(request({ event: HIGHLIGHTS.VIEW, meta, userId: 'forged', path: '/private/roster', sessionId: 'forged-session' }))
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mocks.record).toHaveBeenCalledWith({ event: HIGHLIGHTS.VIEW, userId: 'real-user', toolKey: 'af_product', path: '/core', meta })
  })
  it.each([
    { event: HIGHLIGHTS.VIEW, meta: { ...meta, playerId: 'secret' } },
    { event: HIGHLIGHTS.VIEW, meta: { ...meta, clipCount: 0 } },
    { event: HIGHLIGHTS.VIEW, meta: { ...meta, status: 'empty' } },
    { event: HIGHLIGHTS.VIEW, meta: { ...meta, viewId: 'not-a-uuid' } },
    { event: 'engagement.highlights.playback_completed', meta },
    null,
  ])('rejects unknown vocabulary and private or inconsistent metadata', async body => {
    expect((await POST(request(body))).status).toBe(400); expect(mocks.record).not.toHaveBeenCalled()
  })
  it('throttles highlights while retaining existing product event support', async () => {
    mocks.limit.mockReturnValue({ success: false, retryAfterSec: 20 })
    expect((await POST(request({ event: HIGHLIGHTS.VIEW, meta }))).status).toBe(429)
    expect(mocks.record).not.toHaveBeenCalled()
    expect((await POST(request({ event: 'product.existing', meta: { test: true } }))).status).toBe(200)
  })
  it('gates reports before querying and never presents query failures as zeros', async () => {
    mocks.admin.mockResolvedValueOnce({ ok: false, res: NextResponse.json({}, { status: 403 }) })
    expect((await GET()).status).toBe(403); expect(mocks.report).not.toHaveBeenCalled()
    mocks.report.mockRejectedValueOnce(new Error('database details must stay private'))
    const failed = await GET(); expect(failed.status).toBe(503); expect(JSON.stringify(await failed.json())).not.toContain('database details')
    mocks.report.mockResolvedValueOnce({ surfaces: [] })
    expect((await GET()).headers.get('Cache-Control')).toBe('private, no-store')
  })
})
