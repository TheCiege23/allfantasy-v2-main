import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolvePlatformUserMock = vi.fn()
const resolveLeagueAccessMock = vi.fn()

const prismaMock = {
  leagueChatMessage: { findUnique: vi.fn(), update: vi.fn() },
  redraftMatchup: { findUnique: vi.fn() },
}

vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: resolvePlatformUserMock }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: resolveLeagueAccessMock }))
vi.mock('@/lib/platform/chat-service', () => ({ votePollMessage: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/chat-core', () => ({
  isLeagueVirtualRoom: (id: string) => id.startsWith('league:'),
  getLeagueIdFromVirtualRoom: (id: string) => id.replace(/^league:/, ''),
}))

const ROUTE = '../../app/api/shared/chat/threads/[threadId]/messages/[messageId]/vote/route'
const ctx = { params: { threadId: 'league:l1', messageId: 'predpoll_mu1' } } as never
const vote = (optionId: string) =>
  new Request('http://localhost/vote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ optionId }),
  }) as never

function row(extra: Record<string, unknown> = {}, votes: [string[], string[]] = [[], []]) {
  return {
    id: 'predpoll_mu1',
    leagueId: 'l1',
    metadata: {
      poll: {
        question: 'Week 5: who wins Hawks vs Owls?',
        options: [
          { id: 'home-rH', text: 'Hawks', votes: votes[0] },
          { id: 'away-rA', text: 'Owls', votes: votes[1] },
        ],
        allowMultiple: false,
        prediction: { kind: 'matchup', matchupId: 'mu1', season: 2026, week: 5, optionIds: { home: 'home-rH', away: 'away-rA' } },
        ...extra,
      },
    },
  }
}
const written = () => prismaMock.leagueChatMessage.update.mock.calls[0][0].data.metadata.poll.options

beforeEach(() => {
  vi.clearAllMocks()
  resolvePlatformUserMock.mockResolvedValue({ appUserId: 'u1' })
  resolveLeagueAccessMock.mockResolvedValue({ leagueId: 'l1', isCommissioner: false })
  prismaMock.leagueChatMessage.update.mockResolvedValue({})
  prismaMock.redraftMatchup.findUnique.mockResolvedValue({ leagueId: 'l1', status: 'scheduled' })
})

describe('voting on a prediction poll', () => {
  it('records a pick before kickoff', async () => {
    const { POST } = await import(ROUTE)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue(row())
    const res = await POST(vote('home-rH'), ctx)
    expect(res.status).toBe(200)
    expect(written()[0].votes).toEqual(['u1'])
  })

  it('changing the pick moves the vote, never doubles it', async () => {
    const { POST } = await import(ROUTE)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue(row({}, [['u1'], []]))
    await POST(vote('away-rA'), ctx)
    expect(written()[0].votes).toEqual([])
    expect(written()[1].votes).toEqual(['u1'])
  })

  it('refuses a pick once the matchup has started scoring, whatever closeAt says', async () => {
    const { POST } = await import(ROUTE)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue(row())
    prismaMock.redraftMatchup.findUnique.mockResolvedValue({ leagueId: 'l1', status: 'active' })
    const res = await POST(vote('home-rH'), ctx)
    expect(res.status).toBe(409)
    expect(prismaMock.leagueChatMessage.update).not.toHaveBeenCalled()
  })

  it('refuses a vote after close — by deadline and by hand', async () => {
    const { POST } = await import(ROUTE)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue(row({ closeAt: '2020-01-01T00:00:00Z' }))
    expect((await POST(vote('home-rH'), ctx)).status).toBe(409)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue(row({ closed: true }))
    expect((await POST(vote('home-rH'), ctx)).status).toBe(409)
    expect(prismaMock.leagueChatMessage.update).not.toHaveBeenCalled()
  })

  it('a non-member cannot vote', async () => {
    const { POST } = await import(ROUTE)
    resolveLeagueAccessMock.mockResolvedValue(null)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue(row())
    expect((await POST(vote('home-rH'), ctx)).status).toBe(403)
    expect(prismaMock.leagueChatMessage.update).not.toHaveBeenCalled()
  })
})
