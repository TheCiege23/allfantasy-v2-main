import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 A mention reaches the ROOM, never the platform (owner's call 2026-09-25, "fix both security
 * holes now"). The route looked each @name up across every AllFantasy account, so "@mike" in any chat
 * notified and emailed every account called mike. Also: @all in league chat went out twice (the league
 * chat route announces it; this route announced it again), and the "@" badge never lit because DM
 * mentions were never recorded on the message.
 */

vi.mock('server-only', () => ({}))

type Row = { id: string; username: string }
const db = vi.hoisted(() => ({
  users: [] as Row[],
  leagueMembers: [] as string[],
  threadMembers: [] as string[],
  leagueMessage: null as null | {
    id: string
    messageSubtype: string | null
    isPrivate?: boolean
    message?: string
    type?: string
  },
  ownDm: true,
  mutedMembers: [] as string[],
  blockers: [] as string[],
  dispatch: vi.fn(),
  dmUpdate: vi.fn(),
  appUserFindMany: vi.fn(),
}))

vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: async () => ({ appUserId: 'sender' }) }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: db.dispatch }))
vi.mock('@/lib/league-chat/leagueMemberIds', () => ({ getLeagueMemberUserIds: async () => db.leagueMembers }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueChatMessage: { findFirst: async () => db.leagueMessage },
    bracketLeagueMember: { findUnique: async () => null, findMany: async () => [] },
    platformChatThreadMember: {
      findFirst: async ({ where }: { where: { userId: string } }) => (db.threadMembers.includes(where.userId) ? { id: 'm' } : null),
      findMany: async () => db.threadMembers.map((userId) => ({ userId, isMuted: db.mutedMembers.includes(userId) })),
    },
    platformChatMessage: {
      findFirst: async () => (db.ownDm ? { id: 'msg1', body: 'you up @dana?', messageType: 'text', metadata: null } : null),
      update: db.dmUpdate,
    },
    platformBlockedUser: {
      findMany: async ({ where }: { where: { blockerUserId: { in: string[] } } }) =>
        db.blockers.filter((id) => where.blockerUserId.in.includes(id)).map((blockerUserId) => ({ blockerUserId })),
    },
    league: { findUnique: async () => ({ name: 'Cream Bowl' }) },
    appUser: {
      findUnique: async () => ({
        displayName: null,
        username: 'sender',
        email: 'sender@secret.example',
        avatarUrl: 'https://cdn.example/sender.png',
      }),
      // A faithful fake of the query the route makes: filters by id-in-members AND username.
      findMany: db.appUserFindMany,
    },
  },
}))

db.appUserFindMany.mockImplementation(async ({ where }: { where: { id?: { in?: string[]; not?: string }; OR: Array<{ username: { equals: string } }> } }) => {
  const wanted = where.OR.map((o) => o.username.equals.toLowerCase())
  return db.users
    .filter((u) => wanted.includes(u.username.toLowerCase()))
    .filter((u) => (where.id?.in ? where.id.in.includes(u.id) : true))
    .filter((u) => (where.id?.not ? u.id !== where.id.not : true))
    .map((u) => ({ id: u.id }))
})

import { POST } from '@/app/api/shared/chat/mentions/route'

const post = (body: unknown) =>
  POST(new Request('https://x.test/api/shared/chat/mentions', { method: 'POST', body: JSON.stringify(body) }) as never)

const notified = () => db.dispatch.mock.calls.flatMap((c) => (c[0] as { userIds: string[] }).userIds).sort()

beforeEach(() => {
  db.dispatch.mockReset()
  db.dmUpdate.mockReset().mockResolvedValue({})
  db.users = [
    { id: 'mike-in-league', username: 'mike' },
    { id: 'mike-stranger', username: 'Mike' },
    { id: 'dana', username: 'dana' },
    { id: 'sender', username: 'sender' },
  ]
  db.leagueMembers = ['sender', 'mike-in-league', 'dana']
  db.threadMembers = ['sender', 'dana']
  db.leagueMessage = { id: 'msg1', messageSubtype: null, isPrivate: false, message: 'nice trade @dana', type: 'text' }
  db.ownDm = true
  db.mutedMembers = []
  db.blockers = []
})

