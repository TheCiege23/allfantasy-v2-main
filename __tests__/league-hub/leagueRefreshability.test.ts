import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Is THIS league re-readable from its provider?
 *
 * 🛑 THE ANSWER GATES WHAT THE PRODUCT SAYS ABOUT A PERSON, WHICH IS WHY THIS IS TESTED IN BOTH
 * DIRECTIONS RATHER THAN JUST THE HAPPY ONE. `deriveImportType` turns a `false` here into
 * `csv_snapshot`, which `commissionerOsContext` turns into `isSnapshotOnly`, which suppresses
 * integrity recommendations and filters out `manager_engagement_risk`.
 *
 *   wrong `false` → a commissioner never hears that a manager has gone inactive
 *   wrong `true`  → the product tells a commissioner someone abandoned the league, on the
 *                   strength of a single CSV uploaded months ago
 *
 * Neither error announces itself, and a test that only covered the refreshable case would pass
 * against a resolver that returned `true` unconditionally.
 */
const { leagueFindMany, fantraxLeagueFindMany } = vi.hoisted(() => ({
  leagueFindMany: vi.fn(),
  fantraxLeagueFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: leagueFindMany },
    fantraxLeague: { findMany: fantraxLeagueFindMany },
  },
}))

import { resolveFantraxRefreshability } from '@/lib/shared-services/league-hub/leagueRefreshability'

beforeEach(() => {
  vi.clearAllMocks()
  leagueFindMany.mockResolvedValue([])
  fantraxLeagueFindMany.mockResolvedValue([])
})

describe('resolveFantraxRefreshability', () => {
  it('reports a Fantrax league with a sourceLeagueId as refreshable, and one without as not', () => {
    leagueFindMany.mockResolvedValue([
      { id: 'L-live', platformLeagueId: 'snap-live' },
      { id: 'L-csv', platformLeagueId: 'snap-csv' },
    ])
    fantraxLeagueFindMany.mockResolvedValue([
      { id: 'snap-live', sourceLeagueId: 'v2kzedypmm8jp61b' },
      // A CSV-era row. The schema says it can never acquire one.
      { id: 'snap-csv', sourceLeagueId: null },
    ])

    return resolveFantraxRefreshability(['L-live', 'L-csv']).then((map) => {
      expect(map.get('L-live')).toBe(true)
      expect(map.get('L-csv')).toBe(false)
    })
  })

  it('treats a blank sourceLeagueId the same as a missing one', async () => {
    leagueFindMany.mockResolvedValue([{ id: 'L-blank', platformLeagueId: 'snap-blank' }])
    fantraxLeagueFindMany.mockResolvedValue([{ id: 'snap-blank', sourceLeagueId: '   ' }])

    const map = await resolveFantraxRefreshability(['L-blank'])
    // Whitespace is not a league id. Reading it as one would claim a refresh that cannot happen.
    expect(map.get('L-blank')).toBe(false)
  })

  it('🛑 leaves NON-Fantrax leagues out of the map entirely — absent means "ask the provider", not false', async () => {
    /*
     * The distinction is the whole contract. If this returned `false` for an ESPN league, every
     * ESPN league on the platform would relabel to `csv_snapshot` and lose its recommendations —
     * a one-word mistake with a platform-wide blast radius.
     */
    leagueFindMany.mockResolvedValue([])

    const map = await resolveFantraxRefreshability(['L-espn', 'L-sleeper'])
    expect(map.has('L-espn')).toBe(false)
    expect(map.has('L-sleeper')).toBe(false)
    expect(map.size).toBe(0)
  })

  it('resolves a Fantrax league whose snapshot row is missing to NOT refreshable', async () => {
    // Conservative on purpose: the failure mode of a missing row must be staying quiet about a
    // manager, never accusing one.
    leagueFindMany.mockResolvedValue([{ id: 'L-orphan', platformLeagueId: 'snap-gone' }])
    fantraxLeagueFindMany.mockResolvedValue([])

    const map = await resolveFantraxRefreshability(['L-orphan'])
    expect(map.get('L-orphan')).toBe(false)
  })

  it('resolves a Fantrax league with no platformLeagueId at all to NOT refreshable', async () => {
    leagueFindMany.mockResolvedValue([{ id: 'L-noid', platformLeagueId: null }])

    const map = await resolveFantraxRefreshability(['L-noid'])
    expect(map.get('L-noid')).toBe(false)
    // Nothing to look up, so the second query is never issued.
    expect(fantraxLeagueFindMany).not.toHaveBeenCalled()
  })

  it('costs one query when the viewer has no Fantrax leagues, and none at all when given nothing', async () => {
    await resolveFantraxRefreshability(['L-espn'])
    expect(leagueFindMany).toHaveBeenCalledTimes(1)
    expect(fantraxLeagueFindMany).not.toHaveBeenCalled()

    vi.clearAllMocks()
    const empty = await resolveFantraxRefreshability([])
    expect(empty.size).toBe(0)
    expect(leagueFindMany).not.toHaveBeenCalled()
  })

  it('degrades to an empty map rather than throwing when the database is unavailable', async () => {
    /*
     * This runs on the portfolio page load. A failed lookup must not take the page down — and an
     * empty map is the safe degradation, because it means "ask the provider", which is what the
     * Hub did before this resolver existed.
     */
    leagueFindMany.mockRejectedValue(new Error('connection refused'))

    const map = await resolveFantraxRefreshability(['L-live'])
    expect(map.size).toBe(0)
  })
})
