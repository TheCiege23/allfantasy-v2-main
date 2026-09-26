import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({
  league: { findUnique: vi.fn(), update: vi.fn() },
  leagueWaiverSettings: { updateMany: vi.fn() },
  leagueSeason: { upsert: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: h }))
vi.mock('@/lib/league-import/ImportedLeagueCommitService', () => ({
  buildTier0LeagueColumnPatch: () => ({}), buildImportedLeagueSettings: () => ({}),
  republishCanonicalSettingsForRefresh: (_bundle: unknown, _existing: unknown, fresh: unknown) => fresh,
  persistTradedPicks: vi.fn(),
}))
vi.mock('@/lib/league-import/canonicalImportNormalizer', () => ({ buildCanonicalImportBundle: () => ({}) }))
vi.mock('@/lib/league-import/sleeper/SleeperLeagueCreationBootstrapService', () => ({ bootstrapLeagueFromNormalizedImport: vi.fn() }))
vi.mock('@/lib/import-os/collector/persistLiveTrades', () => ({ persistLiveTrades: vi.fn() }))
import { applySleeperScopeToLeague } from '@/lib/import-os/collector/applySleeperLeagueSync'
beforeEach(() => {
  vi.clearAllMocks()
  h.league.findUnique.mockResolvedValue({ name: 'League', settings: {} })
  h.leagueWaiverSettings.updateMany.mockResolvedValue({ count: 1 })
})
const refresh = (rules: object) => applySleeperScopeToLeague({
  leagueId: 'league1', scope: 'league_state',
  normalized: { league: { name: 'League', season: 2026, ...rules }, source: { source_league_id: '123' }, rosters: [] } as never,
})
it('repairs the stored imported waiver enum without replacing processing rules', async () => {
  await refresh({ waiver_type: 'rolling', faab_budget: 100 })
  expect(h.leagueWaiverSettings.updateMany).toHaveBeenCalledWith({
    where: { leagueId: 'league1' }, data: { waiverType: 'rolling', faabBudget: 100 },
  })
})
it('preserves existing waiver settings when the provider omits them', async () => {
  await refresh({})
  expect(h.leagueWaiverSettings.updateMany).not.toHaveBeenCalled()
})
it('does not stamp fresh league data if its rule mirror could not be saved', async () => {
  h.leagueWaiverSettings.updateMany.mockRejectedValueOnce(new Error('write failed'))
  await expect(refresh({ waiver_type: 'rolling' })).rejects.toThrow('write failed')
  expect(h.league.update).not.toHaveBeenCalled()
})
