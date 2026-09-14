import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The packet hands `onWaiverClaims` to the waiver bridge (Chimmy advice receipts, user decision
 * 2026-09-14) — and ONLY when the waiver slice is asked for. The sink is a side channel: it is not
 * part of the packet the serializer reads.
 */

const loadWaiver = vi.fn()

vi.mock('@/lib/decision-os/grounding/decisionBridge', () => ({
  loadWaiverDecisionSlice: loadWaiver,
  loadLineupDecisionSlice: vi.fn(async () => null),
  loadCommissionerHealthDecisionSlice: vi.fn(async () => null),
}))
vi.mock('@/lib/decision-os/import-os', () => ({ createImportOsLoaders: () => ({ loadAssertions: vi.fn(async () => null) }) }))
vi.mock('@/lib/decision-os/league-os', () => ({ createLeagueOsLoaders: () => ({ loadRules: vi.fn(async () => null) }) }))
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
vi.mock('@/lib/decision-os/flags', () => ({
  resolveDecisionOsFeedFlags: async () => ({ enabled: () => true, killed: [] }),
}))

const { buildDecisionOsGroundingPacket } = await import('@/lib/decision-os/grounding/packet')

const waiverSlice = {
  present: false,
  value: null,
  asOf: null,
  servedFrom: null,
  confidence: null,
  conclusive: { ok: true },
  gap: { reason: 'not_synced', detail: 'x', remedy: 'y' },
}

describe('grounding packet — onWaiverClaims side channel', () => {
  beforeEach(() => {
    loadWaiver.mockReset()
    loadWaiver.mockResolvedValue(waiverSlice)
  })

  it('🛑 passes the sink to the waiver bridge when the waiver slice is wanted', async () => {
    const sink = vi.fn()
    const packet = await buildDecisionOsGroundingPacket({
      leagueId: 'lg1',
      userId: 'u1',
      sport: 'NFL',
      season: 2026,
      want: { waiverDecision: true },
      onWaiverClaims: sink,
    })
    expect(loadWaiver).toHaveBeenCalledWith({ userId: 'u1', leagueId: 'lg1', onClaims: sink })
    expect(JSON.stringify(packet)).not.toContain('onClaims')
  })

  it('does not run the waiver bridge (or reach the sink) when the slice is not wanted', async () => {
    await buildDecisionOsGroundingPacket({ leagueId: 'lg1', userId: 'u1', sport: 'NFL', season: 2026, want: {}, onWaiverClaims: vi.fn() })
    expect(loadWaiver).not.toHaveBeenCalled()
  })
})
