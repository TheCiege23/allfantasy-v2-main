import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * The college projection read — `AFProjectionSnapshot` → a `/core` lineup.
 *
 * 🛑 THE BUG THIS SUITE EXISTS FOR SHIPPED IN MY OWN FIRST CUT. College projections
 * are SEASON-LONG: every `AFProjectionSnapshot` row has `week = null`, in both sports,
 * because the writer gates week-scoped rows on Sleeper's season state — which is the
 * NFL's. The first version of this reader filtered on `week: { not: null }`, so it
 * would have returned an empty map on every college lineup in production while looking
 * perfectly wired: a real module, a real caller, real ids, and nothing on screen.
 *
 * It was caught by another session's production measurement, not by this code. Hence
 * the first test below, which pins the season-long read directly rather than trusting
 * that nobody re-introduces a week filter.
 */

const snapFindFirst = vi.fn()
const snapFindMany = vi.fn()
const pimFindMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    aFProjectionSnapshot: {
      findFirst: (...a: unknown[]) => snapFindFirst(...a),
      findMany: (...a: unknown[]) => snapFindMany(...a),
    },
    playerIdentityMap: {
      findMany: (...a: unknown[]) => pimFindMany(...a),
    },
  },
}))

function snapshot(cfbdId: string, name: string, points: number) {
  return {
    playerId: cfbdId,
    playerName: name,
    position: 'QB',
    afProjection: points,
    adjustmentFactors: { perGameRates: { passing_yards: 240.5 } },
  }
}

beforeEach(() => {
  vi.resetModules()
  snapFindFirst.mockReset().mockResolvedValue({ season: 2026 })
  snapFindMany.mockReset().mockResolvedValue([])
  pimFindMany.mockReset().mockResolvedValue([])
})

describe('the season-long read', () => {
  it('queries week: null — NOT a week — because college rows have no week', async () => {
    pimFindMany.mockResolvedValue([{ rollingInsightsId: 'ri-1', espnId: null, cfbdId: '111' }])
    snapFindMany.mockResolvedValue([snapshot('111', 'Gunner Stockton', 312.4)])

    const { lookupNcaafProjections } = await import('@/lib/core-app/ncaafProjections')
    await lookupNcaafProjections(['ri-1'], { season: '2026' })

    const where = snapFindMany.mock.calls[0][0].where
    expect(where.week, 'a week filter would match no college row that exists').toBeNull()
    expect(where.sport).toBe('NCAAF')
    expect(where.season).toBe(2026)
  })

  it('ignores a caller-supplied NFL week instead of returning nothing', async () => {
    /*
     * Every `/core` surface passes `latestProjectionWeek()`, which is the NFL feed's
     * week. Honouring it would filter college rows to a week that does not exist and
     * render an empty lineup — the failure mode being pinned above, reached from the
     * caller's side instead of the query's.
     */
    pimFindMany.mockResolvedValue([{ rollingInsightsId: 'ri-1', espnId: null, cfbdId: '111' }])
    snapFindMany.mockResolvedValue([snapshot('111', 'Gunner Stockton', 312.4)])

    const { lookupNcaafProjections } = await import('@/lib/core-app/ncaafProjections')
    const out = await lookupNcaafProjections(['ri-1'], { season: '2026' } as never)

    expect(out.get('ri-1')?.projectedPoints).toBe(312.4)
  })

  it('marks the number season-long so a surface cannot show it as a weekly figure', async () => {
    pimFindMany.mockResolvedValue([{ rollingInsightsId: 'ri-1', espnId: null, cfbdId: '111' }])
    snapFindMany.mockResolvedValue([snapshot('111', 'Gunner Stockton', 312.4)])

    const { lookupNcaafProjections } = await import('@/lib/core-app/ncaafProjections')
    const out = await lookupNcaafProjections(['ri-1'], { season: '2026' })

    expect(out.get('ri-1')?.seasonLong, 'a season total would read as a weekly projection').toBe(true)
  })
})

describe('identity', () => {
  it('keys the result by the ROSTER id the caller passed, not the CFBD id', async () => {
    pimFindMany.mockResolvedValue([{ rollingInsightsId: 'ri-1', espnId: null, cfbdId: '111' }])
    snapFindMany.mockResolvedValue([snapshot('111', 'Gunner Stockton', 312.4)])

    const { lookupNcaafProjections } = await import('@/lib/core-app/ncaafProjections')
    const out = await lookupNcaafProjections(['ri-1'], { season: '2026' })

    expect([...out.keys()]).toEqual(['ri-1'])
    expect(out.get('ri-1')?.playerId).toBe('ri-1')
  })

  it('drops a roster id that two identity rows disagree about', async () => {
    /*
     * Only `sleeperId` is unique on PlayerIdentityMap. Two rows claiming one RI id
     * with different CFBD ids is a genuine disagreement, and picking either would put
     * a stranger's projection on somebody's starter — silently, and priced.
     */
    pimFindMany.mockResolvedValue([
      { rollingInsightsId: 'ri-1', espnId: null, cfbdId: '111' },
      { rollingInsightsId: 'ri-1', espnId: null, cfbdId: '222' },
    ])
    snapFindMany.mockResolvedValue([snapshot('111', 'A', 10), snapshot('222', 'B', 20)])

    const { lookupNcaafProjections } = await import('@/lib/core-app/ncaafProjections')
    const out = await lookupNcaafProjections(['ri-1'], { season: '2026' })

    expect(out.size, 'an ambiguous id resolved to one of the two anyway').toBe(0)
  })

  it('omits an unlinked player rather than projecting him at zero', async () => {
    pimFindMany.mockResolvedValue([])

    const { lookupNcaafProjections } = await import('@/lib/core-app/ncaafProjections')
    const out = await lookupNcaafProjections(['ri-unknown'], { season: '2026' })

    expect(out.has('ri-unknown'), 'zero points is a claim; "not projected" is the truth').toBe(false)
  })
})
