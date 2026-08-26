import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  teamFindMany: vi.fn(),
  teamFindFirst: vi.fn(),
  factFindMany: vi.fn(),
  cacheFindUnique: vi.fn(),
  cacheUpsert: vi.fn(),
  createThread: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: h.teamFindMany, findFirst: h.teamFindFirst },
    matchupFact: { findMany: h.factFindMany },
    sportsDataCache: { findUnique: h.cacheFindUnique, upsert: h.cacheUpsert },
  },
}))
vi.mock('@/lib/platform/chat-service', () => ({ createPlatformThread: h.createThread }))

import { ensureMatchupThreadsForUser } from '@/lib/chat-core/matchupThreads'

const WEEK = { season: 2026, week: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  h.teamFindMany.mockResolvedValue([{ leagueId: 'l1', externalId: '1' }])
  h.factFindMany.mockResolvedValue([{ leagueId: 'l1', teamA: '1', teamB: '2' }])
  h.teamFindFirst.mockResolvedValue({
    claimedByUserId: 'u2',
    ownerName: 'Jordan',
    teamName: 'Team Jordan',
  })
  h.cacheFindUnique.mockResolvedValue(null)
  h.cacheUpsert.mockResolvedValue({})
  h.createThread.mockResolvedValue({ id: 'thread-1' })
})

describe('matchup threads', () => {
  it('creates a room for this week’s opponent', async () => {
    const out = await ensureMatchupThreadsForUser('u1', WEEK)

    expect(out).toMatchObject({ created: 1 })
    expect(h.createThread.mock.calls[0][0]).toMatchObject({
      creatorUserId: 'u1',
      threadType: 'group',
      memberUserIds: ['u2'],
    })
  })

  it('names the room after the opponent and week', async () => {
    await ensureMatchupThreadsForUser('u1', WEEK)
    expect(h.createThread.mock.calls[0][0].title).toBe('Week 1 · Team Jordan')
  })

  /*
   * `platformUserId` holds the PROVIDER's user id: 1,044 teams carry one and 13
   * of those are real app users. Pairing on it would put strangers in a room.
   */
  it('finds the viewer’s teams by the real ownership link only', async () => {
    await ensureMatchupThreadsForUser('u1', WEEK)
    expect(h.teamFindMany.mock.calls[0][0].where).toEqual({ claimedByUserId: 'u1' })
  })

  it('skips a matchup whose opponent is not an AllFantasy user', async () => {
    h.teamFindFirst.mockResolvedValue({ claimedByUserId: null, ownerName: 'Ghost', teamName: 'Ghost' })

    const out = await ensureMatchupThreadsForUser('u1', WEEK)

    expect(out).toMatchObject({ created: 0, unclaimed: 1 })
    expect(h.createThread).not.toHaveBeenCalled()
  })

  it('does not pair somebody with themselves', async () => {
    h.teamFindFirst.mockResolvedValue({ claimedByUserId: 'u1', ownerName: 'Me', teamName: 'Me' })

    const out = await ensureMatchupThreadsForUser('u1', WEEK)

    expect(out).toMatchObject({ created: 0, unclaimed: 1 })
  })

  /* Reopening the list every few seconds must not create a room every time. */
  it('reuses a room it already made', async () => {
    h.cacheFindUnique.mockResolvedValue({ data: { threadId: 'thread-1' } })

    const out = await ensureMatchupThreadsForUser('u1', WEEK)

    expect(out).toMatchObject({ existing: 1, created: 0 })
    expect(h.createThread).not.toHaveBeenCalled()
  })

  it('keys a pairing the same way whichever side is listed first', async () => {
    await ensureMatchupThreadsForUser('u1', WEEK)
    const keyA = h.cacheUpsert.mock.calls[0][0].where.cacheKey

    vi.clearAllMocks()
    h.teamFindMany.mockResolvedValue([{ leagueId: 'l1', externalId: '2' }])
    h.factFindMany.mockResolvedValue([{ leagueId: 'l1', teamA: '2', teamB: '1' }])
    h.teamFindFirst.mockResolvedValue({ claimedByUserId: 'u2', ownerName: 'X', teamName: 'X' })
    h.cacheFindUnique.mockResolvedValue(null)
    h.createThread.mockResolvedValue({ id: 'thread-1' })

    await ensureMatchupThreadsForUser('u1', WEEK)

    expect(h.cacheUpsert.mock.calls[0][0].where.cacheKey).toBe(keyA)
  })

  it('ignores matchups the viewer is not in', async () => {
    h.factFindMany.mockResolvedValue([{ leagueId: 'l1', teamA: '7', teamB: '8' }])

    expect(await ensureMatchupThreadsForUser('u1', WEEK)).toMatchObject({ created: 0, unclaimed: 0 })
  })

  it('does nothing for somebody who owns no team', async () => {
    h.teamFindMany.mockResolvedValue([])

    expect(await ensureMatchupThreadsForUser('u1', WEEK)).toMatchObject({ created: 0 })
    expect(h.factFindMany).not.toHaveBeenCalled()
  })

  it('ignores a signed-out visitor or a nonsense week', async () => {
    expect(await ensureMatchupThreadsForUser(null, WEEK)).toMatchObject({ created: 0 })
    expect(await ensureMatchupThreadsForUser('u1', { season: NaN, week: 1 })).toMatchObject({ created: 0 })
    expect(h.teamFindMany).not.toHaveBeenCalled()
  })

  /* A thread list that failed because a room could not be made would be worse. */
  it('never throws when the database is unhappy', async () => {
    h.factFindMany.mockRejectedValue(new Error('db down'))

    expect(await ensureMatchupThreadsForUser('u1', WEEK)).toMatchObject({ created: 0 })
  })

  it('does not index a thread that failed to create', async () => {
    h.createThread.mockResolvedValue(null)

    const out = await ensureMatchupThreadsForUser('u1', WEEK)

    expect(out).toMatchObject({ created: 0 })
    expect(h.cacheUpsert).not.toHaveBeenCalled()
  })
})
