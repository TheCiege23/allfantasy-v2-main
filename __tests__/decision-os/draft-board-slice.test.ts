import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Draft OS, 2026-11-20 re-score push: the draft — the board, and Draft OS's pick for the asker when it is their turn —
 * reaches the grounding packet on a draft question, as the exact text the draft board tool returns (`buildDraftContext`).
 * The pick decision gets a shorter budget so the board fits the packet's deadline. "No draft here" is a stated fact,
 * "could not read" is a gap, and neither is confused with a late read.
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

const board = vi.fn()
vi.mock('@/lib/chimmy/draftGrounding', () => ({ buildDraftContext: board }))

const { buildDecisionOsGroundingPacket } = await import('@/lib/decision-os/grounding/packet')
const { serializeDecisionOsGroundingForPrompt } = await import('@/lib/decision-os/grounding/serialize')

const BOARD = 'DRAFT — Sunday League, snake, round 3 of 15, pick 27. YOU ARE ON THE CLOCK.\nDraft OS pick: take Benchy Burner (WR).'

const build = (want: Record<string, boolean>) =>
  buildDecisionOsGroundingPacket({ leagueId: 'lg1', userId: 'u1', sport: 'NFL', season: 2026, want })

describe('grounding packet — the draft board', () => {
  beforeEach(() => {
    board.mockReset()
  })

  it('a draft question carries the board and the pick, whole, with a pick budget inside the packet deadline', async () => {
    board.mockResolvedValue(BOARD)
    const packet = await build({ draftBoard: true })
    expect(board).toHaveBeenCalledWith('lg1', 'u1', { draftOsBudgetMs: expect.any(Number) })
    expect(board.mock.calls[0]![2].draftOsBudgetMs).toBeLessThan(2400)
    expect(packet.draftBoard).toMatchObject({ present: true, value: BOARD })
    const text = serializeDecisionOsGroundingForPrompt(packet)
    expect(text).toContain('The draft (board and your pick)')
    expect(text).toContain('Draft OS pick: take Benchy Burner (WR).')
  })

  it('is not assembled unless asked for', async () => {
    const packet = await build({})
    expect(board).not.toHaveBeenCalled()
    expect(packet.draftBoard).toMatchObject({ present: false, gap: { reason: 'not_requested' } })
  })

  it('a league with no draft says so; a builder that throws is a gap', async () => {
    board.mockResolvedValue(null)
    const none = await build({ draftBoard: true })
    expect(String(none.draftBoard?.value)).toMatch(/no draft session/)
    board.mockRejectedValue(new Error('down'))
    const failed = await build({ draftBoard: true })
    expect(failed.draftBoard).toMatchObject({ present: false, gap: { reason: 'not_computed' } })
  })

  it('a read still running at the deadline is not reported as "no draft"', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      board.mockImplementation(() => new Promise(() => {}))
      const p = build({ draftBoard: true })
      await vi.advanceTimersByTimeAsync(10_000)
      const packet = await p
      expect(packet.draftBoard?.present).toBe(false)
      expect(String(packet.draftBoard?.value ?? '')).not.toMatch(/no draft session/)
    } finally {
      vi.useRealTimers()
    }
  })
})
