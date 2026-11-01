import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ identities: vi.fn(), snapshots: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: { findMany: h.identities },
    aFProjectionSnapshot: { findMany: h.snapshots },
  },
}))

import { loadAfBaselineProjectionsByRollingInsightsIds } from '@/lib/af-projections/readAfProjections'

const at = (iso: string) => new Date(iso)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('loadAfBaselineProjectionsByRollingInsightsIds', () => {
  it('joins RI id → identity → newest season-baseline row, newest season first', async () => {
    h.identities.mockResolvedValue([{ id: 'idA', rollingInsightsId: '101' }])
    // Ordered as the query asks: season desc, computedAt desc.
    h.snapshots.mockResolvedValue([
      { playerId: 'idA', afProjection: 9.4, season: 2026, computedAt: at('2026-10-20') },
      { playerId: 'idA', afProjection: 8.1, season: 2025, computedAt: at('2025-10-01') },
    ])
    const out = await loadAfBaselineProjectionsByRollingInsightsIds({ sport: 'mlb', rollingInsightsIds: ['101', '101', ''], season: 2027 })
    expect(out.get('101')).toEqual({ afProjection: 9.4, season: 2026, computedAt: at('2026-10-20') })

    const identityArgs = h.identities.mock.calls[0]![0]
    expect(identityArgs.where).toEqual({ sport: 'MLB', rollingInsightsId: { in: ['101'] } })
    const snapshotArgs = h.snapshots.mock.calls[0]![0]
    expect(snapshotArgs.where).toMatchObject({ sport: 'MLB', week: null, playerId: { in: ['idA'] }, season: { lte: 2027 } })
  })

  it('drops an RI id claimed by two identities instead of picking one', async () => {
    h.identities.mockResolvedValue([
      { id: 'idA', rollingInsightsId: '7' },
      { id: 'idB', rollingInsightsId: '7' },
    ])
    const out = await loadAfBaselineProjectionsByRollingInsightsIds({ sport: 'NHL', rollingInsightsIds: ['7'] })
    expect(out.size).toBe(0)
    expect(h.snapshots).not.toHaveBeenCalled()
  })

  it('ignores zero / non-finite projections and reads no DB for an empty id list', async () => {
    h.identities.mockResolvedValue([{ id: 'idA', rollingInsightsId: '1' }])
    h.snapshots.mockResolvedValue([{ playerId: 'idA', afProjection: 0, season: 2026, computedAt: at('2026-10-20') }])
    expect((await loadAfBaselineProjectionsByRollingInsightsIds({ sport: 'NHL', rollingInsightsIds: ['1'] })).size).toBe(0)

    vi.clearAllMocks()
    expect((await loadAfBaselineProjectionsByRollingInsightsIds({ sport: 'NHL', rollingInsightsIds: [] })).size).toBe(0)
    expect(h.identities).not.toHaveBeenCalled()
  })
})
