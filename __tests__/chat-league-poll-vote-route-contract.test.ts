import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolvePlatformUserMock = vi.fn()
const resolveLeagueAccessMock = vi.fn()
const votePollMessageMock = vi.fn()

const prismaMock = {
  leagueChatMessage: { findUnique: vi.fn(), update: vi.fn() },
}

vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: resolvePlatformUserMock }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: resolveLeagueAccessMock }))
vi.mock('@/lib/platform/chat-service', () => ({ votePollMessage: votePollMessageMock }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/chat-core', () => ({
  isLeagueVirtualRoom: (id: string) => id.startsWith('league:'),
  getLeagueIdFromVirtualRoom: (id: string) => id.replace(/^league:/, ''),
}))

const ROUTE = '../app/api/shared/chat/threads/[threadId]/messages/[messageId]/vote/route'

function voteReq(body: unknown) {
  return new Request('http://localhost/vote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

const ctx = { params: { threadId: 'league:l1', messageId: 'm1' } } as never

function pollRow(
  options: Array<{ id: string; text: string; votes: string[] }>,
  extra: Record<string, unknown> = {},
) {
  return { id: 'm1', leagueId: 'l1', metadata: { poll: { question: 'Q', options, ...extra } } }
}

/** The options the route wrote back. */
function writtenOptions() {
  return prismaMock.leagueChatMessage.update.mock.calls[0][0].data.metadata.poll.options
}

beforeEach(() => {
  vi.clearAllMocks()
  resolvePlatformUserMock.mockResolvedValue({ appUserId: 'u1' })
  resolveLeagueAccessMock.mockResolvedValue({ leagueId: 'l1' })
  prismaMock.leagueChatMessage.update.mockResolvedValue({ id: 'm1' })
})

describe('league poll voting', () => {
  /*
   * This route had no league branch at all: it went straight to
   * `votePollMessage`, which needs a PlatformChatThreadMember row and a
   * PlatformChatMessage of type 'poll'. Production holds 15 platform chat
   * threads and all 15 are 'ai', so every poll a person actually posted got a
   * 400 here.
   */
  it('records a vote on a poll stored in league chat metadata', async () => {
    const { POST } = await import(ROUTE)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue(
      pollRow([
        { id: 'a', text: 'Chiefs', votes: [] },
        { id: 'b', text: 'Bills', votes: [] },
      ]),
    )

    const res = await POST(voteReq({ optionId: 'a' }), ctx)

    expect(res.status).toBe(200)
    expect(writtenOptions()[0].votes).toEqual(['u1'])
    expect(votePollMessageMock).not.toHaveBeenCalled()
  })

  it('moves an existing vote rather than counting the voter twice', async () => {
    const { POST } = await import(ROUTE)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue(
      pollRow([
        { id: 'a', text: 'Chiefs', votes: ['u1'] },
        { id: 'b', text: 'Bills', votes: ['u2'] },
      ]),
    )

    await POST(voteReq({ optionId: 'b' }), ctx)

    const options = writtenOptions()
    expect(options[0].votes).toEqual([])
    expect(options[1].votes).toEqual(['u2', 'u1'])
  })

  it('withdraws the vote when the held option is chosen again', async () => {
    const { POST } = await import(ROUTE)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue(
      pollRow([{ id: 'a', text: 'Chiefs', votes: ['u1', 'u2'] }]),
    )

    await POST(voteReq({ optionId: 'a' }), ctx)

    expect(writtenOptions()[0].votes).toEqual(['u2'])
  })

  it('leaves the rest of the message metadata alone', async () => {
    const { POST } = await import(ROUTE)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue({
      id: 'm1',
      leagueId: 'l1',
      metadata: { gif: { url: 'g' }, poll: { question: 'Q', options: [{ id: 'a', text: 'x', votes: [] }] } },
    })

    await POST(voteReq({ optionId: 'a' }), ctx)

    expect(prismaMock.leagueChatMessage.update.mock.calls[0][0].data.metadata.gif).toEqual({ url: 'g' })
  })

  /* Voting in a poll you can read is not a wider permission than reading it. */
  it('refuses somebody with no access to the league', async () => {
    const { POST } = await import(ROUTE)
    resolveLeagueAccessMock.mockResolvedValue(null)

    const res = await POST(voteReq({ optionId: 'a' }), ctx)

    expect(res.status).toBe(403)
    expect(prismaMock.leagueChatMessage.update).not.toHaveBeenCalled()
  })

  it('refuses a message from another league', async () => {
    const { POST } = await import(ROUTE)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue({
      id: 'm1',
      leagueId: 'other',
      metadata: { poll: { question: 'Q', options: [{ id: 'a', text: 'x', votes: [] }] } },
    })

    expect((await POST(voteReq({ optionId: 'a' }), ctx)).status).toBe(404)
  })

  it('refuses a message that is not a poll', async () => {
    const { POST } = await import(ROUTE)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue({ id: 'm1', leagueId: 'l1', metadata: {} })

    expect((await POST(voteReq({ optionId: 'a' }), ctx)).status).toBe(400)
  })

  it('refuses an option that is not on the poll', async () => {
    const { POST } = await import(ROUTE)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue(
      pollRow([{ id: 'a', text: 'Chiefs', votes: [] }]),
    )

    expect((await POST(voteReq({ optionId: 'zzz' }), ctx)).status).toBe(400)
  })

  it('requires an optionId for a league poll', async () => {
    const { POST } = await import(ROUTE)

    expect((await POST(voteReq({ optionIndex: 0 }), ctx)).status).toBe(400)
  })

  it('leaves the platform-thread path untouched', async () => {
    const { POST } = await import(ROUTE)
    votePollMessageMock.mockResolvedValue(true)

    const res = await POST(voteReq({ optionIndex: 1 }), {
      params: { threadId: 'thread-abc', messageId: 'm1' },
    } as never)

    expect(res.status).toBe(200)
    expect(votePollMessageMock).toHaveBeenCalledWith('u1', 'thread-abc', 'm1', 1)
  })

  /*
   * The composer has stored `closeAt` on every poll it ever posted and nothing
   * read it back, so every poll ran forever. The UI's disabled state is a
   * courtesy — a slow clock, or anything that is not the drawer, must not be
   * able to vote late.
   */
  it('refuses a vote after the deadline has passed', async () => {
    const { POST } = await import(ROUTE)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue(
      pollRow([{ id: 'a', text: 'x', votes: [] }], {
        closeAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    )

    const res = await POST(voteReq({ optionId: 'a' }), ctx)

    expect(res.status).toBe(409)
    expect(prismaMock.leagueChatMessage.update).not.toHaveBeenCalled()
  })

  it('accepts a vote before the deadline', async () => {
    const { POST } = await import(ROUTE)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue(
      pollRow([{ id: 'a', text: 'x', votes: [] }], {
        closeAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    )

    expect((await POST(voteReq({ optionId: 'a' }), ctx)).status).toBe(200)
  })

  it('refuses a vote on a poll somebody closed', async () => {
    const { POST } = await import(ROUTE)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue(
      pollRow([{ id: 'a', text: 'x', votes: [] }], { closed: true }),
    )

    expect((await POST(voteReq({ optionId: 'a' }), ctx)).status).toBe(409)
  })

  /*
   * `allowMultiple` was stored and ignored too: a poll whose author chose
   * multi-choice behaved as single-choice.
   */
  it('keeps other choices on a multi-choice poll', async () => {
    const { POST } = await import(ROUTE)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue(
      pollRow(
        [
          { id: 'a', text: 'Chiefs', votes: ['u1'] },
          { id: 'b', text: 'Bills', votes: [] },
        ],
        { allowMultiple: true },
      ),
    )

    await POST(voteReq({ optionId: 'b' }), ctx)

    const options = writtenOptions()
    expect(options[0].votes).toEqual(['u1'])
    expect(options[1].votes).toEqual(['u1'])
  })

  it('still withdraws a repeated choice on a multi-choice poll', async () => {
    const { POST } = await import(ROUTE)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue(
      pollRow([{ id: 'a', text: 'Chiefs', votes: ['u1', 'u2'] }], { allowMultiple: true }),
    )

    await POST(voteReq({ optionId: 'a' }), ctx)

    expect(writtenOptions()[0].votes).toEqual(['u2'])
  })
})
