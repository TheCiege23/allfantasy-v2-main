import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ league: vi.fn(), config: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: mocks.league },
  salaryCapLeagueConfig: { findUnique: mocks.config } } }))
import { getSalaryCapConfig } from '@/lib/salary-cap/SalaryCapLeagueConfig'
const league = { id: 'league', sport: 'NFL', season: 2026, settings: {}, leagueVariant: 'salary_cap' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.league.mockResolvedValue(league)
  mocks.config.mockResolvedValue({ id: 'config', leagueId: 'league', startupCap: 100,
    createdAt: new Date('2025-12-10T00:00:00Z') })
})
describe('persisted cap growth origin', () => {
  it('uses a stable persisted creation year when no startup season is declared', async () => {
    const config = await getSalaryCapConfig('league')
    expect(config?.capStartYear).toBe(2025)
    expect(config?.season).toBe(2026)
  })
  it('honors a declared startup season for future-season and historical imports', async () => {
    mocks.league.mockResolvedValue({ ...league, settings: { capStartYear: 2026 } })
    expect((await getSalaryCapConfig('league'))?.capStartYear).toBe(2026)
  })
  it.each([NaN, Infinity, 2025.5, '2025'])('does not accept an invalid startup year %s', async (capStartYear) => {
    mocks.league.mockResolvedValue({ ...league, settings: { capStartYear } })
    expect((await getSalaryCapConfig('league'))?.capStartYear).toBe(2025)
  })
})
