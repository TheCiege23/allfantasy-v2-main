// @vitest-environment node
/**
 * Pending offers expire at the trade deadline, on both engines, and both sides are told.
 * The deadline verdict is the REAL one (tradeDeadlineWindow), fed by a season row in the double.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { expirePendingOffersAtDeadline } from '@/lib/trade-deadline/expireOffersAtDeadline'

const L = 'league-1'

function makeDeps(opts: { week: number; deadlineWeek: number | null; seasonStatus?: string }) {
  const league = {
    id: L, settings: null, platform: 'allfantasy', lifecycleState: 'in_season', tradeDeadlineWeek: opts.deadlineWeek,
    timezone: 'America/New_York', lockAllMoves: false, bestBallMode: false, guillotineMode: false, leagueVariant: null,
  }
  const proposals = [
    { id: 'p1', seasonId: 's1', proposerRosterId: 'rA', receiverRosterId: 'rB', status: 'pending', acceptedAt: null },
  ]
  const decisions: unknown[] = []
  const claim = vi.fn(async ({ where }: { where: { id: string } }) => {
    const p = proposals.find((x) => x.id === where.id && x.status === 'pending')
    if (!p) return { count: 0 }
    p.status = 'expired'
    return { count: 1 }
  })
  const tx = {
    redraftTradeProposal: { updateMany: claim },
    redraftTradeDecision: { upsert: vi.fn(async (a: unknown) => decisions.push(a)) },
  }
  const db = {
    afLeagueTrade: {
      findMany: vi.fn(async ({ distinct }: { distinct?: string[] }) => (distinct ? [{ leagueId: L }] : [{ id: 't1' }, { id: 't2' }])),
    },
    redraftTradeProposal: {
      findMany: vi.fn(async ({ distinct }: { distinct?: string[] }) =>
        distinct ? [{ leagueId: L }] : proposals.filter((p) => p.status === 'pending')),
    },
    redraftRoster: { findMany: vi.fn(async () => [{ ownerId: 'uA' }, { ownerId: 'uB' }]) },
    $transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
  }
  const deps = {
    db: db as never,
    leagueDb: { league: { findUnique: vi.fn(async () => league) } } as never,
    prisma: { redraftSeason: { findFirst: vi.fn(async () => ({ id: 's1', currentWeek: opts.week, status: opts.seasonStatus ?? 'active' })) } } as never,
    resolveWeek: async () => opts.week,
    expireAf: vi.fn(async () => true),
    notify: vi.fn(async () => undefined),
    recordMarketEvent: vi.fn(async () => undefined),
  }
  return { deps, claim, decisions, proposals }
}

describe('expirePendingOffersAtDeadline', () => {
  beforeEach(() => vi.clearAllMocks())

  it('after the deadline (week 12, deadline 11): every pending offer on both engines expires and both managers are told', async () => {
    const { deps, decisions } = makeDeps({ week: 12, deadlineWeek: 11 })
    const out = await expirePendingOffersAtDeadline({ deps })
    expect(out).toMatchObject({ leaguesChecked: 1, leaguesPastDeadline: 1, expiredAf: 2, expiredRedraft: 1, failures: [] })
    expect(deps.expireAf).toHaveBeenCalledWith({ tradeId: 't1', leagueId: L, reason: 'Trade deadline passed after Week 11.' })
    expect(decisions).toHaveLength(1)
    expect(deps.notify).toHaveBeenCalledWith({ userIds: ['uA', 'uB'], leagueId: L, tradeId: 'p1', reason: 'Trade deadline passed after Week 11.' })
  })

  it('the deadline week itself is still open: nothing expires in week 11', async () => {
    const { deps, claim } = makeDeps({ week: 11, deadlineWeek: 11 })
    const out = await expirePendingOffersAtDeadline({ deps })
    expect(out).toMatchObject({ leaguesPastDeadline: 0, expiredAf: 0, expiredRedraft: 0 })
    expect(deps.expireAf).not.toHaveBeenCalled()
    expect(claim).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
  })

  it('a finished season does not expire offseason offers against last season\'s deadline', async () => {
    const { deps } = makeDeps({ week: 17, deadlineWeek: 11, seasonStatus: 'complete' })
    const out = await expirePendingOffersAtDeadline({ deps })
    expect(out.expiredAf + out.expiredRedraft).toBe(0)
  })

  it('an offer someone acted on between the read and the claim is left alone and nobody is notified', async () => {
    const { deps, proposals } = makeDeps({ week: 12, deadlineWeek: 11 })
    const db = deps.db as unknown as { redraftTradeProposal: { findMany: ReturnType<typeof vi.fn> } }
    db.redraftTradeProposal.findMany.mockImplementation(async ({ distinct }: { distinct?: string[] }) => {
      if (distinct) return [{ leagueId: L }]
      const snapshot = proposals.map((p) => ({ ...p }))
      proposals[0].status = 'accepted' // accepted at the same instant
      return snapshot
    })
    const out = await expirePendingOffersAtDeadline({ deps })
    expect(out.expiredRedraft).toBe(0)
    expect(deps.notify).not.toHaveBeenCalled()
  })
})
