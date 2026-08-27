import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireVerifiedUser: vi.fn(),
  leagueFindMany: vi.fn(),
  appUserFindUnique: vi.fn(),
  createLeagueChatMessage: vi.fn(),
  getLeagueMemberUserIds: vi.fn(),
  dispatchNotification: vi.fn(),
}))

vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: mocks.requireVerifiedUser }))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({
  createLeagueChatMessage: mocks.createLeagueChatMessage,
}))
vi.mock('@/lib/league-chat/leagueMemberIds', () => ({
  getLeagueMemberUserIds: mocks.getLeagueMemberUserIds,
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({
  dispatchNotification: mocks.dispatchNotification,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: mocks.leagueFindMany },
    appUser: { findUnique: mocks.appUserFindUnique },
  },
}))

function req(body: unknown) {
  return { json: async () => body } as never
}

describe('POST /api/chat/global-broadcast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireVerifiedUser.mockResolvedValue({ ok: true, userId: 'me' })
    mocks.appUserFindUnique.mockResolvedValue({ displayName: 'Commish' })
    mocks.createLeagueChatMessage.mockResolvedValue({ id: 'msg-1' })
    mocks.getLeagueMemberUserIds.mockResolvedValue(['me', 'other'])
  })

  it('sends to every league the sender owns', async () => {
    mocks.leagueFindMany.mockResolvedValue([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ])
    const { POST } = await import('@/app/api/chat/global-broadcast/route')
    const res = await POST(req({ selectedLeagueIds: ['a', 'b'], text: 'draft moved' }))

    const body = await res.json()
    expect(body.sentToLeagues).toBe(2)
    expect(body.skippedLeagueIds).toEqual([])
  })

  /*
   * The dangerous case: the picker offers leagues you CO-commission, the
   * endpoint accepts only leagues you OWN. Picking three and owning one used to
   * report plain success, so a draft reminder silently reached one league.
   */
  it('names the leagues it could not send to', async () => {
    mocks.leagueFindMany.mockResolvedValue([{ id: 'a', name: 'A' }])
    const { POST } = await import('@/app/api/chat/global-broadcast/route')
    const res = await POST(req({ selectedLeagueIds: ['a', 'b', 'c'], text: 'draft moved' }))

    const body = await res.json()
    expect(body.sentToLeagues).toBe(1)
    expect(body.skippedLeagueIds).toEqual(['b', 'c'])
  })

  it('reports the skipped set even when nothing could be sent', async () => {
    mocks.leagueFindMany.mockResolvedValue([])
    const { POST } = await import('@/app/api/chat/global-broadcast/route')
    const res = await POST(req({ selectedLeagueIds: ['b', 'c'], text: 'hi' }))

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.skippedLeagueIds).toEqual(['b', 'c'])
  })

  it('notifies the other members of each league it did reach', async () => {
    mocks.leagueFindMany.mockResolvedValue([{ id: 'a', name: 'A' }])
    const { POST } = await import('@/app/api/chat/global-broadcast/route')
    await POST(req({ selectedLeagueIds: ['a'], text: 'draft moved' }))

    expect(mocks.dispatchNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['other'] }),
    )
  })

  it('requires at least one league', async () => {
    const { POST } = await import('@/app/api/chat/global-broadcast/route')
    const res = await POST(req({ selectedLeagueIds: [], text: 'hi' }))
    expect(res.status).toBe(400)
  })
})
