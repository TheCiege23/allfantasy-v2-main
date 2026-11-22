// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  leagueAwardBallot: { createMany: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
  leagueChatMessage: { create: vi.fn() },
  sportsDataCache: { createMany: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  platformChatMessage: { findUnique: vi.fn(), createMany: vi.fn() },
  platformChatThread: { update: vi.fn() },
  leagueTeam: { findMany: vi.fn() },
  redraftLeagueMember: { findMany: vi.fn() },
  roster: { findMany: vi.fn() },
  teamCoOwner: { findMany: vi.fn() },
  appUser: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: m }))
const access = vi.hoisted(() => ({ member: vi.fn(), dm: vi.fn() }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: access.member }))
vi.mock('@/lib/chat-notifications/tradeOfferDm', () => ({ findOrCreateDirectThread: access.dm }))

import { publishAwardBallot, relayAwardBallotDms, updateAwardBallot } from '@/lib/league-chat/awardBallotService'

const input = {
  leagueId: 'league-1', userId: 'commish', name: 'Player of the Year', choices: ['A', 'B'],
  requestId: 'fde939eb-34df-4fd1-9bd2-e3827f029405', closeAt: '2099-01-01T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  m.$transaction.mockImplementation((run) => run(m))
  m.leagueAwardBallot.createMany.mockResolvedValue({ count: 1 })
  m.leagueTeam.findMany.mockResolvedValue([{ claimedByUserId: 'manager-1' }])
  m.redraftLeagueMember.findMany.mockResolvedValue([{ userId: 'manager-1' }])
  m.roster.findMany.mockResolvedValue([])
  m.teamCoOwner.findMany.mockResolvedValue([])
  m.appUser.findMany.mockResolvedValue([{ id: 'manager-1' }])
})

describe('publishing and updating award ballots', () => {
  it('publishes a Fantrax ballot to AF league chat and keeps private vote data separate', async () => {
    m.league.findUnique.mockResolvedValue({ id: input.leagueId, name: 'Fantrax league', season: 2026, platform: 'fantrax' })
    const created = await publishAwardBallot(input)
    expect(created?.href).toContain('/league/league-1/awards/')
    expect(m.leagueChatMessage.create.mock.calls[0]?.[0].data).not.toHaveProperty('metadata')
    expect(m.leagueAwardBallot.createMany.mock.calls[0]?.[0].data.data.awardBallot.votes).toEqual([])
    expect(m.sportsDataCache.createMany).not.toHaveBeenCalled()
  })

  it('queues one DM per linked manager when native, with retry-safe publication', async () => {
    m.league.findUnique.mockResolvedValue({ id: input.leagueId, name: 'Native league', season: 2026, platform: 'allfantasy' })
    const created = await publishAwardBallot(input)
    expect(m.sportsDataCache.createMany.mock.calls[0]?.[0].data).toEqual([
      expect.objectContaining({ data: { leagueId: 'league-1', ballotId: created?.id, recipient: 'manager-1' } }),
    ])
    m.leagueAwardBallot.createMany.mockResolvedValue({ count: 0 })
    expect(await publishAwardBallot(input)).toEqual(created)
    expect(m.sportsDataCache.createMany).toHaveBeenCalledTimes(1)
    expect(m.leagueChatMessage.create).toHaveBeenCalledTimes(1)
  })

  it('delivers the chosen options through one private thread and skips an already-delivered message', async () => {
    const queue = { cacheKey: 'award-dm:v1:ballot-1:manager-1',
      data: { leagueId: input.leagueId, ballotId: 'ballot-1', recipient: 'manager-1' } }
    m.sportsDataCache.findMany.mockResolvedValue([queue])
    m.league.findUnique.mockResolvedValue({ platform: 'allfantasy' })
    m.leagueAwardBallot.findFirst.mockResolvedValue({ createdByUserId: input.userId, data: { awardBallot: {
      name: input.name, season: 2026, closeAt: input.closeAt,
      options: [{ id: '1', label: 'Choice A' }, { id: '2', label: 'Choice B' }], votes: [],
    } } })
    access.member.mockResolvedValue({ isMember: true })
    access.dm.mockResolvedValue({ threadId: 'private-1' })
    m.platformChatMessage.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'existing' })
    m.platformChatMessage.createMany.mockResolvedValue({ count: 1 })

    expect(await relayAwardBallotDms()).toEqual({ processed: 1, done: 1 })
    expect(access.dm).toHaveBeenCalledWith('commish', 'manager-1')
    expect(m.platformChatMessage.createMany.mock.calls[0]?.[0]).toMatchObject({
      data: { threadId: 'private-1', body: expect.stringContaining('• Choice A\n• Choice B') },
      skipDuplicates: true,
    })
    expect(await relayAwardBallotDms()).toEqual({ processed: 1, done: 1 })
    expect(m.platformChatMessage.createMany).toHaveBeenCalledTimes(1)
  })

  it('locks the matching league ballot row before changing a vote', async () => {
    m.$queryRaw.mockResolvedValue([{ data: { awardBallot: {
      name: input.name, season: 2026, closeAt: input.closeAt,
      options: [{ id: '1', label: 'A' }, { id: '2', label: 'B' }],
      votes: [{ userId: 'previous', optionId: '2' }],
    } } }])
    expect(await updateAwardBallot(input.leagueId, 'ballot-1', { userId: 'new', optionId: '1' })).toEqual({ ok: true })
    expect(m.$queryRaw.mock.calls[0]?.[0].join('')).toContain('FOR UPDATE')
    expect(m.$queryRaw.mock.calls[0]?.slice(1)).toEqual(['ballot-1', input.leagueId])
    expect(m.leagueAwardBallot.update.mock.calls[0]?.[0].data.data.awardBallot.votes).toEqual([
      { userId: 'previous', optionId: '2' }, { userId: 'new', optionId: '1' },
    ])
  })
})
