/**
 * Survivor chat bridge: every engine post also lands in the chat players read (LeagueChatMessage),
 * mapped to the right `source`, authored the way Chimmy's other posts are, and never twice.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  createSurvivorChatMessage,
  mirrorSurvivorChatMessageToLeagueChat,
  survivorChannelToLeagueChatSource,
  survivorChatMirrorId,
  upsertSurvivorChatMessage,
} from '@/lib/survivor/survivorChatBridge'

function fakeDb(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    survivorChatMessage: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'engine-1', ...args.data })),
      upsert: vi.fn(async (args: { create: Record<string, unknown>; where: { id: string } }) => ({ ...args.create, id: args.where.id })),
    },
    survivorChatChannel: { findUnique: vi.fn(async () => ({ tribeId: 'tribe-a' })) },
    league: { findUnique: vi.fn(async () => ({ userId: 'owner-1' })) },
    leagueChatMessage: { create: vi.fn(async () => ({ id: 'x' })) },
    ...overrides,
  }
}

const host = { leagueId: 'league-1', channelId: 'chan-1', senderUserId: 'survivor-host-chimmy', senderName: 'Chimmy', senderIsHost: true, isSystemMessage: true, content: 'Hello island', contentType: 'host_announcement' }

describe('survivorChannelToLeagueChatSource', () => {
  it('maps league to the league channel, tribe and merge to the tribe source, and nothing else', () => {
    expect(survivorChannelToLeagueChatSource('league', null)).toBeNull()
    expect(survivorChannelToLeagueChatSource('tribe', 'tribe-a')).toBe('tribe_tribe-a')
    expect(survivorChannelToLeagueChatSource('merge', 'merged-1')).toBe('tribe_merged-1')
    expect(survivorChannelToLeagueChatSource('tribe', null)).toBeUndefined()
    expect(survivorChannelToLeagueChatSource('exile', 'tribe-a')).toBeUndefined()
    expect(survivorChannelToLeagueChatSource('jury', null)).toBeUndefined()
  })
})

describe('createSurvivorChatMessage', () => {
  it('writes the engine row and mirrors a league post as Chimmy to every member', async () => {
    const db = fakeDb()
    const created = await createSurvivorChatMessage(db as never, { data: { ...host, channelType: 'league' } })
    expect(created).toMatchObject({ id: 'engine-1' })
    expect(db.survivorChatMessage.create).toHaveBeenCalledTimes(1)
    expect(db.leagueChatMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: survivorChatMirrorId('engine-1'),
        leagueId: 'league-1',
        userId: 'owner-1',
        message: 'Hello island',
        type: 'system',
        source: null,
        isPrivate: false,
        metadata: expect.objectContaining({ chimmy: true, survivorChat: expect.objectContaining({ messageId: 'engine-1', channelType: 'league', contentType: 'host_announcement' }) }),
      }),
    }))
    expect(db.survivorChatChannel.findUnique).not.toHaveBeenCalled()
  })

  it('mirrors a tribe post into that tribe’s huddle source', async () => {
    const db = fakeDb()
    await createSurvivorChatMessage(db as never, { data: { ...host, channelType: 'tribe', cardData: { type: 'sit_out' } } })
    expect(db.survivorChatChannel.findUnique).toHaveBeenCalledWith({ where: { id: 'chan-1' }, select: { tribeId: true } })
    expect(db.leagueChatMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ source: 'tribe_tribe-a', metadata: expect.objectContaining({ survivorChat: expect.objectContaining({ cardData: { type: 'sit_out' } }) }) }),
    }))
  })

  it('mirrors the merge welcome into the merged tribe’s source', async () => {
    const db = fakeDb({ survivorChatChannel: { findUnique: vi.fn(async () => ({ tribeId: 'merged-9' })) } })
    await createSurvivorChatMessage(db as never, { data: { ...host, channelType: 'merge' } })
    expect(db.leagueChatMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ source: 'tribe_merged-9' }) }))
  })

  it('keeps an Exile post on the engine table only (no league-chat surface yet)', async () => {
    const db = fakeDb()
    await createSurvivorChatMessage(db as never, { data: { ...host, channelType: 'exile' } })
    expect(db.survivorChatMessage.create).toHaveBeenCalledTimes(1)
    expect(db.leagueChatMessage.create).not.toHaveBeenCalled()
  })

  it('does not mirror a tribe post whose channel has no tribe', async () => {
    const db = fakeDb({ survivorChatChannel: { findUnique: vi.fn(async () => ({ tribeId: null })) } })
    const outcome = await mirrorSurvivorChatMessageToLeagueChat(db as never, { ...host, channelType: 'tribe', id: 'engine-2' })
    expect(outcome).toEqual({ mirrored: false, reason: 'no_tribe' })
    expect(db.leagueChatMessage.create).not.toHaveBeenCalled()
  })

  it('keeps a human sender as the author, as plain text, without Chimmy’s marker', async () => {
    const db = fakeDb()
    await createSurvivorChatMessage(db as never, { data: { leagueId: 'league-1', channelId: 'chan-1', channelType: 'league', senderUserId: 'user-7', senderName: 'Sam', content: 'gl everyone', contentType: 'text' } })
    const data = db.leagueChatMessage.create.mock.calls[0][0].data
    expect(data).toMatchObject({ userId: 'user-7', type: 'text', source: null })
    expect(data.metadata).not.toHaveProperty('chimmy')
    expect(db.league.findUnique).not.toHaveBeenCalled()
  })

  it('treats a duplicate mirror as already posted and never throws', async () => {
    const db = fakeDb({ leagueChatMessage: { create: vi.fn(async () => { throw Object.assign(new Error('dup'), { code: 'P2002' }) }) } })
    const outcome = await mirrorSurvivorChatMessageToLeagueChat(db as never, { ...host, channelType: 'league', id: 'engine-3' })
    expect(outcome).toEqual({ mirrored: false, reason: 'duplicate' })
  })

  it('rethrows an unexpected database error', async () => {
    const db = fakeDb({ leagueChatMessage: { create: vi.fn(async () => { throw new Error('connection lost') }) } })
    await expect(mirrorSurvivorChatMessageToLeagueChat(db as never, { ...host, channelType: 'league', id: 'engine-4' })).rejects.toThrow('connection lost')
  })
})

describe('upsertSurvivorChatMessage', () => {
  it('mirrors under the engine row id so a repeated upsert posts nothing new', async () => {
    const db = fakeDb()
    await upsertSurvivorChatMessage(db as never, { where: { id: 'survivor-weekly-recap:league-1:3' }, create: { ...host, channelType: 'league', id: 'survivor-weekly-recap:league-1:3' }, update: {} })
    expect(db.survivorChatMessage.upsert).toHaveBeenCalledTimes(1)
    expect(db.leagueChatMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id: survivorChatMirrorId('survivor-weekly-recap:league-1:3') }) }))
  })
})
