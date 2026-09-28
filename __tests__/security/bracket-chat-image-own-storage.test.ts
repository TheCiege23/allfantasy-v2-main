/**
 * The bracket pool chat POST (`/api/bracket/leagues/[leagueId]/chat`) stored any `imageUrl` for a
 * `type: "image"` message, and every member's browser loaded it. It now keeps only this pool's own
 * private upload — `/api/chat/upload?path=chat/bracket/<leagueId>/image/…`, what
 * `/api/bracket/chat-upload` returns — through the SAME helper the shared-thread route uses
 * (`sanitizeClientImageUrl`). The uploader's OLD public Blob URLs are refused for new posts, while
 * rows that already carry one still come back unchanged on read.
 *
 * The REAL route and helper run; only the session and the two tables are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ create: vi.fn(), member: vi.fn(), findMany: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    bracketLeagueMember: { findUnique: h.member },
    bracketLeagueMessage: { create: h.create, findMany: h.findMany },
  },
}))

import { GET, POST } from '@/app/api/bracket/leagues/[leagueId]/chat/route'

const OWN = `/api/chat/upload?path=${encodeURIComponent('chat/bracket/L1/image/5b1c2d3e.png')}`
const LEGACY_PUBLIC = 'https://abc123.public.blob.vercel-storage.com/bracket-chat/u1/5b1c2d3e.png'

const post = (imageUrl: unknown) =>
  POST(
    new NextRequest('https://allfantasy.ai/api/bracket/leagues/L1/chat', {
      method: 'POST',
      body: JSON.stringify({ type: 'image', imageUrl, message: '' }),
    }),
    { params: { leagueId: 'L1' } },
  )

beforeEach(() => {
  h.member.mockReset().mockResolvedValue({ id: 'm1' })
  h.create.mockReset().mockResolvedValue({ id: 'msg1' })
  h.findMany.mockReset()
})

describe('bracket pool chat — photos come from this pool’s own uploads', () => {
  it('stores the private upload URL the pool uploader returns', async () => {
    const res = await post(OWN)
    expect(res.status).toBe(200)
    expect(h.create.mock.calls[0]![0].data).toMatchObject({ type: 'image', imageUrl: OWN })
  })

  it.each([
    ['a tracking host', 'https://tracker.test/pixel.png'],
    ['the old public Blob URL shape', LEGACY_PUBLIC],
    ['another pool’s upload', `/api/chat/upload?path=${encodeURIComponent('chat/bracket/OTHER/image/x.png')}`],
    ['a league (not pool) upload path', `/api/chat/upload?path=${encodeURIComponent('chat/L1/image/x.png')}`],
    ['a protocol-relative host', '//tracker.test/pixel.png'],
    ['our upload route with an extra parameter', `${OWN}&x=1`],
  ])('refuses %s and stores nothing', async (_label, imageUrl) => {
    const res = await post(imageUrl)
    expect(res.status).toBe(400)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('still returns an existing row’s legacy public URL unchanged on read', async () => {
    h.findMany.mockResolvedValue([{ id: 'old', type: 'image', imageUrl: LEGACY_PUBLIC, message: '' }])
    const res = await GET(new NextRequest('https://allfantasy.ai/api/bracket/leagues/L1/chat'), { params: { leagueId: 'L1' } })
    const json = (await res.json()) as { messages: Array<{ imageUrl: string }> }
    expect(json.messages[0]!.imageUrl).toBe(LEGACY_PUBLIC)
  })
})
