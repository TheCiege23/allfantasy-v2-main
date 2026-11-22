// @vitest-environment node
/**
 * A league a person confirmed as dynasty keeps `League.isDynasty` on, even when its provider cannot
 * say dynasty. Fantrax's league info has no dynasty flag, so its mapper always reports `false`, and
 * the scheduled sync used to rewrite that `false` every 30 minutes over the person's answer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.findUnique, update: h.update },
    leagueWaiverSettings: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    leagueSeason: { upsert: vi.fn().mockResolvedValue({}) },
  },
}))
vi.mock('@/lib/league-import/ImportedLeagueCommitService', () => ({
  buildTier0LeagueColumnPatch: () => ({}),
  buildImportedLeagueSettings: () => ({}),
  republishCanonicalSettingsForRefresh: (_existing: unknown, fresh: unknown) => fresh,
  refreshKeepsStoredScoring: () => false,
  persistTradedPicks: vi.fn(),
  clearReturnedTradedPicks: vi.fn(),
}))
vi.mock('@/lib/league-import/canonicalImportNormalizer', () => ({ buildCanonicalImportBundle: () => ({}) }))
vi.mock('@/lib/league-import/sleeper/SleeperLeagueCreationBootstrapService', () => ({
  bootstrapLeagueFromNormalizedImport: vi.fn(),
}))
vi.mock('@/lib/import-os/collector/persistLiveTrades', () => ({ persistLiveTrades: vi.fn() }))

import { isDynastyForWrite } from '@/lib/league-import/leagueTypeWrite'
import { applySleeperScopeToLeague } from '@/lib/import-os/collector/applySleeperLeagueSync'

const confirmed = (type: string, baseFormat?: string) => ({
  leagueTypeConfirmation: { type, confirmedByUserId: 'u1', confirmedAt: '2026-11-01T00:00:00Z', ...(baseFormat ? { baseFormat } : {}) },
})

describe('isDynastyForWrite', () => {
  it('turns the flag on for a confirmed dynasty, devy, C2C or EFL league the provider calls not dynasty', () => {
    for (const type of ['dynasty', 'devy', 'c2c', 'efl']) {
      expect(isDynastyForWrite({ providerIsDynasty: false, existingSettings: confirmed(type) })).toBe(true)
    }
  })

  it('follows a Pirate league\'s stated base, and treats no base as dynasty', () => {
    expect(isDynastyForWrite({ providerIsDynasty: false, existingSettings: confirmed('pirate', 'dynasty') })).toBe(true)
    expect(isDynastyForWrite({ providerIsDynasty: false, existingSettings: confirmed('pirate') })).toBe(true)
    expect(isDynastyForWrite({ providerIsDynasty: false, existingSettings: confirmed('pirate', 'redraft') })).toBe(false)
  })

  it('leaves the provider value alone when nobody confirmed a dynasty type', () => {
    expect(isDynastyForWrite({ providerIsDynasty: false, existingSettings: {} })).toBe(false)
    expect(isDynastyForWrite({ providerIsDynasty: false, existingSettings: null })).toBe(false)
    expect(isDynastyForWrite({ providerIsDynasty: undefined, existingSettings: undefined })).toBeUndefined()
    expect(isDynastyForWrite({ providerIsDynasty: false, existingSettings: confirmed('keeper') })).toBe(false)
    expect(isDynastyForWrite({ providerIsDynasty: false, existingSettings: confirmed('redraft') })).toBe(false)
  })

  it('never turns a provider\'s dynasty fact off', () => {
    expect(isDynastyForWrite({ providerIsDynasty: true, existingSettings: confirmed('redraft') })).toBe(true)
  })
})

describe('scheduled sync: league state', () => {
  const normalized = { league: { name: 'Fantrax League', season: 2026, isDynasty: false }, rosters: [], source: { source_league_id: 'fx1' } }

  beforeEach(() => {
    vi.clearAllMocks()
    h.update.mockResolvedValue({})
  })

  it('keeps the flag on for a league a person confirmed as dynasty', async () => {
    h.findUnique.mockResolvedValue({ settings: confirmed('dynasty'), name: 'Fantrax League', isDynasty: false })
    await applySleeperScopeToLeague({ leagueId: 'league1', scope: 'league_state', normalized: normalized as never })
    expect(h.update).toHaveBeenCalledTimes(1)
    expect(h.update.mock.calls[0][0].data.isDynasty).toBe(true)
  })

  it('writes the provider value for an unconfirmed league', async () => {
    h.findUnique.mockResolvedValue({ settings: {}, name: 'Fantrax League', isDynasty: false })
    await applySleeperScopeToLeague({ leagueId: 'league1', scope: 'league_state', normalized: normalized as never })
    expect(h.update.mock.calls[0][0].data.isDynasty).toBe(false)
  })
})
