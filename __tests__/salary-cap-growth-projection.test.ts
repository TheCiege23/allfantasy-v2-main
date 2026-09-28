import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SalaryCapConfig } from '@/lib/salary-cap/types'
const mocks = vi.hoisted(() => ({ config: vi.fn(), contracts: vi.fn(), ledger: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { playerContract: { findMany: mocks.contracts },
  salaryCapTeamLedger: { findUnique: mocks.ledger } } }))
vi.mock('@/lib/salary-cap/SalaryCapLeagueConfig', () => ({ getSalaryCapConfig: mocks.config }))
import { getEffectiveCap } from '@/lib/salary-cap/CapCalculationService'
import { getFutureCapProjection } from '@/lib/salary-cap/FutureCapProjectionService'
const config = { leagueId: 'league', configId: 'config', startupCap: 100, capGrowthPercent: 5, capStartYear: 2025 } as SalaryCapConfig
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })
describe('salary cap growth and projection', () => {
  it('uses the league season for default projections across a calendar rollover', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2027-01-10T00:00:00Z'))
    mocks.config.mockResolvedValue({ ...config, season: 2026 })
    mocks.ledger.mockResolvedValue(null)
    mocks.contracts.mockResolvedValue([])
    expect((await getFutureCapProjection('league', 'roster', [])).map((year) => year.capYear))
      .toEqual([2026, 2027, 2028])
  })
  it('withholds projections when the salary-cap configuration is not persisted', async () => {
    mocks.config.mockResolvedValue({ ...config, configId: '' })
    expect(await getFutureCapProjection('league', 'roster', [2026])).toEqual([])
    expect(mocks.contracts).not.toHaveBeenCalled()
  })
  it('keeps accumulated cap growth stable across calendar rollovers', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-26T00:00:00Z'))
    expect(getEffectiveCap(config, 2026, 10)).toBe(115)
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'))
    expect(getEffectiveCap(config, 2026, 10)).toBe(115)
    expect(getEffectiveCap(config, 2027, 0)).toBe(110)
  })
  it('counts only contracts in force in each year and performs no ledger writes', async () => {
    mocks.config.mockResolvedValue(config)
    mocks.ledger.mockResolvedValue({ rolloverUsed: 0 })
    mocks.contracts.mockImplementation(async (query: { where: { status: unknown } }) => {
      if (query.where.status === 'cut') return [{ deadMoneyRemaining: { '2027': 7 } }]
      return [{ yearSigned: 2025, yearsTotal: 2, salary: 20 },
        { yearSigned: 2027, yearsTotal: 1, salary: 30 }]
    })
    const years = await getFutureCapProjection('league', 'roster', [2026, 2027, 2028])
    expect(years.map((year) => year.contractCount)).toEqual([1, 1, 0])
    expect(years.map((year) => year.totalCapHit)).toEqual([20, 30, 0])
    expect(years[1].deadMoney).toBe(7)
    expect(years[1].projectedSpace).toBe(73)
  })
})
