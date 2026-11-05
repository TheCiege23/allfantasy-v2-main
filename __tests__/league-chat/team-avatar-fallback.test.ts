import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * League chat shows a sender's TEAM avatar in that league when they have no AllFantasy photo
 * (2026-11-05, chat redesign) — their own photo always wins, and a failed lookup costs initials only.
 */

vi.mock('server-only', () => ({}))
/*
 * The spy's implementation is fixed at creation and forwards to `h.next`, which each test sets.
 * Setting a THROWING implementation on the spy itself (mockImplementation / mockRejectedValue) made
 * vitest fail the error-path test even though the helper caught it, returned its empty map and every
 * assertion passed (probed 2026-11-05); an implementation given at creation does not.
 */
const h = vi.hoisted(() => {
  const state = { next: async (_args: unknown): Promise<unknown> => [] }
  return { state, findMany: vi.fn((args: unknown) => state.next(args)) }
})
vi.mock('@/lib/prisma', () => ({ prisma: { leagueTeam: { findMany: h.findMany } } }))

import { teamAvatarFallback } from '@/lib/league-chat/teamAvatarFallback'

beforeEach(() => {
  h.findMany.mockClear()
  h.state.next = async () => []
})

describe('teamAvatarFallback', () => {
  it('looks up only senders with no photo, in this league, and maps them to their team avatar', async () => {
    h.state.next = async () => [{ claimedByUserId: 'u2', avatarUrl: 'https://sleepercdn.com/avatars/abc' }]

    const out = await teamAvatarFallback('L1', [
      { senderUserId: 'u1', senderAvatarUrl: 'https://cdn/u1.png' }, // has a photo: never looked up
      { senderUserId: 'u2', senderAvatarUrl: null },
      { senderUserId: 'u2', senderAvatarUrl: null }, // asked once
      { senderUserId: null, senderAvatarUrl: null }, // a system row
    ])

    expect(out.get('u2')).toBe('https://sleepercdn.com/avatars/abc')
    expect(out.has('u1')).toBe(false)
    expect(h.findMany).toHaveBeenCalledTimes(1)
    expect((h.findMany.mock.calls[0]![0] as { where: unknown }).where).toEqual({
      leagueId: 'L1',
      claimedByUserId: { in: ['u2'] },
      avatarUrl: { not: null },
    })
  })

  it('asks nothing when everyone has a photo', async () => {
    expect((await teamAvatarFallback('L1', [{ senderUserId: 'u1', senderAvatarUrl: 'x' }])).size).toBe(0)
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('costs initials, never the chat, when the lookup fails', async () => {
    h.state.next = async () => {
      throw new Error('db down')
    }
    expect((await teamAvatarFallback('L1', [{ senderUserId: 'u2', senderAvatarUrl: null }])).size).toBe(0)
  })
})
