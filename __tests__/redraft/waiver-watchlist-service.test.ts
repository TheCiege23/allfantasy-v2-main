import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prisma } = vi.hoisted(() => ({
  prisma: {
    waiverWatchlist: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma }))

import { addToWatchlist, getWatchlistPlayerIds, removeFromWatchlist, mergeWatchlist } from '@/lib/waiver-wire/watchlist-service'

describe('waiver watchlist service (Step 3C)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.waiverWatchlist.upsert.mockResolvedValue({ id: 'w1' })
    prisma.waiverWatchlist.deleteMany.mockResolvedValue({ count: 1 })
  })

  it('getWatchlistPlayerIds returns ordered playerIds for the league+user', async () => {
    prisma.waiverWatchlist.findMany.mockResolvedValue([{ playerId: 'p1' }, { playerId: 'p2' }])
    const ids = await getWatchlistPlayerIds('L', 'U')
    expect(ids).toEqual(['p1', 'p2'])
    expect(prisma.waiverWatchlist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: 'L', userId: 'U' }, orderBy: { createdAt: 'asc' } }),
    )
  })

  /*
   * 🛑 THE WRITE MUST NOT ASK FOR COLUMNS PRODUCTION DOES NOT HAVE.
   *
   * `schema.prisma` declares `playerName`, `position` and `team` on this model —
   * each with a literal `// <- ADD THIS` comment — and production has NONE of
   * them: `waiver_watchlists` there is id, leagueId, userId, playerId, sport,
   * createdAt. Code shipped ahead of its migration, which does NOT no-op: a
   * generated client that knows about absent columns raises P2022.
   *
   * Prisma returns every scalar field unless told otherwise, so an unselected
   * upsert reads the three missing ones and throws. This was the ONLY call in
   * the service without a `select`, and it is why `waiver_watchlists` held zero
   * rows: every add, from the waiver page and from the player card alike, had
   * been 500ing in production. Observed live 2026-09-08 as two
   * `POST /api/core/player-card/watch -> 500`, P2022, column
   * `waiver_watchlists.playerName`.
   *
   * The service never writes those three columns, so narrowing the select is
   * the correct fix rather than a workaround — and it needs no migration.
   */
  it('asks only for `id` back, so a column production lacks cannot break the write', async () => {
    await addToWatchlist('L', 'U', 'p1', 'NFL')
    const arg = prisma.waiverWatchlist.upsert.mock.calls[0][0]
    expect(arg.select).toEqual({ id: true })
    // and it must never try to WRITE the drifted columns either
    expect(Object.keys(arg.create)).not.toContain('playerName')
    expect(Object.keys(arg.create)).not.toContain('position')
    expect(Object.keys(arg.create)).not.toContain('team')
  })

  it('addToWatchlist upserts by the composite key and ignores blanks', async () => {
    await addToWatchlist('L', 'U', 'p1', 'NFL')
    expect(prisma.waiverWatchlist.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId_userId_playerId: { leagueId: 'L', userId: 'U', playerId: 'p1' } } }),
    )
    await addToWatchlist('L', 'U', '   ')
    expect(prisma.waiverWatchlist.upsert).toHaveBeenCalledTimes(1) // blank skipped
  })

  it('removeFromWatchlist deletes the matching row', async () => {
    await removeFromWatchlist('L', 'U', 'p1')
    expect(prisma.waiverWatchlist.deleteMany).toHaveBeenCalledWith({ where: { leagueId: 'L', userId: 'U', playerId: 'p1' } })
  })

  it('mergeWatchlist de-dupes and upserts each unique id', async () => {
    const n = await mergeWatchlist('L', 'U', ['p1', 'p1', 'p2', '  '], 'NFL')
    expect(n).toBe(2)
    expect(prisma.waiverWatchlist.upsert).toHaveBeenCalledTimes(2)
  })
})
