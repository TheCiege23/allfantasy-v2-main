import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Decision OS hub, routing and assembly (2026-11-20).
 *
 * Routing: a chat turn is classified ONCE (`classifyChimmyTurn`), and the packet and the prompt read that one answer —
 * they used to classify separately and disagree on every follow-up. The commissioner's activity read follows the same
 * intent as the health decision instead of its own word list.
 *
 * Assembly: the slices that answer the question lead the packet text (`ANSWERING_SLICES_BY_INTENT`).
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
const commissionerOutcome = vi.fn(async () => ({ status: 'ok' as const, text: 'ACTIVITY LOG' }))
vi.mock('@/lib/intelligence/chimmy/resolveChimmyGrounding', () => ({ resolveCommissionerGroundingOutcome: commissionerOutcome }))
vi.mock('@/lib/intelligence/chimmy/leagueIntelligenceGrounding', () => ({ resolveLeagueIntelligenceGrounding: vi.fn(async () => null) }))
vi.mock('@/lib/intelligence/chimmy/portfolioGrounding', () => ({ resolvePortfolioGrounding: vi.fn(async () => null) }))
vi.mock('@/lib/decision-os/flags', () => ({
  resolveDecisionOsFeedFlags: async () => ({ enabled: () => true, killed: [] }),
}))
vi.mock('@/lib/chimmy/myTeamLineupGrounding', () => ({ buildMyTeamLineupContext: vi.fn(async () => 'LINEUP TEXT') }))
vi.mock('@/lib/chimmy-trade/pendingTradeDecisionGrounding', () => ({ buildPendingTradeDecisionContext: vi.fn(async () => 'INBOX TEXT') }))
vi.mock('@/lib/chimmy/draftGrounding', () => ({ buildDraftContext: vi.fn(async () => 'BOARD TEXT') }))
vi.mock('@/lib/chimmy/managerRecordGrounding', () => ({ buildManagerRecordContext: vi.fn(async () => ({ text: 'RECORDS TEXT', locked: false })) }))

const { classifyChimmyIntent, classifyChimmyTurn } = await import('@/lib/chimmy-orchestration/intent-classifier')
const { deriveWantFromIntent } = await import('@/lib/decision-os/grounding/intentToWant')
const { buildDecisionOsGroundingPacket } = await import('@/lib/decision-os/grounding/packet')
const { serializeDecisionOsGroundingForPrompt } = await import('@/lib/decision-os/grounding/serialize')

describe('routing: one classification per turn', () => {
  it('a follow-up that names nothing keeps the previous turn’s intent', () => {
    expect(classifyChimmyIntent('what about Jaylen Waddle instead?').intent).toBe('general')
    expect(classifyChimmyTurn('what about Jaylen Waddle instead?', 'should I accept this trade offer for Puka?').intent).toBe('trade')
  })

  it('🛑 the current question decides — an earlier turn cannot take a branch above it', () => {
    const before = 'who should I pick up off waivers this week?'
    const now = "should I accept Bob's trade offer?"
    // The control: joining the turns, as the prompt side did, made this a waiver turn (waiver sits above trade).
    expect(classifyChimmyIntent(now, before).intent).toBe('waiver')
    expect(classifyChimmyTurn(now, before).intent).toBe('trade')
  })

  it('a rules question stays general, even after a trade turn', () => {
    expect(classifyChimmyTurn('how does PPR scoring work?', 'should I trade for Puka?').intent).toBe('general')
  })

  it('with no earlier turn it is the single-message classification', () => {
    for (const q of ['who should I start, Mahomes or Allen?', 'hello', 'any pending trade offers?']) {
      expect(classifyChimmyTurn(q)).toEqual(classifyChimmyIntent(q))
      expect(classifyChimmyTurn(q, '  ')).toEqual(classifyChimmyIntent(q))
    }
  })
})

