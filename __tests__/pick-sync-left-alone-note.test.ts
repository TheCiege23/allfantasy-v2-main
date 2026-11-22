// @vitest-environment node
/**
 * The scheduled sync's pick step must SAY when the save left a pick alone.
 *
 * `persistTradedPicks` does not update a pick AllFantasy has settled (moved by an in-app trade, used
 * in a draft, forfeited). That pick is neither written nor refused, so it is in neither of the run's
 * counts. The only place it can show up in the run record (`sync_job_runs.metadata.notes`) is a note.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  persistTradedPicks: vi.fn(),
  clearReturnedTradedPicks: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/league-import/ImportedLeagueCommitService', () => ({
  buildTier0LeagueColumnPatch: () => ({}),
  buildImportedLeagueSettings: () => ({}),
  republishCanonicalSettingsForRefresh: (_bundle: unknown, _existing: unknown, fresh: unknown) => fresh,
  refreshKeepsStoredScoring: () => false,
  persistTradedPicks: h.persistTradedPicks,
  clearReturnedTradedPicks: h.clearReturnedTradedPicks,
}))
vi.mock('@/lib/league-import/canonicalImportNormalizer', () => ({ buildCanonicalImportBundle: () => ({}) }))
vi.mock('@/lib/league-import/sleeper/SleeperLeagueCreationBootstrapService', () => ({
  bootstrapLeagueFromNormalizedImport: vi.fn(),
}))
vi.mock('@/lib/import-os/collector/persistLiveTrades', () => ({ persistLiveTrades: vi.fn() }))

import { applySleeperScopeToLeague } from '@/lib/import-os/collector/applySleeperLeagueSync'

const PICKS = [
  { season: 2027, round: 1, original_roster_id: '1', current_owner_roster_id: '2' },
  { season: 2027, round: 2, original_roster_id: '3', current_owner_roster_id: '4' },
  { season: 2028, round: 1, original_roster_id: '5', current_owner_roster_id: '6' },
]

const syncPicks = (traded: unknown = PICKS) =>
  applySleeperScopeToLeague({
    leagueId: 'league1',
    scope: 'traded_picks',
    normalized: { league: { name: 'League', season: 2026 }, traded_picks: traded } as never,
  })

describe('scheduled sync: pick step', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.clearReturnedTradedPicks.mockResolvedValue({ cleared: 0, skipped: 0 })
  })

  it('names the picks the save left alone, and counts them as neither written nor refused', async () => {
    h.persistTradedPicks.mockResolvedValue({ written: 1, skipped: 0, leftAlone: 2 })
    const res = await syncPicks()
    expect(h.persistTradedPicks).toHaveBeenCalledWith('league1', PICKS)
    expect(res.imported).toBe(1)
    expect(res.rejected).toBe(0)
    expect(res.unchanged).toBe(0)
    expect(res.notes).toEqual([
      'traded_picks: 2 pick(s) left as stored (settled in AllFantasy: traded in the app, used or forfeited)',
    ])
  })

  it('says nothing when every pick was saved', async () => {
    h.persistTradedPicks.mockResolvedValue({ written: 3, skipped: 0, leftAlone: 0 })
    const res = await syncPicks()
    expect(res.imported).toBe(3)
    expect(res.notes).toEqual([])
  })

  it('a refused pick is still a rejection, not a pick left alone', async () => {
    h.persistTradedPicks.mockResolvedValue({ written: 2, skipped: 1, leftAlone: 0 })
    const res = await syncPicks()
    expect(res.imported).toBe(2)
    expect(res.rejected).toBe(1)
    expect(res.notes).toEqual([])
  })

  it('does not call the save, or add a note, when the provider sent no traded picks', async () => {
    const res = await syncPicks([])
    expect(h.persistTradedPicks).not.toHaveBeenCalled()
    expect(res.notes).toEqual([])
  })
})
