import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The hub's mentions list searched `mentionedUserIds` for the reader's id while league chat stored
 * typed usernames — so it was always empty. New rows hold ids; rows from before the fix are matched by
 * the reader's username. Privacy is unchanged: a private @chimmy row is only the asker's.
 */

const m = vi.hoisted(() => ({
  appUser: { findUnique: vi.fn() },
  leagueChatMessage: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: m }))

import { readMentions } from '@/lib/core-app/formatHubs'

beforeEach(() => {
  m.appUser.findUnique.mockReset().mockResolvedValue({ username: 'Casey' })
  m.leagueChatMessage.findMany.mockReset().mockResolvedValue([])
})

describe('readMentions', () => {
  it('matches the reader by id AND by username (old rows), keeping the private-row rule', async () => {
    await readMentions('u1', [{ id: 'L1', name: 'KBFL' }])
    const where = m.leagueChatMessage.findMany.mock.calls[0]![0].where
    expect(where.leagueId).toEqual({ in: ['L1'] })
    expect(where.AND[0].OR).toEqual([
      { mentionedUserIds: { has: 'u1' } },
      { mentionedUserIds: { has: 'Casey' } },
      { mentionedUserIds: { has: 'casey' } },
    ])
    expect(where.OR).toEqual([{ isPrivate: false }, { visibleToUserId: 'u1' }])
  })

  it('still reads by id when the username lookup fails', async () => {
    m.appUser.findUnique.mockRejectedValue(new Error('db down'))
    await readMentions('u1', [{ id: 'L1', name: 'KBFL' }])
    expect(m.leagueChatMessage.findMany.mock.calls[0]![0].where.AND[0].OR).toEqual([{ mentionedUserIds: { has: 'u1' } }])
  })
})
