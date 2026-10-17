import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ findUnique: vi.fn(), findMany: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { fantraxLeague: { findUnique: h.findUnique, findMany: h.findMany } } }))
vi.mock('@/lib/league-import/fantrax/importFantraxLeague', () => ({ importFantraxLeague: h.refresh }))
import { fetchFantraxLeagueForImport, FantraxImportUnavailableError, FantraxImportLeagueNotFoundError } from '@/lib/league-import/fantrax/FantraxLeagueFetchService'
const snapshot = {
  id: 'snapshot', appUserId: 'owner', sourceLeagueId: 'vendor', season: 2026,
  user: { id: 'manager', fantraxUsername: 'Manager' }, userTeam: 'My Team',
  sport: 'cfb', isDevy: true, leagueName: 'College league',
  roster: [{ fantraxId: 'stale', name: 'Old Player', position: 'QB', status: 'ACTIVE', teamName: 'My Team' }],
  standings: [{ team: 'My Team', fantraxTeamId: 't1', wins: 0, losses: 0 }], matchups: [], transactions: [],
}
beforeEach(() => { vi.resetAllMocks(); h.findMany.mockResolvedValue([]) })
describe('stored Fantrax IDs must refresh before normalization', () => {
  it('reads back the freshly replaced roster and carries live scoring rules', async () => {
    h.findUnique.mockResolvedValueOnce(snapshot).mockResolvedValueOnce({ ...snapshot,
      roster: [{ fantraxId: 'current', name: 'New Player', position: 'QB', status: 'ACTIVE', teamName: 'My Team' }],
    })
    h.refresh.mockResolvedValue({ ok: true, fantraxLeagueId: 'snapshot', scoringRules: [{ stat_key: 'pass_yd', points_value: 0.04 }], scoringGaps: [], sourceSettings: { rosterInfo: {}, scoringSystem: null }, seasonState: 'in_season' })
    const payload = await fetchFantraxLeagueForImport('owner', 'id:snapshot')
    expect(h.refresh).toHaveBeenCalledWith({ leagueId: 'vendor', teamName: 'My Team', appUserId: 'owner', refreshSnapshotId: 'snapshot' })
    expect(payload.teams[0].rosterPlayerIds).toEqual(['current'])
    expect(payload.teams[0].starterPlayerIds).toEqual(['current'])
    expect(payload.settings.scoringRules).toEqual([{ statKey: 'pass_yd', points: 0.04 }])
  })
  it('does not return a stale payload when live refresh fails', async () => {
    h.findUnique.mockResolvedValue(snapshot)
    h.refresh.mockResolvedValue({ ok: false, error: 'Provider unavailable' })
    await expect(fetchFantraxLeagueForImport('owner', 'id:snapshot')).rejects.toBeInstanceOf(FantraxImportUnavailableError)
    expect(h.findUnique).toHaveBeenCalledTimes(1)
  })
  it('leaves a CSV snapshot readable without a vendor request', async () => {
    h.findUnique.mockResolvedValue({ ...snapshot, sourceLeagueId: null })
    const payload = await fetchFantraxLeagueForImport('owner', 'id:snapshot')
    expect(payload.teams[0].rosterPlayerIds).toEqual(['stale'])
    expect(h.refresh).not.toHaveBeenCalled()
  })
  it('checks ownership before refreshing', async () => {
    h.findUnique.mockResolvedValue(snapshot)
    await expect(fetchFantraxLeagueForImport('other', 'id:snapshot')).rejects.toBeInstanceOf(FantraxImportLeagueNotFoundError)
    expect(h.refresh).not.toHaveBeenCalled()
  })
})
