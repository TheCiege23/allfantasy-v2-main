import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  proposalFindMany: vi.fn(),
  runTradeShadowForProposal: vi.fn(),
  shouldRunTradeLive: vi.fn(),
  toTradeCard: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { redraftTradeProposal: { findMany: mocks.proposalFindMany } },
}))
vi.mock('@/lib/decision-os/trade/shadow', () => ({
  runTradeShadowForProposal: mocks.runTradeShadowForProposal,
  shouldRunTradeLive: mocks.shouldRunTradeLive,
}))
vi.mock('@/lib/decision-os/trade/tradeCardAdapter', () => ({
  toTradeCard: mocks.toTradeCard,
}))

import { buildPendingTradeDecisionContext } from '@/lib/chimmy-trade/pendingTradeDecisionGrounding'

function makeProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prop-1',
    seasonId: 'season-1',
    proposerRosterId: 'roster-them',
    receiverRosterId: 'roster-me',
    status: 'pending',
    vetoMode: 'commissioner',
    expiresAt: null,
    createdAt: new Date('2026-08-25T00:00:00.000Z'),
    proposerRoster: { teamName: 'Rival FC', ownerName: 'Rival' },
    assets: [
      {
        fromRosterId: 'roster-them',
        toRosterId: 'roster-me',
        assetType: 'player',
        playerId: 'p1',
        playerName: 'Incoming Guy',
        metadata: {},
      },
      {
        fromRosterId: 'roster-me',
        toRosterId: 'roster-them',
        assetType: 'player',
        playerId: 'p2',
        playerName: 'Outgoing Guy',
        metadata: {},
      },
    ],
    valueSnapshot: { payload: { some: 'snapshot' }, grade: 'B', confidenceScore: 80 },
    ...overrides,
  }
}

function makeDecision(completeness: number) {
  return {
    decision_id: 'dec-1',
    data_completeness: completeness,
    uncertainty_sources: completeness < 100 ? ['projections'] : [],
  }
}

describe('buildPendingTradeDecisionContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.shouldRunTradeLive.mockReturnValue(true)
    mocks.toTradeCard.mockReturnValue({
      title: 'You were offered a trade.',
      subtitle: 'It moves value toward you.',
      detail: 'Consider accepting.',
      grade: 'B',
      fairnessScore: 72,
      legal: true,
      proposalId: 'prop-1',
    })
  })

  it('returns null when nothing is pending, so the prompt gains no empty block', async () => {
    mocks.proposalFindMany.mockResolvedValue([])
    expect(await buildPendingTradeDecisionContext('lg1', 'user-1')).toBeNull()
  })

  it('only looks at trades awaiting this user, not ones they sent', async () => {
    mocks.proposalFindMany.mockResolvedValue([])
    await buildPendingTradeDecisionContext('lg1', 'user-1')

    const where = mocks.proposalFindMany.mock.calls[0][0].where
    expect(where).toMatchObject({
      leagueId: 'lg1',
      status: 'pending',
      receiverRoster: { ownerId: 'user-1' },
    })
  })

  it('relays the Decision OS evaluation for an incoming trade', async () => {
    mocks.proposalFindMany.mockResolvedValue([makeProposal()])
    mocks.runTradeShadowForProposal.mockResolvedValue({
      ran: true,
      proposalId: 'prop-1',
      result: { decision: makeDecision(90) },
    })

    const out = await buildPendingTradeDecisionContext('lg1', 'user-1')

    expect(out).toContain('PENDING INCOMING TRADES (1)')
    expect(out).toContain('Rival FC')
    expect(out).toContain('you receive [Incoming Guy]')
    expect(out).toContain('you send [Outgoing Guy]')
    expect(out).toContain('Decision OS (decision dec-1)')
    expect(out).toContain('grade B')
    expect(out).toContain('data completeness 90/100')
  })

  /*
   * The known way this surface lies: a letter produced from almost nothing,
   * which reads as a considered verdict.
   */
  it('withholds the grade and says why when completeness is low', async () => {
    mocks.proposalFindMany.mockResolvedValue([makeProposal()])
    mocks.runTradeShadowForProposal.mockResolvedValue({
      ran: true,
      proposalId: 'prop-1',
      result: { decision: makeDecision(35) },
    })

    const out = await buildPendingTradeDecisionContext('lg1', 'user-1')

    expect(out).toContain('LOW DATA (35/100)')
    expect(out).not.toContain('grade B')
  })

  it('does not invent a grade when no value snapshot was captured', async () => {
    mocks.proposalFindMany.mockResolvedValue([makeProposal({ valueSnapshot: null })])

    const out = await buildPendingTradeDecisionContext('lg1', 'user-1')

    expect(out).toContain('Decision OS: NOT AVAILABLE')
    expect(mocks.runTradeShadowForProposal).not.toHaveBeenCalled()
  })

  it('honours the DECISION_OS_TRADE_LIVE kill switch and labels the snapshot as historical', async () => {
    mocks.shouldRunTradeLive.mockReturnValue(false)
    mocks.proposalFindMany.mockResolvedValue([makeProposal()])

    const out = await buildPendingTradeDecisionContext('lg1', 'user-1')

    expect(mocks.runTradeShadowForProposal).not.toHaveBeenCalled()
    expect(out).toContain('Decision OS: not enabled')
    expect(out).toContain('never as a current recommendation')
  })

  /*
   * "Could not read" must never render as "you have none" — that is the same
   * confident-wrong failure the league-grounding work closed.
   */
  it('says the inbox was unreadable rather than reporting no trades', async () => {
    mocks.proposalFindMany.mockRejectedValue(new Error('connection lost'))

    const out = await buildPendingTradeDecisionContext('lg1', 'user-1')

    expect(out).toContain('could not be read')
    expect(out).toContain('Do NOT tell the user whether they have trades waiting')
  })

  it('does not substitute its own grade when the evaluator returns nothing', async () => {
    mocks.proposalFindMany.mockResolvedValue([makeProposal()])
    mocks.runTradeShadowForProposal.mockResolvedValue({
      ran: false,
      proposalId: 'prop-1',
      error: 'inputs_unavailable',
    })

    const out = await buildPendingTradeDecisionContext('lg1', 'user-1')

    expect(out).toContain('could not evaluate (inputs_unavailable)')
    expect(out).toContain('Do not substitute your own grade')
  })
})
