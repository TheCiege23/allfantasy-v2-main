import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findMany, create } = vi.hoisted(() => ({ findMany: vi.fn(), create: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: { leagueChatMessage: { findMany, create } },
}))

import {
  createLeagueChatMessage,
  getLeagueChatMessages,
} from '@/lib/league-chat/LeagueChatMessageService'

const USER = { id: 'u1', displayName: 'Casey', email: null, username: 'casey', avatarUrl: null, profile: null }

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'm2',
    leagueId: 'l1',
    message: 'I disagree',
    type: 'text',
    imageUrl: null,
    metadata: null,
    source: null,
    createdAt: new Date('2026-08-25T12:00:00Z'),
    isPrivate: false,
    visibleToUserId: null,
    messageSubtype: null,
    mentionedUserIds: [],
    globalBroadcastId: null,
    parentMessageId: 'm1',
    user: USER,
    ...over,
  }
}

beforeEach(() => {
  findMany.mockReset()
  create.mockReset()
})

describe('league chat replies', () => {
  /*
   * The column is real and indexed, the write path accepted it, and
   * `PlatformChatMessage` has always declared the field — but the read mapper
   * dropped it, so every reply came back looking like an ordinary message and
   * no surface could render what it was answering.
   */
  it('returns the reply link it stored', async () => {
    findMany.mockResolvedValue([row()])

    const [message] = await getLeagueChatMessages('l1', { limit: 10 })

    expect(message.parentMessageId).toBe('m1')
  })

  it('reports null for a message that answers nothing', async () => {
    findMany.mockResolvedValue([row({ parentMessageId: null })])

    const [message] = await getLeagueChatMessages('l1', { limit: 10 })

    expect(message.parentMessageId).toBeNull()
  })

  it('persists the parent when one is given', async () => {
    create.mockResolvedValue(row({ id: 'm2' }))

    await createLeagueChatMessage('l1', 'u1', 'I disagree', { parentMessageId: 'm1' })

    expect(create.mock.calls[0][0].data.parentMessageId).toBe('m1')
  })

  it('stores null when a message is not a reply', async () => {
    create.mockResolvedValue(row({ id: 'm2', parentMessageId: null }))

    await createLeagueChatMessage('l1', 'u1', 'first', {})

    expect(create.mock.calls[0][0].data.parentMessageId).toBeNull()
  })

  it('still marks a deleted reply deleted', async () => {
    findMany.mockResolvedValue([row({ metadata: { deletedAt: '2026-08-25T13:00:00Z' } })])

    const [message] = await getLeagueChatMessages('l1', { limit: 10 })

    expect(message.body).toBe('[message deleted]')
    expect(message.parentMessageId).toBe('m1')
  })
})
