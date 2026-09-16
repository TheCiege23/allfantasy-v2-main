import { beforeEach, describe, expect, it, vi } from 'vitest'

const leagueFindUnique = vi.fn()
const leagueFindFirst = vi.fn()
const cacheDeleteMany = vi.fn(async () => ({ count: 0 }))
const getLeagueStandings = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: (...a: unknown[]) => leagueFindUnique(...a),
      findFirst: (...a: unknown[]) => leagueFindFirst(...a),
    },
    sportsDataCache: {
      findUnique: async () => null,
      upsert: async () => ({}),
      delete: async () => ({}),
      deleteMany: (...a: unknown[]) => cacheDeleteMany(...a),
    },
  },
}))

vi.mock('@/lib/core-app/leagueStandings', () => ({
  getLeagueStandings: (...a: unknown[]) => getLeagueStandings(...a),
}))

const { readLeagueStandingsSummary, invalidateLeagueStandings, STANDINGS_SCREEN } = await import(
  '@/lib/core-app/leagueStandingsSummary'
)
const { __resetLayeredCacheForTests } = await import('@/lib/sports-os/layeredCache')
const { getScreenSummaryDefinition } = await import('@/lib/sports-os/summaries')

const BOARD = { available: true, teams: [{ rosterId: '1' }] }

describe('leagueStandingsSummary', () => {
  beforeEach(() => {
    __resetLayeredCacheForTests()
    leagueFindUnique.mockReset()
    leagueFindFirst.mockReset()
    cacheDeleteMany.mockClear()
    getLeagueStandings.mockReset()
    leagueFindUnique.mockResolvedValue({ platformLeagueId: 'sleeper_999', season: 2026 })
    leagueFindFirst.mockResolvedValue({ id: 'af-uuid-1' })
    getLeagueStandings.mockResolvedValue(BOARD)
  })

  it('registers itself on import, so no caller has to remember an init step', () => {
    const definition = getScreenSummaryDefinition(STANDINGS_SCREEN)
    expect(definition).not.toBeNull()
    expect(definition!.ttlMs).toBeGreaterThan(0)
    expect(definition!.staleWhileRevalidateMs).toBeGreaterThan(definition!.ttlMs)
  })

  it('builds the board on a miss and hands back a timestamped envelope', async () => {
    const entry = await readLeagueStandingsSummary('af-uuid-1', 'user-1')
    expect(entry).toMatchObject({ data: BOARD, source: 'live' })
    expect(entry!.fetchedAt).toBeGreaterThan(0)
    expect(getLeagueStandings).toHaveBeenCalledWith('af-uuid-1', 'user-1')
  })

  it('serves the second read from cache without rebuilding', async () => {
    await readLeagueStandingsSummary('af-uuid-1', 'user-1')
    const second = await readLeagueStandingsSummary('af-uuid-1', 'user-1')
    expect(second!.source).toBe('cache')
    expect(getLeagueStandings).toHaveBeenCalledTimes(1)
  })

  it('does not share a board between two members of one league', async () => {
    // `isYou`, `you`, `trend` and `recent` are all per-user. Sharing an entry across members would
    // show one manager another manager's season as their own.
    await readLeagueStandingsSummary('af-uuid-1', 'user-1')
    await readLeagueStandingsSummary('af-uuid-1', 'user-2')
    expect(getLeagueStandings).toHaveBeenCalledTimes(2)
  })

  it('does not share a board between two seasons of one platform league', async () => {
    // 🛑 The board carries the league's display NAME from the AF row. Without the season in the key,
    // two AF leagues sharing a platform id across seasons collide and one renders the other's name.
    await readLeagueStandingsSummary('af-uuid-1', 'user-1')
    leagueFindUnique.mockResolvedValue({ platformLeagueId: 'sleeper_999', season: 2025 })
    await readLeagueStandingsSummary('af-uuid-old', 'user-1')
    expect(getLeagueStandings).toHaveBeenCalledTimes(2)
  })

  it('keys the cache on the PLATFORM id, so the sync can invalidate without a lookup', async () => {
    await readLeagueStandingsSummary('af-uuid-1', 'user-1')

    // The sync holds only `connection.externalLeagueId`. If the key were our UUID, this sweep would
    // need an unindexed scan of League — platformLeagueId has no standalone index.
    await invalidateLeagueStandings('sleeper_999')
    await readLeagueStandingsSummary('af-uuid-1', 'user-1')
    expect(getLeagueStandings).toHaveBeenCalledTimes(2)

    expect(cacheDeleteMany).toHaveBeenCalledWith({
      where: { cacheKey: { startsWith: expect.stringContaining('l=sleeper_999&') } },
    })
  })

  it('returns null when the league row cannot be read, matching what the page already handles', async () => {
    leagueFindUnique.mockResolvedValue(null)
    expect(await readLeagueStandingsSummary('gone', 'user-1')).toBeNull()

    leagueFindUnique.mockResolvedValue({ platformLeagueId: null, season: 2026 })
    expect(await readLeagueStandingsSummary('no-pid', 'user-1')).toBeNull()

    expect(getLeagueStandings).not.toHaveBeenCalled()
  })

  it('degrades to an unavailable board when the league is no longer connected', async () => {
    // Reachable: disconnected between the read and a background rebuild. `available: false` is the
    // shape the screen already renders, so this does not throw inside a Suspense boundary.
    leagueFindFirst.mockResolvedValue(null)
    const entry = await readLeagueStandingsSummary('af-uuid-1', 'user-1')
    expect(entry!.data).toMatchObject({ available: false })
    expect(getLeagueStandings).not.toHaveBeenCalled()
  })

  it('never throws out of an invalidation, and is a no-op for a blank id', async () => {
    // Failing a league sync that has already done its real work, to report a cache miss, would be
    // strictly worse than one TTL of staleness on a board that renders its own age.
    cacheDeleteMany.mockRejectedValueOnce(new Error('db down'))
    await expect(invalidateLeagueStandings('sleeper_999')).resolves.toBeTypeOf('number')
    await expect(invalidateLeagueStandings('')).resolves.toBe(0)
  })
})
