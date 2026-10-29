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

describe('a dynasty league whose pick trades have their own deadline (lib/trade-deadline/pickTradeDeadline.ts)', () => {
  const PICKS_ONLY = { id: 'tPicks', items: [{ itemType: 'rookie_pick' }, { itemType: 'future_pick' }] }
  const MIXED = { id: 'tMixed', items: [{ itemType: 'rookie_pick' }, { itemType: 'player' }] }

  function dynastyDeps(week: number, rule: unknown) {
    const built = makeDeps({ week, deadlineWeek: 11 })
    const league = {
      id: L, settings: { pick_trade_deadline: rule }, platform: 'allfantasy', lifecycleState: 'in_season', tradeDeadlineWeek: 11,
      timezone: 'America/New_York', lockAllMoves: false, bestBallMode: false, guillotineMode: false, leagueVariant: null, leagueType: 'dynasty',
    }
    const deps = {
      ...built.deps,
      leagueDb: { league: { findUnique: vi.fn(async () => league) } } as never,
      db: {
        ...(built.deps.db as unknown as Record<string, unknown>),
        afLeagueTrade: { findMany: vi.fn(async ({ distinct }: { distinct?: string[] }) => (distinct ? [{ leagueId: L }] : [PICKS_ONLY, MIXED])) },
        redraftTradeProposal: { findMany: vi.fn(async () => []) },
      } as never,
    }
    return deps
  }
  const expired = (deps: { expireAf: ReturnType<typeof vi.fn> }) => deps.expireAf.mock.calls.map((c) => (c[0] as { tradeId: string }).tradeId)

  it('open all season: past the trade deadline only the offer with a player in it expires', async () => {
    const deps = dynastyDeps(12, { mode: 'open' })
    const out = await expirePendingOffersAtDeadline({ deps })
    expect(expired(deps)).toEqual(['tMixed'])
    expect(out).toMatchObject({ leaguesPastDeadline: 1, expiredAf: 1 })
  })

  it('🛑 a pick week before the trade deadline expires the picks-only offer while player trades are open', async () => {
    const deps = dynastyDeps(9, { mode: 'week', week: 8 })
    await expirePendingOffersAtDeadline({ deps })
    expect(expired(deps)).toEqual(['tPicks'])
    expect(deps.expireAf).toHaveBeenCalledWith({ tradeId: 'tPicks', leagueId: L, reason: 'Pick trades closed after Week 8.' })
  })

  it('past both, each offer expires with the reason its own rule gives', async () => {
    const deps = dynastyDeps(17, { mode: 'week', week: 16 })
    await expirePendingOffersAtDeadline({ deps })
    expect(deps.expireAf.mock.calls.map((c) => c[0])).toEqual([
      { tradeId: 'tPicks', leagueId: L, reason: 'Pick trades closed after Week 16.' },
      { tradeId: 'tMixed', leagueId: L, reason: 'Trade deadline passed after Week 11.' },
    ])
  })

  it('before either, nothing expires and nothing is read past the verdicts', async () => {
    const deps = dynastyDeps(8, { mode: 'week', week: 16 })
    const out = await expirePendingOffersAtDeadline({ deps })
    expect(out).toMatchObject({ leaguesPastDeadline: 0, expiredAf: 0 })
  })
})
