import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { leagueRead, sleeperRead } = vi.hoisted(() => ({
  leagueRead: vi.fn(), sleeperRead: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    userProfile: { findUnique: vi.fn(async () => null) },
    appUser: { findUnique: vi.fn(async () => null) },
    league: { findMany: leagueRead },
    sleeperLeague: { findMany: sleeperRead },
    legacyTournament: { findMany: vi.fn(async () => []) },
  },
}))
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'

beforeEach(() => {
  leagueRead.mockResolvedValue([])
  sleeperRead.mockResolvedValue([])
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('Core league membership read recovery', () => {
  it('rejects a failed membership read so Core can retry without removing the selected league', async () => {
    const failure = new Error('temporary database outage')
    leagueRead.mockRejectedValue(failure)
    await expect(getDashboardLeagueListForUser('user', { requireCoreLeagues: true })).rejects.toBe(failure)
  })
  it('distinguishes a successful empty list from a failed read', async () => {
    await expect(getDashboardLeagueListForUser('user', { requireCoreLeagues: true })).resolves.toMatchObject({ leagues: [] })
  })
  it('preserves best-effort behavior for other callers', async () => {
    leagueRead.mockRejectedValue(new Error('temporary database outage'))
    await expect(getDashboardLeagueListForUser('user')).resolves.toMatchObject({ leagues: [] })
  })
})
