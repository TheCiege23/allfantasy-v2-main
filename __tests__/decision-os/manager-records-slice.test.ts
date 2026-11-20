import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Manager Psychology (facts only), 2026-11-20 re-score push: every leaguemate's record reaches the grounding packet on a
 * manager question, as the exact text the manager-record tool returns with no manager named, with its facts-only
 * contract. 🛑 Competitive Edge only: a locked plan puts NO history in the packet — only a not_entitled gap.
 */

vi.mock('@/lib/decision-os/grounding/decisionBridge', () => ({
  loadWaiverDecisionSlice: vi.fn(async () => null),
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

const records = vi.fn()
vi.mock('@/lib/chimmy/managerRecordGrounding', () => ({ buildManagerRecordContext: records }))

const { buildDecisionOsGroundingPacket } = await import('@/lib/decision-os/grounding/packet')
const { serializeDecisionOsGroundingForPrompt } = await import('@/lib/decision-os/grounding/serialize')

const SUMMARY =
  'MANAGER RECORDS — every other manager in Sunday League. FACTS ONLY. Never label the manager.\nPat: 6 trades, 14 waiver claims this season, $37 FAAB left, 3 drafts on file'

const build = (want: Record<string, boolean>) =>
  buildDecisionOsGroundingPacket({ leagueId: 'lg1', userId: 'u1', sport: 'NFL', season: 2026, want })

describe('grounding packet — leaguemates’ records', () => {
  beforeEach(() => {
    records.mockReset()
  })

  it('an entitled manager question carries every leaguemate’s record, with the facts-only contract', async () => {
    records.mockResolvedValue({ text: SUMMARY, locked: false })
    const packet = await build({ managerRecords: true })
    expect(records).toHaveBeenCalledWith({ leagueId: 'lg1', userId: 'u1', manager: null })
    expect(packet.managerRecords).toMatchObject({ present: true, value: SUMMARY })
    const text = serializeDecisionOsGroundingForPrompt(packet)
    expect(text).toContain('Leaguemates’ records (facts only)')
    expect(text).toContain('Pat: 6 trades, 14 waiver claims this season, $37 FAAB left')
    expect(text).toContain('FACTS ONLY')
  })

  it('🛑 without Competitive Edge the packet carries no history at all — only the gap', async () => {
    records.mockResolvedValue({ text: 'NOT RUN: … Pat: 6 trades (must never reach the prompt)', locked: true })
    const packet = await build({ managerRecords: true })
    expect(packet.managerRecords).toMatchObject({ present: false, gap: { reason: 'not_entitled' } })
    const text = serializeDecisionOsGroundingForPrompt(packet)
    expect(text).not.toContain('Pat: 6 trades')
  })

  it('is not assembled unless asked for; a builder that throws is a gap', async () => {
    expect((await build({})).managerRecords).toMatchObject({ present: false, gap: { reason: 'not_requested' } })
    expect(records).not.toHaveBeenCalled()
    records.mockRejectedValue(new Error('down'))
    expect((await build({ managerRecords: true })).managerRecords).toMatchObject({ present: false, gap: { reason: 'not_computed' } })
  })
})
