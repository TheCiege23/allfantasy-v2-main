import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  roster: { findMany: vi.fn() },
  jurySession: { findUnique: vi.fn(), upsert: vi.fn() },
  survivorPlayer: { findUnique: vi.fn(), updateMany: vi.fn() },
  survivorChatChannel: { findFirst: vi.fn() },
  survivorChatMessage: { create: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { recordCrownedWinner } from '@/lib/survivor/SurvivorFinaleEngine'

const crowned = {
  open: false, closed: true, finalists: ['r1', 'r2', 'r3'], juryRosterIds: ['j1', 'j2'], votes: [], votesSubmitted: 2, votesRequired: 2,
  pendingJuryRosterIds: [], voteCount: { r2: 2 }, bonusVotesByFinalist: {}, winnerRosterId: 'r2', crownedAt: '2027-04-13T02:00:00.000Z', tieBreakSeasonPoints: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  db.roster.findMany.mockResolvedValue(['r1', 'r2', 'r3', 'j1', 'j2'].map(id => ({ id, platformUserId: `u-${id}` })))
  db.jurySession.findUnique.mockResolvedValue(null)
  db.survivorPlayer.findUnique.mockResolvedValue({ displayName: 'Jordan' })
  db.survivorChatChannel.findFirst.mockResolvedValue({ id: 'league-chat' })
})

describe('crowning the Sole Survivor', () => {
  it('mirrors the counted winner onto the jury session and cast, by real name, and announces once', async () => {
    expect(await recordCrownedWinner('league', crowned as never)).toEqual({ winnerUserId: 'u-r2' })
    expect(db.jurySession.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({
      winnerId: 'u-r2', winnerName: 'Jordan', finalistUserIds: ['u-r1', 'u-r2', 'u-r3'], jurorUserIds: ['u-j1', 'u-j2'], status: 'winner_revealed',
    }) }))
    expect(db.survivorPlayer.updateMany).toHaveBeenCalledWith({ where: { leagueId: 'league', userId: 'u-r2' }, data: { playerState: 'survivor_winner' } })
    expect(db.survivorChatMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ content: 'The jury has spoken. Jordan is the Sole Survivor.' }) }))
    db.jurySession.findUnique.mockResolvedValue({ winnerId: 'u-r2' })
    await recordCrownedWinner('league', crowned as never)
    expect(db.survivorChatMessage.create).toHaveBeenCalledOnce()
  })

  it('does nothing before the jury has finished', async () => {
    expect(await recordCrownedWinner('league', { ...crowned, closed: false, winnerRosterId: null } as never)).toEqual({ winnerUserId: null })
    expect(db.jurySession.upsert).not.toHaveBeenCalled()
  })
})
