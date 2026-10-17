/**
 * Pending incoming trades in Chimmy's prompt carry the ONE grade (design step 7, 2026-09-27): each
 * proposal goes through `evaluateStoredTrade`, the path every trade screen uses — never the
 * proposal-time snapshot letter, and never a letter Chimmy makes up.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  proposalFindMany: vi.fn(),
  evaluate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { redraftTradeProposal: { findMany: mocks.proposalFindMany } },
}))
vi.mock('@/lib/decision-os/trade/evaluateStoredTrade', () => ({ evaluateStoredTrade: mocks.evaluate }))

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
      { fromRosterId: 'roster-them', toRosterId: 'roster-me', assetType: 'player', playerId: 'p1', playerName: 'Incoming Guy', metadata: {} },
      { fromRosterId: 'roster-me', toRosterId: 'roster-them', assetType: 'player', playerId: 'p2', playerName: 'Outgoing Guy', metadata: {} },
    ],
    ...overrides,
  }
}

function evaluated(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    receipt: {
      receiptId: 'rcpt_pending',
      grade: { graded: true, letter: 'B', label: 'Slightly favors you', giveValue: 4000, getValue: 4600 },
      partnerGrade: { graded: true, letter: 'C-' },
      canonical: {
        proposerRosterId: 'roster-me',
        receiverRosterId: 'roster-them',
        participants: [
          { rosterId: 'roster-me', rosterImpact: { week: 4, startingPointsBefore: 112, startingPointsAfter: 115.5, startingPointsDelta: 3.5 } },
          { rosterId: 'roster-them', rosterImpact: { week: 4, startingPointsBefore: 120, startingPointsAfter: 110, startingPointsDelta: -10 } },
        ],
      },
      ...over,
    },
    trade: {},
    perspectiveTeamId: 'roster-me',
    viewerInTrade: true,
  }
}

describe('buildPendingTradeDecisionContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.proposalFindMany.mockResolvedValue([makeProposal()])
    mocks.evaluate.mockResolvedValue(evaluated())
  })

  it('returns null when nothing is pending, so the prompt gains no empty block', async () => {
    mocks.proposalFindMany.mockResolvedValue([])
    expect(await buildPendingTradeDecisionContext('lg1', 'user-1')).toBeNull()
  })

  it('only looks at trades awaiting this user, not ones they sent — and never reads the snapshot letter', async () => {
    await buildPendingTradeDecisionContext('lg1', 'user-1')
    const args = mocks.proposalFindMany.mock.calls[0]![0]
    expect(args.where).toMatchObject({ leagueId: 'lg1', status: 'pending', receiverRoster: { ownerId: 'user-1' } })
    // The proposal-time `valueSnapshot.grade` is its own A+..F scale; it is not even selected.
    expect(args.select).not.toHaveProperty('valueSnapshot')
  })

  it('evaluates each proposal through the one engine, as the asker, on its own surface', async () => {
    await buildPendingTradeDecisionContext('lg1', 'user-1')
    expect(mocks.evaluate).toHaveBeenCalledWith({
      leagueId: 'lg1',
      ref: { kind: 'redraft', proposalId: 'prop-1' },
      userId: 'user-1',
      surface: 'chimmy-pending',
    })
  })

  it('relays the one grade, both letters, the values, this week’s lineup and the receipt', async () => {
    const out = await buildPendingTradeDecisionContext('lg1', 'user-1')
    expect(out).toContain('Proposal prop-1 from Rival FC: you receive [Incoming Guy], you send [Outgoing Guy].')
    expect(out).toContain('you B — Slightly favors you; Rival FC C-.')
    expect(out).toContain('League value: you send 4,000, you receive 4,600.')
    expect(out).toContain("week 4 projections under this league's rules: 112.0 before, 115.5 after (+3.5). One week, not the season.")
    expect(out).toContain('Evaluation receipt: rcpt_pending.')
  })

  it('tells the chat route the letters the one engine gave, for its answer check', async () => {
    const onGrade = vi.fn()
    await buildPendingTradeDecisionContext('lg1', 'user-1', { onGrade })
    expect(onGrade).toHaveBeenCalledWith({
      letters: ['B', 'C-'],
      summary: 'AllFantasy grades the offer from Rival FC (you receive [Incoming Guy], you send [Outgoing Guy]): B for you, C- for Rival FC.',
    })
    // A refused or withheld grade gives no letters to allow.
    onGrade.mockClear()
    mocks.evaluate.mockResolvedValue({ ok: false, refusal: { code: 'not_found', reason: 'gone' } })
    await buildPendingTradeDecisionContext('lg1', 'user-1', { onGrade })
    expect(onGrade).not.toHaveBeenCalled()
  })

  it('🛑 states the psychology framing-only rule, every time — this surface never runs through the packet serializer', async () => {
    const out = await buildPendingTradeDecisionContext('lg1', 'user-1')
    expect(out).toMatch(/never to argue the grade above should be different/)
    expect(out).toMatch(/AllFantasy never accepts, rejects, counters or vetoes a trade/)
  })

  it('a trade the engine refuses says why, and carries no letter', async () => {
    mocks.evaluate.mockResolvedValue({ ok: false, refusal: { code: 'asset_moved', reason: 'Incoming Guy is no longer on the roster sending him.' } })
    const out = await buildPendingTradeDecisionContext('lg1', 'user-1')
    expect(out).toContain('Grade: NOT AVAILABLE — Incoming Guy is no longer on the roster sending him. Do not grade it yourself.')
    expect(out).not.toMatch(/you [A-F][+-]? —/)
  })

  it('a withheld grade says why, and carries no letter', async () => {
    mocks.evaluate.mockResolvedValue(evaluated({ grade: { graded: false, reason: 'Outgoing Guy has no value on this league’s chart.' } }))
    const out = await buildPendingTradeDecisionContext('lg1', 'user-1')
    expect(out).toContain('Grade: NOT GRADED — Outgoing Guy has no value on this league’s chart. Do not grade it yourself.')
  })

  it('no receipt (before the receipts migration) is simply not named', async () => {
    mocks.evaluate.mockResolvedValue(evaluated({ receiptId: null }))
    const out = await buildPendingTradeDecisionContext('lg1', 'user-1')
    expect(out).not.toMatch(/Evaluation receipt/)
    expect(out).toContain('you B')
  })

  it('does not depend on the Decision OS kill switch — the one grade shows everywhere', async () => {
    const before = process.env.DECISION_OS_TRADE_LIVE
    delete process.env.DECISION_OS_TRADE_LIVE
    try {
      expect(await buildPendingTradeDecisionContext('lg1', 'user-1')).toContain('you B')
    } finally {
      if (before !== undefined) process.env.DECISION_OS_TRADE_LIVE = before
    }
  })

  it('says the inbox was unreadable rather than reporting no trades', async () => {
    mocks.proposalFindMany.mockRejectedValue(new Error('db down'))
    const out = await buildPendingTradeDecisionContext('lg1', 'user-1')
    expect(out).toMatch(/could not be read just now/)
    expect(out).toMatch(/Do NOT tell the user whether they have trades waiting/)
  })

  it('does not substitute its own grade when the evaluator throws', async () => {
    mocks.evaluate.mockRejectedValue(new Error('boom'))
    const out = await buildPendingTradeDecisionContext('lg1', 'user-1')
    expect(out).toContain('Grade: evaluation failed. Do not substitute your own grade.')
    expect(out).not.toMatch(/you [A-F][+-]? —/)
  })
})
