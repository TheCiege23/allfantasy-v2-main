import { beforeEach, describe, expect, it, vi } from 'vitest'

const getWeekAll = vi.fn()
const getDashboardLeagueListForUser = vi.fn()

vi.mock('@/lib/core-app/weekAll', () => ({ getWeekAll: (...a: unknown[]) => getWeekAll(...a) }))
vi.mock('@/lib/dashboard/get-dashboard-league-list', () => ({
  getDashboardLeagueListForUser: (...a: unknown[]) => getDashboardLeagueListForUser(...a),
}))
vi.mock('@/lib/sports-os/durableTier', () => ({ sportsDataCacheTier: () => null }))

const { readWeekAllSummary, WEEK_SCREEN } = await import('@/lib/core-app/weekAllSummary')
const { __resetLayeredCacheForTests } = await import('@/lib/sports-os/layeredCache')
const { getScreenSummaryDefinition, screensInvalidatedBy } = await import('@/lib/sports-os/summaries')

const BOARD = { rows: [{ leagueId: 'l1' }], season: 2026, week: 3 }

describe('weekAllSummary', () => {
  beforeEach(() => {
    __resetLayeredCacheForTests()
    getWeekAll.mockReset()
    getDashboardLeagueListForUser.mockReset()
    getWeekAll.mockResolvedValue(BOARD)
    getDashboardLeagueListForUser.mockResolvedValue({
      leagues: [
        { id: 'l1', name: 'Bravo', platform: 'sleeper', platformLeagueId: 'p1' },
        { id: 'l2', name: 'Alpha', platform: 'sleeper', platformLeagueId: 'p2' },
        { id: 'l3', name: 'Legacy board', platform: 'legacy', hasUnifiedRecord: false },
      ],
    })
  })

  it('registers itself on import', () => {
    const definition = getScreenSummaryDefinition(WEEK_SCREEN)
    expect(definition).not.toBeNull()
    expect(definition!.staleWhileRevalidateMs).toBeGreaterThan(definition!.ttlMs)
  })

  it('declares NO invalidating events, because a user-scoped summary cannot be swept by league', () => {
    /*
     * 🛑 THE EMPTY LIST IS THE ASSERTION. This board spans every league the user plays, so its key
     * carries a userId and no league id — while the sweep is a prefix match on `l=<leagueId>&`.
     * Listing score or import events here would look like event-driven invalidation and be a
     * SILENT no-op: planReactions would name `week`, the consumer would build a prefix from the
     * event's league id, and it would match nothing. An invalidation that cannot fire is worse
     * than one that is absent.
     */
    expect(getScreenSummaryDefinition(WEEK_SCREEN)!.invalidatedBy).toEqual([])
    expect(screensInvalidatedBy('ingest.league.completed')).not.toContain(WEEK_SCREEN)
    expect(screensInvalidatedBy('competition.matchup.finalized')).not.toContain(WEEK_SCREEN)
  })

  it('builds on a miss and serves the second read from cache', async () => {
    const first = await readWeekAllSummary('u1')
    expect(first).toMatchObject({ data: BOARD, source: 'live' })

    const second = await readWeekAllSummary('u1')
    expect(second!.source).toBe('cache')
    expect(getWeekAll).toHaveBeenCalledTimes(1)
  })

  it('does not share a board between two users', async () => {
    await readWeekAllSummary('u1')
    await readWeekAllSummary('u2')
    expect(getWeekAll).toHaveBeenCalledTimes(2)
  })

  it('applies the SHARED played-leagues rule, dropping legacy board rows and sorting by name', async () => {
    // The raw list carries AF Legacy rows with no schedule to read. This is the same helper the
    // page uses — not a copy — so the two cannot drift.
    await readWeekAllSummary('u1')

    const [, leagues] = getWeekAll.mock.calls[0] as [string, Array<{ id: string; name: string }>]
    expect(leagues.map((l) => l.id)).toEqual(['l2', 'l1'])
    expect(leagues.some((l) => l.name === 'Legacy board')).toBe(false)
  })

  it('returns null rather than throwing when the league list cannot be read', async () => {
    getDashboardLeagueListForUser.mockResolvedValue(null)
    const entry = await readWeekAllSummary('u1')
    expect(entry!.data).toBeNull()
    expect(getWeekAll).not.toHaveBeenCalled()
  })

  it('is a no-op without a user', async () => {
    expect(await readWeekAllSummary('')).toBeNull()
    expect(getWeekAll).not.toHaveBeenCalled()
  })
})
