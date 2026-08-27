import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolvePlatformUserMock = vi.fn()
const resolveLeagueAccessMock = vi.fn()
const closePollMessageMock = vi.fn()

const prismaMock = { leagueChatMessage: { findUnique: vi.fn(), update: vi.fn() } }

vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: resolvePlatformUserMock }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: resolveLeagueAccessMock }))
vi.mock('@/lib/platform/chat-service', () => ({ closePollMessage: closePollMessageMock }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/chat-core', () => ({
  isLeagueVirtualRoom: (id: string) => id.startsWith('league:'),
  getLeagueIdFromVirtualRoom: (id: string) => id.replace(/^league:/, ''),
}))

const ROUTE = '../app/api/shared/chat/threads/[threadId]/messages/[messageId]/close-poll/route'
const ctx = { params: { threadId: 'league:l1', messageId: 'm1' } } as never
const req = new Request('http://localhost/close', { method: 'POST' }) as never

function row(senderUserId: string | null) {
  return {
    id: 'm1',
    leagueId: 'l1',
    senderUserId,
    metadata: { poll: { question: 'Q', options: [{ id: 'a', text: 'x', votes: [] }] } },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resolvePlatformUserMock.mockResolvedValue({ appUserId: 'u1' })
  resolveLeagueAccessMock.mockResolvedValue({ leagueId: 'l1', isCommissioner: false })
  prismaMock.leagueChatMessage.update.mockResolvedValue({ id: 'm1' })
})

describe('closing a league poll', () => {
  /*
   * Same gap as the vote route beside it: no league branch, so `closePollMessage`
   * looked for a PlatformChatMessage that a league poll is not. All 15 platform
   * chat threads in production are 'ai'.
   */
  it('lets the author close their own poll', async () => {
    const { POST } = await import(ROUTE)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue(row('u1'))

    const res = await POST(req, ctx)

    expect(res.status).toBe(200)
    expect(prismaMock.leagueChatMessage.update.mock.calls[0][0].data.metadata.poll.closed).toBe(true)
    expect(closePollMessageMock).not.toHaveBeenCalled()
  })

  it('lets a commissioner close somebody else\u2019s poll', async () => {
    const { POST } = await import(ROUTE)
    resolveLeagueAccessMock.mockResolvedValue({ leagueId: 'l1', isCommissioner: true })
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue(row('someone-else'))

    expect((await POST(req, ctx)).status).toBe(200)
  })

  /* Reading gets you a vote; ending everyone else's says otherwise. */
  it('refuses an ordinary member closing somebody else\u2019s poll', async () => {
    const { POST } = await import(ROUTE)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue(row('someone-else'))

    const res = await POST(req, ctx)

    expect(res.status).toBe(403)
    expect(prismaMock.leagueChatMessage.update).not.toHaveBeenCalled()
  })

  it('refuses somebody with no access to the league', async () => {
    const { POST } = await import(ROUTE)
    resolveLeagueAccessMock.mockResolvedValue(null)

    expect((await POST(req, ctx)).status).toBe(403)
  })

  it('keeps the options and the rest of the metadata', async () => {
    const { POST } = await import(ROUTE)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue({
      ...row('u1'),
      metadata: {
        gif: { url: 'g' },
        poll: { question: 'Q', options: [{ id: 'a', text: 'x', votes: ['u2'] }] },
      },
    })

    await POST(req, ctx)

    const written = prismaMock.leagueChatMessage.update.mock.calls[0][0].data.metadata
    expect(written.gif).toEqual({ url: 'g' })
    expect(written.poll.options[0].votes).toEqual(['u2'])
  })

  /* Two commissioners tapping at once is not a failure worth surfacing. */
  it('is a no-op on an already closed poll', async () => {
    const { POST } = await import(ROUTE)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue({
      ...row('u1'),
      metadata: { poll: { question: 'Q', options: [{ id: 'a', text: 'x', votes: [] }], closed: true } },
    })

    expect((await POST(req, ctx)).status).toBe(200)
  })

  it('refuses a message that is not a poll', async () => {
    const { POST } = await import(ROUTE)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue({
      id: 'm1',
      leagueId: 'l1',
      senderUserId: 'u1',
      metadata: {},
    })

    expect((await POST(req, ctx)).status).toBe(400)
  })

  it('refuses a message from another league', async () => {
    const { POST } = await import(ROUTE)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue({ ...row('u1'), leagueId: 'other' })

    expect((await POST(req, ctx)).status).toBe(404)
  })

  it('leaves the platform-thread path untouched', async () => {
    const { POST } = await import(ROUTE)
    closePollMessageMock.mockResolvedValue(true)

    const res = await POST(req, { params: { threadId: 'thread-abc', messageId: 'm1' } } as never)

    expect(res.status).toBe(200)
    expect(closePollMessageMock).toHaveBeenCalledWith('u1', 'thread-abc', 'm1')
  })
})
