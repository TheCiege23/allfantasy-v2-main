import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Trade OS, 2026-11-20 re-score push: the trades waiting on the asker reach the grounding packet on a trade question —
 * the exact text the trade tool returns for "Incoming proposals" (`buildPendingTradeDecisionContext`), each graded by
 * the one trade engine, and every letter it gives goes to the answer check's list. Opt-in, bounded by the packet's
 * deadline; "nothing waiting" is a fact, "could not read" is a gap, and the two are never confused with a late read.
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

const pending = vi.fn()
vi.mock('@/lib/chimmy-trade/pendingTradeDecisionGrounding', () => ({ buildPendingTradeDecisionContext: pending }))

const { buildDecisionOsGroundingPacket } = await import('@/lib/decision-os/grounding/packet')
const { serializeDecisionOsGroundingForPrompt } = await import('@/lib/decision-os/grounding/serialize')

const INBOX = 'PENDING TRADES (1)\n- From Team Rival: you get Benchy Burner, you give Wade Hands. Grade: B for you, D for them.'
const GRADE = { letters: ['B', 'D'], summary: 'This trade grades B for you and D for them.' }

const build = (want: Record<string, boolean>, onTradeGrade?: (g: typeof GRADE) => void) =>
  buildDecisionOsGroundingPacket({ leagueId: 'lg1', userId: 'u1', sport: 'NFL', season: 2026, want, ...(onTradeGrade ? { onTradeGrade } : {}) })

describe('grounding packet — trades waiting on you', () => {
  // A block body: an arrow returning the mock would hand vitest a function it then calls as this hook's teardown.
  beforeEach(() => {
    pending.mockReset()
  })

  it('a trade question carries the graded inbox, whole, and hands each letter to the answer check', async () => {
    pending.mockImplementation(async (_l: string, _u: string, deps: { onGrade?: (g: typeof GRADE) => void }) => {
      deps.onGrade?.(GRADE)
      return INBOX
    })
    const seen: Array<typeof GRADE> = []
    const packet = await build({ pendingTrades: true }, (g) => seen.push(g))
    expect(pending).toHaveBeenCalledWith('lg1', 'u1', expect.objectContaining({ onGrade: expect.any(Function) }))
    expect(packet.pendingTrades).toMatchObject({ present: true, value: INBOX })
    expect(seen).toEqual([GRADE])
    const text = serializeDecisionOsGroundingForPrompt(packet)
    expect(text).toContain('Trades waiting on you (graded)')
    expect(text).toContain('Grade: B for you, D for them.')
  })

  it('is not assembled unless asked for', async () => {
    const packet = await build({})
    expect(pending).not.toHaveBeenCalled()
    expect(packet.pendingTrades).toMatchObject({ present: false, gap: { reason: 'not_requested' } })
  })

  it('nothing waiting is a stated fact; a builder that throws is a gap, never "nothing waiting"', async () => {
    pending.mockResolvedValue(null)
    const none = await build({ pendingTrades: true })
    expect(none.pendingTrades).toMatchObject({ present: true })
    expect(String(none.pendingTrades?.value)).toMatch(/No trade offers are waiting on you/)

    pending.mockRejectedValue(new Error('down'))
    const failed = await build({ pendingTrades: true })
    expect(failed.pendingTrades).toMatchObject({ present: false, gap: { reason: 'not_computed' } })
    expect(String(failed.pendingTrades?.gap?.remedy)).toMatch(/Do not say whether trades are waiting/)
  })

  it('a read still running at the deadline is not reported as "nothing waiting"', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      pending.mockImplementation(() => new Promise(() => {}))
      const p = build({ pendingTrades: true })
      await vi.advanceTimersByTimeAsync(10_000)
      const packet = await p
      expect(packet.pendingTrades?.present).toBe(false)
      expect(String(packet.pendingTrades?.value ?? '')).not.toMatch(/No trade offers/)
    } finally {
      vi.useRealTimers()
    }
  })
})
