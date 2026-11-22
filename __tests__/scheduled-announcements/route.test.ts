import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/** /api/commissioner/leagues/:id/scheduled-announcements — who may use it, and what it answers. */

const m = vi.hoisted(() => ({
  session: { user: { id: 'comm' } } as { user: { id: string } } | null,
  refusal: vi.fn(),
  list: vi.fn(),
  schedule: vi.fn(),
  cancel: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => m.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/broadcastAccess', () => ({ broadcastRefusal: m.refusal }))
vi.mock('@/lib/commissioner/scheduledAnnouncementService', () => ({
  listScheduledAnnouncements: m.list,
  scheduleAnnouncement: m.schedule,
  cancelScheduledAnnouncement: m.cancel,
}))

import { DELETE, GET, POST } from '@/app/api/commissioner/leagues/[leagueId]/scheduled-announcements/route'

const ctx = { params: Promise.resolve({ leagueId: 'L' }) }
const url = 'http://x/api/commissioner/leagues/L/scheduled-announcements'
const a = (id: string, status: string, sendAt: string) => ({ id, status, sendAt, message: id, byUserId: 'comm', createdAt: sendAt })

beforeEach(() => {
  vi.clearAllMocks()
  m.session = { user: { id: 'comm' } }
  m.refusal.mockResolvedValue(null)
})

describe('scheduled-announcements route', () => {
  it('401 signed out; 403 for someone who cannot send; 409 for an imported league — and the service is never reached', async () => {
    m.session = null
    expect((await GET(new NextRequest(url), ctx)).status).toBe(401)
    m.session = { user: { id: 'member' } }
    m.refusal.mockResolvedValue('forbidden')
    expect((await POST(new NextRequest(url, { method: 'POST', body: '{}' }), ctx)).status).toBe(403)
    m.refusal.mockResolvedValue('imported')
    expect((await DELETE(new NextRequest(`${url}?id=x`, { method: 'DELETE' }), ctx)).status).toBe(409)
    expect(m.list).not.toHaveBeenCalled()
    expect(m.schedule).not.toHaveBeenCalled()
    expect(m.cancel).not.toHaveBeenCalled()
  })

  it('GET lists open posts first, then finished ones newest first', async () => {
    m.list.mockResolvedValue([a('old', 'sent', '2026-10-01T00:00:00Z'), a('new', 'failed', '2026-10-05T00:00:00Z'), a('open', 'pending', '2026-10-30T00:00:00Z')])
    const data = await (await GET(new NextRequest(url), ctx)).json()
    expect(data.announcements.map((x: { id: string }) => x.id)).toEqual(['open', 'new', 'old'])
  })

  it('POST passes the body and the caller through and answers a refusal in words', async () => {
    m.schedule.mockResolvedValue({ ok: false, error: 'too_soon' })
    const res = await POST(new NextRequest(url, { method: 'POST', body: JSON.stringify({ message: 'hi', sendAt: 'x' }) }), ctx)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/at least 15 minutes/)
    expect(m.schedule).toHaveBeenCalledWith('L', 'comm', { message: 'hi', sendAt: 'x' })
    m.schedule.mockResolvedValue({ ok: false, error: 'too_many' })
    expect((await POST(new NextRequest(url, { method: 'POST', body: '{}' }), ctx)).status).toBe(409)
  })

  it('DELETE needs an id and says when it is too late to cancel', async () => {
    expect((await DELETE(new NextRequest(url, { method: 'DELETE' }), ctx)).status).toBe(400)
    m.cancel.mockResolvedValue(false)
    expect((await DELETE(new NextRequest(`${url}?id=a1`, { method: 'DELETE' }), ctx)).status).toBe(409)
    m.cancel.mockResolvedValue(true)
    const ok = await DELETE(new NextRequest(`${url}?id=a1`, { method: 'DELETE' }), ctx)
    expect(await ok.json()).toEqual({ cancelled: true })
    expect(m.cancel).toHaveBeenLastCalledWith('L', 'comm', 'a1')
  })
})