describe('routing: a league’s inactive and abandoned managers are a commissioner question', () => {
  it.each([
    'which managers are inactive?',
    'who has been inactive in my league?',
    'are there any abandoned teams?',
    'did an owner abandon his team?',
    "how is my league's health?",
    'what are my action items?',
  ])('%s', (q) => {
    expect(classifyChimmyTurn(q).intent).toBe('commissioner')
    expect(deriveWantFromIntent(classifyChimmyTurn(q).intent).commissionerHealthDecision).toBe(true)
  })

  it.each([
    ['is Cooper Kupp inactive this week?', 'general'],
    ['which players on my team are inactive?', 'general'],
    ['should I trade with the inactive manager?', 'trade'],
    ['who should I pick up from an inactive team?', 'waiver'],
  ])('near miss: %s stays %s', (q, intent) => {
    expect(classifyChimmyTurn(q).intent).toBe(intent)
  })
})

describe('routing: the commissioner’s activity read follows the health decision’s intent', () => {
  beforeEach(() => commissionerOutcome.mockClear())
  const base = { leagueId: 'lg1', userId: 'u1', sport: 'NFL', season: 2026 }

  it('not asked: never runs, even when the question has its old trigger words', async () => {
    const p = await buildDecisionOsGroundingPacket({ ...base, question: 'any pending trade offers recently?', want: { pendingTrades: true } })
    expect(commissionerOutcome).not.toHaveBeenCalled()
    expect(p.commissionerIntelligence.present).toBe(false)
    expect(p.gaps.find((g) => g.slice === 'commissionerIntelligence')).toBeUndefined()
  })

  it('a commissioner question: runs, flagged as asked, whatever its words', async () => {
    const p = await buildDecisionOsGroundingPacket({ ...base, question: 'which managers are inactive?', want: { commissionerHealthDecision: true } })
    expect(commissionerOutcome).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'lg1', userId: 'u1', commissionerFlag: true }))
    expect(p.commissionerIntelligence).toMatchObject({ present: true, value: 'ACTIVITY LOG' })
  })
})

describe('assembly: what answers the question leads the packet', () => {
  const build = () =>
    buildDecisionOsGroundingPacket({
      leagueId: 'lg1',
      userId: 'u1',
      sport: 'NFL',
      season: 2026,
      want: { myTeamLineup: true, pendingTrades: true, draftBoard: true, managerRecords: true },
    })
  const NOW = Date.parse('2026-11-20T12:00:00Z')

  it('no intent: the usual order, byte for byte', async () => {
    const p = await build()
    expect(serializeDecisionOsGroundingForPrompt(p, NOW, {})).toBe(serializeDecisionOsGroundingForPrompt(p, NOW))
    const text = serializeDecisionOsGroundingForPrompt(p, NOW)
    expect(text.indexOf('LINEUP TEXT')).toBeLessThan(text.indexOf('BOARD TEXT'))
  })

  it('a draft question puts the board first and names it; nothing is dropped', async () => {
    const p = await build()
    const plain = serializeDecisionOsGroundingForPrompt(p, NOW)
    const text = serializeDecisionOsGroundingForPrompt(p, NOW, { intent: 'draft', intentLabel: 'Draft strategy' })
    expect(text).toContain('(This question: Draft strategy. What answers it is listed first: The draft (board and your pick).)')
    expect(text.indexOf('BOARD TEXT')).toBeLessThan(text.indexOf('LINEUP TEXT'))
    for (const s of ['LINEUP TEXT', 'INBOX TEXT', 'BOARD TEXT', 'RECORDS TEXT']) expect(text).toContain(s)
    // Same lines, one added: reordered, not rewritten.
    const lines = (t: string) => t.split('\n').filter((l) => !l.startsWith('  (This question'))
    expect([...lines(text)].sort()).toEqual([...lines(plain)].sort())
  })

  it('a trade question leads with the graded offers', async () => {
    const text = serializeDecisionOsGroundingForPrompt(await build(), NOW, { intent: 'trade', intentLabel: 'Trade analysis' })
    const avail = text.indexOf('WHAT IS AVAILABLE:')
    expect(text.indexOf('INBOX TEXT')).toBeGreaterThan(avail)
    expect(text.indexOf('INBOX TEXT')).toBeLessThan(text.indexOf('LINEUP TEXT'))
  })

  it('⚠ a slice that did not render is never named as the answer', async () => {
    const p = await build()
    // A waiver question whose decision is absent: no lead line, the usual order.
    expect(serializeDecisionOsGroundingForPrompt(p, NOW, { intent: 'waiver', intentLabel: 'Waiver / adds' })).toBe(
      serializeDecisionOsGroundingForPrompt(p, NOW),
    )
  })
})
