import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ create: vi.fn(), member: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: { bracketLeagueMember: { findUnique: h.member }, bracketLeagueMessage: { create: h.create } },
}))

import { POST } from '@/app/api/bracket/leagues/[leagueId]/chat/route'

/** The pool chat stored any URL as a GIF, which every member's browser then loaded. */

const post = (body: unknown) =>
  POST(new NextRequest('https://allfantasy.ai/api/bracket/leagues/L1/chat', { method: 'POST', body: JSON.stringify(body) }), {
    params: { leagueId: 'L1' },
  })

beforeEach(() => {
  h.member.mockReset().mockResolvedValue({ id: 'm1' })
  h.create.mockReset().mockResolvedValue({ id: 'msg1' })
})

describe('bracket pool chat — GIF links', () => {
  it('stores a GIF from a GIF service', async () => {
    const res = await post({ type: 'gif', imageUrl: 'https://static.klipy.com/td.gif' })
    expect(res.status).toBe(200)
    expect(h.create.mock.calls[0]![0].data).toMatchObject({ type: 'gif', imageUrl: 'https://static.klipy.com/td.gif' })
  })

  it('🛑 refuses any other link, and stores nothing', async () => {
    for (const imageUrl of ['https://tracker.test/pixel.gif', 'https://klipy.com.evil.test/a.gif', 'http://static.klipy.com/a.gif']) {
      const res = await post({ type: 'gif', imageUrl })
      expect(res.status, imageUrl).toBe(400)
    }
    expect(h.create).not.toHaveBeenCalled()
  })
})
