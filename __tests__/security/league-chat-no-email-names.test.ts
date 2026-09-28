import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * League chat must never show a member's email as their name. The sender name fell back to the
 * account's email when it had no display name, so every league member — and, through the Discord
 * relay, everyone in the league's Discord — could read it.
 */

const { findMany, create } = vi.hoisted(() => ({ findMany: vi.fn(), create: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: { leagueChatMessage: { findMany, create } },
}))

import { createLeagueChatMessage, getLeagueChatMessages } from '@/lib/league-chat/LeagueChatMessageService'

const EMAIL = 'someone.private@example.test'

function row(user: Record<string, unknown>) {
  return {
    id: 'm1', leagueId: 'l1', message: 'hi', type: 'text', imageUrl: null, metadata: null, source: null,
    createdAt: new Date('2026-09-25T12:00:00Z'), isPrivate: false, visibleToUserId: null, messageSubtype: null,
    mentionedUserIds: [], globalBroadcastId: null, parentMessageId: null, userId: 'u1',
    user: { id: 'u1', avatarUrl: null, profile: null, ...user },
  }
}

beforeEach(() => {
  findMany.mockReset()
  create.mockReset()
})

describe('league chat sender names', () => {
  it('🛑 never reads the email column at all', async () => {
    findMany.mockResolvedValue([])
    await getLeagueChatMessages('l1', { limit: 10 })
    const select = findMany.mock.calls[0][0].include.user.select
    expect(select).not.toHaveProperty('email')
    expect(select).toMatchObject({ displayName: true, username: true })
  })

  it('display name, then username, then "Manager" — even if a row somehow carries an email', async () => {
    findMany.mockResolvedValue([
      row({ displayName: 'Casey', username: 'casey', email: EMAIL }),
      row({ displayName: null, username: 'casey99', email: EMAIL }),
      row({ displayName: null, username: null, email: EMAIL }),
    ])
    const out = await getLeagueChatMessages('l1', { limit: 10 })
    // The service returns oldest-first; order is not what this pins.
    expect(out.map((m) => m.senderName).sort()).toEqual(['Casey', 'Manager', 'casey99'])
    expect(JSON.stringify(out)).not.toContain(EMAIL)
  })

  it('the message a send returns (and the Discord relay copies) carries no email either', async () => {
    create.mockResolvedValue(row({ displayName: null, username: null, email: EMAIL }))
    const created = await createLeagueChatMessage('l1', 'u1', 'hi', {})
    expect(created?.senderName).toBe('Manager')
    expect(JSON.stringify(created)).not.toContain(EMAIL)
    expect(create.mock.calls[0][0].include.user.select).not.toHaveProperty('email')
  })
})