describe('🛑 who a mention must NOT reach', () => {
  it('a private @chimmy question naming someone notifies nobody — they cannot see it', async () => {
    db.leagueMessage = { id: 'msg1', messageSubtype: null, isPrivate: true, message: '@chimmy should I trade @dana' }
    await post({ threadId: 'league:L1', messageId: 'msg1', mentionedUsernames: ['dana', 'all'] })
    expect(db.dispatch).not.toHaveBeenCalled()
  })

  it('someone who muted the conversation is not pinged by a mention in it', async () => {
    db.mutedMembers = ['dana']
    await post({ threadId: 'thread-1', messageId: 'msg1', mentionedUsernames: ['dana'] })
    expect(db.dispatch).not.toHaveBeenCalled()
  })

  it('someone who blocked the sender is not pinged by a mention', async () => {
    db.blockers = ['dana']
    await post({ threadId: 'league:L1', messageId: 'msg1', mentionedUsernames: ['dana', 'mike'] })
    expect(notified()).toEqual(['mike-in-league'])
  })
})

describe('what a mention says', () => {
  it('names the sender and the league, previews the words, and carries the sender’s face', async () => {
    await post({ threadId: 'league:L1', messageId: 'msg1', mentionedUsernames: ['dana'] })
    const call = db.dispatch.mock.calls[0]![0] as { title: string; body: string; meta: Record<string, unknown> }
    expect(call.title).toBe('sender mentioned you · Cream Bowl')
    expect(call.body).toBe('nice trade @dana')
    expect(call.meta.iconUrl).toBe('https://cdn.example/sender.png')
    expect(call.meta.pushTag).toBe('mention-league:L1')
  })

  it('in a DM it shares the DM alert’s tag, so one message is one buzz', async () => {
    await post({ threadId: 'thread-1', messageId: 'msg1', mentionedUsernames: ['dana'] })
    const call = db.dispatch.mock.calls[0]![0] as { body: string; meta: Record<string, unknown> }
    expect(call.body).toBe('you up @dana?')
    expect(call.meta.pushTag).toBe('dm-thread-1')
  })
})

describe('league chat', () => {
  it('@name reaches only members of that league — never a stranger with the same name', async () => {
    await post({ threadId: 'league:L1', messageId: 'msg1', mentionedUsernames: ['mike'] })
    expect(notified()).toEqual(['mike-in-league'])
  })

  it('a name nobody in the league has reaches nobody', async () => {
    db.leagueMembers = ['sender', 'dana']
    await post({ threadId: 'league:L1', messageId: 'msg1', mentionedUsernames: ['mike'] })
    expect(db.dispatch).not.toHaveBeenCalled()
  })

  it('@all is not announced a second time when the league chat route already did', async () => {
    db.leagueMessage = { id: 'msg1', messageSubtype: 'at_all' }
    await post({ threadId: 'league:L1', messageId: 'msg1', mentionedUsernames: ['all'] })
    expect(db.dispatch).not.toHaveBeenCalled()
  })

  it('@all in a room nothing else announced still reaches every member but the sender', async () => {
    await post({ threadId: 'league:L1', messageId: 'msg1', mentionedUsernames: ['all'] })
    expect(notified()).toEqual(['dana', 'mike-in-league'])
  })

  it('never puts the sender’s email into other people’s notifications, and dedupes per message', async () => {
    await post({ threadId: 'league:L1', messageId: 'msg1', mentionedUsernames: ['dana'] })
    const call = db.dispatch.mock.calls[0]![0] as { body: string; dedupePrefix: string }
    expect(call.body).not.toContain('secret.example')
    expect(call.dedupePrefix).toBe('mention:msg1')
  })
})

describe('DMs and huddles', () => {
  it('@name reaches only members of that conversation', async () => {
    await post({ threadId: 'thread-1', messageId: 'msg1', mentionedUsernames: ['mike', 'dana'] })
    expect(notified()).toEqual(['dana'])
  })

  it('records who was named on the message, so the "@" badge can count it', async () => {
    await post({ threadId: 'thread-1', messageId: 'msg1', mentionedUsernames: ['dana'] })
    expect(db.dmUpdate).toHaveBeenCalledWith({ where: { id: 'msg1' }, data: { mentionedUserIds: ['dana'] } })
  })

  it('refuses a sender who is not in the conversation', async () => {
    const res = await post({ threadId: 'thread-9', messageId: 'msg1', mentionedUsernames: ['dana'] })
    db.threadMembers = ['dana']
    const res2 = await post({ threadId: 'thread-9', messageId: 'msg1', mentionedUsernames: ['dana'] })
    expect(res.status).toBe(200) // sender is a member of the default thread
    expect(res2.status).toBe(403)
    expect(db.dispatch).toHaveBeenCalledTimes(1)
  })
})
