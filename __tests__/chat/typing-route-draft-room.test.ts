/**
 * The draft room's own typing channel, `league:<id>:draft` (2026-11-19): league members may use it,
 * and it is a separate key from league chat so league-chat typing never shows in the draft room.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hm = vi.hoisted(() => ({
  user: { appUserId: 'u1' as string | null },
  access: vi.fn(),
  mark: vi.fn(async () => {}),
  read: vi.fn(async () => [] as Array<{ userId: string; name: string }>),
}))
vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: async () => hm.user }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: hm.access }))
vi.mock('@/lib/chat-core/durableTyping', () => ({ markTyping: hm.mark, clearTyping: vi.fn(async () => {}), readTyping: hm.read }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    bracketLeagueMember: { findUnique: vi.fn(async () => null) },
    platformChatThreadMember: { findFirst: vi.fn(async () => null) },
    appUser: { findUnique: vi.fn(async () => ({ displayName: 'Sam', username: 'sam' })) },
  },
}))

import { GET, POST } from '@/app/api/shared/chat/threads/[threadId]/typing/route'

const call = (fn: typeof GET, threadId: string, body?: unknown) =>
  fn(
    new NextRequest('http://x/api', { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined }),
    { params: Promise.resolve({ threadId: encodeURIComponent(threadId) }) },
  )

beforeEach(() => {
  vi.clearAllMocks()
  hm.access.mockResolvedValue({ role: 'member' })
})

describe('draft room typing channel', () => {
  it('lets a league member type in league:<id>:draft, stored under that key', async () => {
    const res = await call(POST, 'league:L1:draft', { isTyping: true })
    expect(res.status).toBe(200)
    expect(hm.access).toHaveBeenCalledWith('L1', 'u1')
    expect(hm.mark).toHaveBeenCalledWith('league:L1:draft', { userId: 'u1', name: 'Sam' })
  })

  it('refuses someone who is not in the league', async () => {
    hm.access.mockResolvedValue(null)
    expect((await call(GET, 'league:L1:draft')).status).toBe(403)
  })

  it('does not treat a non-league thread with the suffix as a league room', async () => {
    expect((await call(GET, 'dm-123:draft')).status).toBe(403)
    expect(hm.access).not.toHaveBeenCalled()
  })
})
