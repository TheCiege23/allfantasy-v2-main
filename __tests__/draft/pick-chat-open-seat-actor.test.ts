/**
 * A pick card must reach draft chat whoever — or whatever — made the pick.
 *
 * An open or CPU seat's roster is owned by `open-slot-<leagueId>-<n>`, which is not a user, so
 * posting as the seat's owner failed `league_chat_messages_userId_fkey` and the fire-and-forget
 * caller swallowed it: on a 10-team test draft with one claimed seat, 135 of 150 pick cards never
 * reached draft chat. The actor must be the first REAL user among picker, seat owner, league owner.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  createMessage: vi.fn(async () => ({ id: 'msg-1' })),
  rosterOwner: 'open-slot-L1-3' as string | null,
  realUsers: ['commish-1', 'manager-7'],
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findFirst: vi.fn(async () => ({ platformUserId: m.rosterOwner })) },
    league: { findUnique: vi.fn(async () => ({ userId: 'commish-1' })) },
    appUser: {
      findMany: vi.fn(async (args: { where: { id: { in: string[] } } }) =>
        args.where.id.in.filter((id) => m.realUsers.includes(id)).map((id) => ({ id })),
      ),
    },
  },
}))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({ createLeagueChatMessage: m.createMessage }))

import { postDraftPickChatEvent } from '@/lib/draft-room/postDraftPickChatEvent'

const pick = {
  leagueId: 'L1',
  rosterId: 'r3',
  playerName: 'Test Player',
  position: 'WR',
  rosterDisplayName: 'Open Team 3',
  overall: 23,
  pickLabel: '3.03',
}

beforeEach(() => {
  vi.clearAllMocks()
  m.rosterOwner = 'open-slot-L1-3'
})

describe('pick card actor', () => {
  it('an open seat\'s autopick is posted as the league owner, not the open-slot id', async () => {
    await postDraftPickChatEvent({ ...pick, madeByUserId: null, aiManager: true })
    expect(m.createMessage).toHaveBeenCalledTimes(1)
    expect(m.createMessage.mock.calls[0][1]).toBe('commish-1')
  })

  it('a claimed seat is still posted as its manager', async () => {
    m.rosterOwner = 'manager-7'
    await postDraftPickChatEvent({ ...pick, madeByUserId: null })
    expect(m.createMessage.mock.calls[0][1]).toBe('manager-7')
  })

  it('the person who made the pick comes first', async () => {
    m.rosterOwner = 'manager-7'
    await postDraftPickChatEvent({ ...pick, madeByUserId: 'commish-1', commissionerOverride: true })
    expect(m.createMessage.mock.calls[0][1]).toBe('commish-1')
  })

  it('posts nothing when no candidate is a real user', async () => {
    m.realUsers = []
    await postDraftPickChatEvent({ ...pick, madeByUserId: null })
    expect(m.createMessage).not.toHaveBeenCalled()
    m.realUsers = ['commish-1', 'manager-7']
  })
})
