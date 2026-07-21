import { beforeEach, describe, expect, it, vi } from 'vitest'

// /api/warehouse/league-history's dataState: an empty result set is only "no history" when
// statistics were actually imported. PENDING_IMPORT is the truthful state for the
// zero-rows-in-PlayerGameStat condition confirmed in production.

const statCount = vi.fn()
const factCount = vi.fn()
const statGroupBy = vi.fn()
const factGroupBy = vi.fn()
const statAggregate = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerGameStat: {
      count: (...a: unknown[]) => statCount(...a),
      groupBy: (...a: unknown[]) => statGroupBy(...a),
      aggregate: (...a: unknown[]) => statAggregate(...a),
    },
    playerGameFact: {
      count: (...a: unknown[]) => factCount(...a),
      groupBy: (...a: unknown[]) => factGroupBy(...a),
    },
    syncJobRun: { findFirst: vi.fn() },
  },
}))

import { computeWarehouseDataState } from '@/lib/data-warehouse/warehouseDataState'

beforeEach(() => {
  vi.clearAllMocks()
  statAggregate.mockResolvedValue({ _min: { season: null }, _max: { season: null } })
})

describe('computeWarehouseDataState', () => {
  it('PENDING_IMPORT when nothing was ever ingested — empty history is NOT real data', async () => {
    statCount.mockResolvedValue(0)
    factCount.mockResolvedValue(0)
    statGroupBy.mockResolvedValue([])
    factGroupBy.mockResolvedValue([])

    const state = await computeWarehouseDataState('NFL', 2025)
    expect(state.status).toBe('PENDING_IMPORT')
    expect(state.warnings[0]).toMatch(/missing import, not real data/i)
  })

  it('UNAVAILABLE when stats exist but facts were never generated', async () => {
    statCount.mockResolvedValue(1500)
    factCount.mockResolvedValue(0)
    statGroupBy.mockResolvedValue([{ weekOrRound: 1 }])
    factGroupBy.mockResolvedValue([])

    const state = await computeWarehouseDataState('NFL', 2025)
    expect(state.status).toBe('UNAVAILABLE')
  })

  it('PARTIAL when facts cover fewer weeks than source stats', async () => {
    statCount.mockResolvedValue(3000)
    factCount.mockResolvedValue(1500)
    statGroupBy.mockResolvedValue([{ weekOrRound: 1 }, { weekOrRound: 2 }])
    factGroupBy.mockResolvedValue([{ weekOrRound: 1 }])

    const state = await computeWarehouseDataState('NFL', 2025)
    expect(state.status).toBe('PARTIAL')
    expect(state.coverage).toMatchObject({ sourceWeeks: 2, factWeeks: 1 })
  })

  it('AVAILABLE when facts cover every source week', async () => {
    statCount.mockResolvedValue(1500)
    factCount.mockResolvedValue(1500)
    statGroupBy.mockResolvedValue([{ weekOrRound: 1 }])
    factGroupBy.mockResolvedValue([{ weekOrRound: 1 }])

    const state = await computeWarehouseDataState('NFL', 2025)
    expect(state.status).toBe('AVAILABLE')
    expect(state.warnings).toEqual([])
  })
})
