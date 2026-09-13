import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `expireDueRedraftTradeProposals` — scheduled expiry for redraft trade proposals (audit #25).
 *
 * The proposal table is a small in-memory store whose `updateMany` honours the claim's conditions, so what
 * is asserted is the row state the sweep leaves behind — not which calls it made.
 */

const h = vi.hoisted(() => {
  type Row = {
    id: string
    leagueId: string
    seasonId: string
    proposerRosterId: string
    status: string
    expiresAt: Date | null
    acceptedAt: Date | null
  }
  const store = {
    proposals: [] as Row[],
    decisions: new Map<string, { decision: string; decidedByUserId: string | null; decisionReason: string | null }>(),
    /** Proposal ids whose claim should find the row already changed (someone acted between read and claim). */
    actedOnBeforeClaim: new Set<string>(),
    /** Proposal ids whose decision write throws, to prove one failure does not stop the sweep. */
    failDecisionFor: new Set<string>(),
  }

  const passes = (row: Row, where: { status?: string; expiresAt?: { lt: Date } }) =>
    (where.status === undefined || row.status === where.status) &&
    (where.expiresAt === undefined || (row.expiresAt !== null && row.expiresAt < where.expiresAt.lt))

  const redraftTradeProposal = {
    findMany: vi.fn(async (args: { where: { status: string; expiresAt: { lt: Date } }; take: number }) =>
      store.proposals
        .filter((row) => passes(row, args.where))
        .sort((a, b) => a.expiresAt!.getTime() - b.expiresAt!.getTime())
        .slice(0, args.take)
        .map(({ id, leagueId, seasonId, proposerRosterId }) => ({ id, leagueId, seasonId, proposerRosterId })),
    ),
    updateMany: vi.fn(
      async (args: { where: { id: string; status: string; expiresAt: { lt: Date } }; data: { status: string } }) => {
        const row = store.proposals.find((p) => p.id === args.where.id)
        if (!row) return { count: 0 }
        if (store.actedOnBeforeClaim.has(row.id)) row.status = 'accepted'
        if (!passes(row, args.where)) return { count: 0 }
        row.status = args.data.status
        return { count: 1 }
      },
    ),
  }
  const redraftTradeDecision = {
    upsert: vi.fn(
      async (args: {
        where: { proposalId: string }
        create: { decision: string; decidedByUserId: string | null; decisionReason: string | null }
      }) => {
        if (store.failDecisionFor.has(args.where.proposalId)) throw new Error('decision write failed')
        const { decision, decidedByUserId, decisionReason } = args.create
        store.decisions.set(args.where.proposalId, { decision, decidedByUserId, decisionReason })
        return {}
      },
    ),
  }
  const tx = { redraftTradeProposal, redraftTradeDecision }

  const prisma = {
    redraftTradeProposal,
    redraftTradeDecision,
    redraftRoster: { findFirst: vi.fn(async (args: { where: { id: string } }) => ({ ownerId: `owner-of-${args.where.id}` })) },
    $transaction: vi.fn(async (cb: (client: typeof tx) => unknown) => {
      // Model rollback: if the callback throws, restore the proposal rows it touched.
      const snapshot = store.proposals.map((p) => ({ ...p }))
      try {
        return await cb(tx)
      } catch (e) {
        store.proposals = snapshot
        throw e
      }
    }),
  }

  return {
    store,
    prisma,
    marketEvent: vi.fn(async () => undefined),
    learningEvent: vi.fn(async () => undefined),
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/trade-market/redraftTradeMarketEvents', () => ({ recordRedraftTradeMarketEvent: h.marketEvent }))
vi.mock('@/lib/ai-learning-system/recordEvent', () => ({ recordAfLearningEvent: h.learningEvent }))
vi.mock('@/lib/ai-learning-system/resolveLeagueSport', () => ({ resolveLeagueSport: vi.fn(async () => 'NFL') }))

import { expireDueRedraftTradeProposals, SWEEP_EXPIRY_REASON } from '@/lib/redraft/tradeProposalExpiry'

const NOW = new Date('2026-09-13T12:00:00.000Z')
const hoursFromNow = (hours: number) => new Date(NOW.getTime() + hours * 3600 * 1000)

function proposal(id: string, over: Partial<(typeof h.store.proposals)[number]> = {}) {
  return {
    id,
    leagueId: 'league-1',
    seasonId: 'season-1',
    proposerRosterId: `roster-${id}`,
    status: 'pending',
    expiresAt: hoursFromNow(-1),
    acceptedAt: null,
    ...over,
  }
}

const statusOf = (id: string) => h.store.proposals.find((p) => p.id === id)?.status

beforeEach(() => {
  vi.clearAllMocks()
  h.store.proposals = []
  h.store.decisions.clear()
  h.store.actedOnBeforeClaim.clear()
  h.store.failDecisionFor.clear()
})

describe('expireDueRedraftTradeProposals', () => {
  it('🛑 expires a pending proposal past its deadline, with the same side effects as a clicked expiry', async () => {
    h.store.proposals = [proposal('p-due')]

    const result = await expireDueRedraftTradeProposals({ now: NOW })

    expect(result).toEqual({ due: 1, expired: 1, skipped: 0, failures: [] })
    expect(statusOf('p-due')).toBe('expired')
    expect(h.store.decisions.get('p-due')).toEqual({ decision: 'expired', decidedByUserId: null, decisionReason: SWEEP_EXPIRY_REASON })
    expect(h.marketEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tradeProposalId: 'p-due', eventType: 'proposal_expired', leagueId: 'league-1', seasonId: 'season-1' }),
    )
    expect(h.learningEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'trade_expired', userId: 'owner-of-roster-p-due', leagueId: 'league-1' }),
    )
  })

  it('leaves proposals that are not yet due, not pending, or have no deadline untouched', async () => {
    h.store.proposals = [
      proposal('p-future', { expiresAt: hoursFromNow(2) }),
      proposal('p-rejected', { status: 'rejected' }),
      proposal('p-no-deadline', { expiresAt: null }),
    ]

    const result = await expireDueRedraftTradeProposals({ now: NOW })

    expect(result).toEqual({ due: 0, expired: 0, skipped: 0, failures: [] })
    expect(h.store.proposals.map((p) => p.status)).toEqual(['pending', 'rejected', 'pending'])
    expect(h.marketEvent).not.toHaveBeenCalled()
  })

  it('expires an accepted trade still awaiting review — the rule the route already applies on the next click', async () => {
    h.store.proposals = [proposal('p-awaiting-review', { acceptedAt: hoursFromNow(-30) })]
    await expireDueRedraftTradeProposals({ now: NOW })
    expect(statusOf('p-awaiting-review')).toBe('expired')
  })

  it('🛑 leaves alone a proposal someone acted on between the read and the claim, with no side effects', async () => {
    h.store.proposals = [proposal('p-raced')]
    h.store.actedOnBeforeClaim.add('p-raced')

    const result = await expireDueRedraftTradeProposals({ now: NOW })

    expect(result).toEqual({ due: 1, expired: 0, skipped: 1, failures: [] })
    expect(statusOf('p-raced')).toBe('accepted')
    expect(h.store.decisions.has('p-raced')).toBe(false)
    expect(h.marketEvent).not.toHaveBeenCalled()
    expect(h.learningEvent).not.toHaveBeenCalled()
  })

  it('never leaves a proposal expired without its decision row, and one failure does not stop the sweep', async () => {
    h.store.proposals = [proposal('p-bad', { expiresAt: hoursFromNow(-3) }), proposal('p-good', { expiresAt: hoursFromNow(-2) })]
    h.store.failDecisionFor.add('p-bad')

    const result = await expireDueRedraftTradeProposals({ now: NOW })

    expect(result.expired).toBe(1)
    expect(result.failures).toEqual([{ proposalId: 'p-bad', error: 'decision write failed' }])
    // The claim rolled back with the failed decision write.
    expect(statusOf('p-bad')).toBe('pending')
    expect(statusOf('p-good')).toBe('expired')
  })

  it('drains oldest deadlines first, bounded by the limit', async () => {
    h.store.proposals = [
      proposal('p-newest', { expiresAt: hoursFromNow(-1) }),
      proposal('p-oldest', { expiresAt: hoursFromNow(-9) }),
      proposal('p-middle', { expiresAt: hoursFromNow(-5) }),
    ]

    const result = await expireDueRedraftTradeProposals({ now: NOW, limit: 2 })

    expect(result).toMatchObject({ due: 2, expired: 2 })
    expect(statusOf('p-oldest')).toBe('expired')
    expect(statusOf('p-middle')).toBe('expired')
    expect(statusOf('p-newest')).toBe('pending')
  })
})
