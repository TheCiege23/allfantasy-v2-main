import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSeasonOutlook = vi.fn()
const getDashboardLeagueListForUser = vi.fn()

vi.mock('@/lib/core-app/seasonOutlook', () => ({
  getSeasonOutlook: (...a: unknown[]) => getSeasonOutlook(...a),
}))
vi.mock('@/lib/dashboard/get-dashboard-league-list', () => ({
  getDashboardLeagueListForUser: (...a: unknown[]) => getDashboardLeagueListForUser(...a),
}))
vi.mock('@/lib/sports-os/durableTier', () => ({ sportsDataCacheTier: () => null }))

const { readSeasonOutlookSummary, SEASON_OUTLOOK_SCREEN } = await import(
  '@/lib/core-app/seasonOutlookSummary'
)
const { __resetLayeredCacheForTests } = await import('@/lib/sports-os/layeredCache')
const { getScreenSummaryDefinition, screensInvalidatedBy } = await import('@/lib/sports-os/summaries')

const BOARD = { leagues: [{ leagueId: 'p1' }], basis: '10,000 simulations per league' }

describe('seasonOutlookSummary', () => {
  beforeEach(() => {
    __resetLayeredCacheForTests()
    getSeasonOutlook.mockReset()
    getDashboardLeagueListForUser.mockReset()
    getSeasonOutlook.mockResolvedValue(BOARD)
    getDashboardLeagueListForUser.mockResolvedValue({
      leagues: [
        { id: 'l1', name: 'Bravo', platform: 'sleeper', platformLeagueId: 'p1', settings: { s: 1 } },
        { id: 'l2', name: 'Alpha', platform: 'sleeper', platformLeagueId: 'p2', settings: null },
        { id: 'l3', name: 'Legacy board', platform: 'legacy', hasUnifiedRecord: false },
      ],
    })
  })

  it('registers itself on import, with a stale window longer than its TTL', () => {
    const definition = getScreenSummaryDefinition(SEASON_OUTLOOK_SCREEN)
    expect(definition).not.toBeNull()
    expect(definition!.staleWhileRevalidateMs).toBeGreaterThan(definition!.ttlMs)
  })

  it('declares NO invalidating events, because a partial league sweep would desynchronize the two boards', () => {
    /*
     * 🛑 THE EMPTY LIST IS THE ASSERTION, AND THE REASON IS SHARPER THAN weekAll's.
     *
     * Half of this screen's keys DO carry a league id — every focused scope — so a prefix sweep
     * would genuinely fire against them while leaving the cross-league scope standing. The result
     * is /core/standings with a league held and /core/standings with none printing DIFFERENT
     * playoff percentages for the same team until the TTL caught up, which is precisely the
     * "two surfaces, two different answers to where do I sit" failure seasonOutlook.ts exists to
     * prevent. Both scopes expiring together is the consistent behaviour.
     */
    expect(getScreenSummaryDefinition(SEASON_OUTLOOK_SCREEN)!.invalidatedBy).toEqual([])
    expect(screensInvalidatedBy('ingest.league.completed')).not.toContain(SEASON_OUTLOOK_SCREEN)
    expect(screensInvalidatedBy('competition.matchup.finalized')).not.toContain(SEASON_OUTLOOK_SCREEN)
  })

  it('builds on a miss and serves the second read from cache', async () => {
    const first = await readSeasonOutlookSummary('u1', null)
    expect(first).toMatchObject({ data: BOARD, source: 'live' })

    const second = await readSeasonOutlookSummary('u1', null)
    expect(second!.source).toBe('cache')
    expect(getSeasonOutlook).toHaveBeenCalledTimes(1)
  })

  it('🛑 keys on the FOCUS league, so a focused read never serves the cross-league board', async () => {
    /*
     * The focused board is a SUPERSET: getSeasonOutlook's third argument guarantees that league's
     * branch simulations run even when it is not among the eight most contested. Sharing one key
     * would serve a focused read a board built without them, and its swing card would vanish with
     * no error and no empty state — a hole with no explanation.
     */
    await readSeasonOutlookSummary('u1', null)
    await readSeasonOutlookSummary('u1', 'l1')
    expect(getSeasonOutlook).toHaveBeenCalledTimes(2)

    expect(getSeasonOutlook.mock.calls[0]![2]).toBeNull()
    expect(getSeasonOutlook.mock.calls[1]![2]).toBe('l1')

    // And two different focus leagues are two different boards, not one.
    await readSeasonOutlookSummary('u1', 'l2')
    expect(getSeasonOutlook).toHaveBeenCalledTimes(3)

    // ...while a repeat of a focus already built is a hit.
    await readSeasonOutlookSummary('u1', 'l1')
    expect(getSeasonOutlook).toHaveBeenCalledTimes(3)
  })

  it('does not share a board between two users', async () => {
    await readSeasonOutlookSummary('u1', null)
    await readSeasonOutlookSummary('u2', null)
    expect(getSeasonOutlook).toHaveBeenCalledTimes(2)
  })

  it('applies the SHARED played-leagues rule, and carries settings through', async () => {
    /*
     * The league set is not merely a filter here — chooseIterations divides the total game budget
     * across every league passed in, so handing the model a different set than the page does moves
     * the iteration count and the `basis` line with it.
     */
    await readSeasonOutlookSummary('u1', null)

    const leagues = getSeasonOutlook.mock.calls[0]![1] as Array<{
      id: string
      name: string
      settings: unknown
    }>
    expect(leagues.map((l) => l.id)).toEqual(['l2', 'l1'])
    expect(leagues.some((l) => l.name === 'Legacy board')).toBe(false)
    expect(leagues.find((l) => l.id === 'l1')!.settings).toEqual({ s: 1 })
  })

  it('returns null rather than throwing when the league list cannot be read', async () => {
    getDashboardLeagueListForUser.mockResolvedValue(null)
    const entry = await readSeasonOutlookSummary('u1', null)
    expect(entry!.data).toBeNull()
    expect(getSeasonOutlook).not.toHaveBeenCalled()
  })

  it('is a no-op without a user', async () => {
    expect(await readSeasonOutlookSummary('', null)).toBeNull()
    expect(getSeasonOutlook).not.toHaveBeenCalled()
  })
})
