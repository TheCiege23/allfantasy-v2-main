import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 2026-11-20 re-score: five feed slices hard-coded `servedFrom: 'store'`, so a fact derived live on a cache miss was
 * labelled as maintained state. The label now comes from the loader's own `drainOutcomes()` record for this build.
 */

const outcomes: Record<string, Record<string, { servedFrom: 'store' | 'live' | 'unavailable' }>> = {}
const RULES = { scoring: { format: 'ppr' } }

vi.mock('@/lib/decision-os/grounding/decisionBridge', () => ({
  loadWaiverDecisionSlice: vi.fn(async () => null),
  loadCommissionerHealthDecisionSlice: vi.fn(async () => null),
}))
vi.mock('@/lib/decision-os/import-os', () => ({
  createImportOsLoaders: () => ({
    loadAssertions: vi.fn(async () => ({ lastSuccessfulSyncAt: null, scopes: [] })),
    drainOutcomes: () => outcomes.import ?? {},
  }),
}))
vi.mock('@/lib/decision-os/league-os', () => ({
  createLeagueOsLoaders: () => ({ loadRules: vi.fn(async () => RULES), drainOutcomes: () => outcomes.league ?? {} }),
}))
vi.mock('@/lib/decision-os/value-os', () => ({
  createValueOsLoaders: () => ({ loadMarket: vi.fn(async () => null), loadDevy: vi.fn(async () => null) }),
}))
vi.mock('@/lib/decision-os/projection-os', () => ({ createProjectionOsLoaders: () => ({ loadFor: vi.fn(async () => null) }) }))
vi.mock('@/lib/chimmy-context/ChimmyContextEngine', () => ({
  ChimmyContextEngine: class {
    loadContext = vi.fn(async () => {
      throw new Error('not under test')
    })
  },
}))
vi.mock('@/lib/intelligence/chimmy/resolveChimmyGrounding', () => ({ resolveCommissionerGroundingOutcome: vi.fn(async () => null) }))
vi.mock('@/lib/intelligence/chimmy/leagueIntelligenceGrounding', () => ({ resolveLeagueIntelligenceGrounding: vi.fn(async () => null) }))
vi.mock('@/lib/intelligence/chimmy/portfolioGrounding', () => ({ resolvePortfolioGrounding: vi.fn(async () => null) }))
vi.mock('@/lib/decision-os/flags', () => ({ resolveDecisionOsFeedFlags: async () => ({ enabled: () => true, killed: [] }) }))

const { buildDecisionOsGroundingPacket } = await import('@/lib/decision-os/grounding/packet')
const build = () => buildDecisionOsGroundingPacket({ leagueId: 'lg1', userId: 'u1', sport: 'NFL', season: 2026, want: { leagueRules: true } })

beforeEach(() => {
  for (const k of Object.keys(outcomes)) delete outcomes[k]
})

describe('feed slices say where they were actually served from', () => {
  it('a live derivation on a cache miss is labelled live', async () => {
    outcomes.import = { assertions: { servedFrom: 'live' } }
    outcomes.league = { rules: { servedFrom: 'live' } }
    const p = await build()
    expect(p.importAssertions.servedFrom).toBe('live')
    expect(p.leagueRules.servedFrom).toBe('live')
  })

  it('a stored entry is labelled store', async () => {
    outcomes.import = { assertions: { servedFrom: 'store' } }
    outcomes.league = { rules: { servedFrom: 'store' } }
    const p = await build()
    expect(p.importAssertions.servedFrom).toBe('store')
    expect(p.leagueRules.servedFrom).toBe('store')
  })

  it('no record keeps the old label', async () => {
    const p = await build()
    expect(p.importAssertions.servedFrom).toBe('store')
    expect(p.leagueRules.servedFrom).toBe('store')
  })
})
