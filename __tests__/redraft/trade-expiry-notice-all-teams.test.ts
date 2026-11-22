import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `expireDueRedraftTradeProposals` (lib/redraft/tradeProposalExpiry.ts) tells every team an offer expired,
 * the same way the lazy expiry in app/api/redraft/trade-votes already does:
 *
 *   - two teams: the DM offer card's `expired` line (`queueTradeStatusInDm`), which both managers see
 *   - three or four teams: one in-app notice to every team, every team named, under the SAME dedupe key
 *     (`redraft_trade:<id>:expired`) as the lazy path, so a click and a sweep can never both send one
 *   - the proposer's existing `trade_expired` learning event is untouched
 *   - nobody is told about an offer the sweep did not expire, and a failed notice never fails the sweep
 *
 * The sweep's claim, decision row and ordering are pinned by trade-proposal-expiry.test.ts, unchanged.
 */

type Row = {
  id: string
  leagueId: string
  seasonId: string
  proposerRosterId: string
  receiverRosterId: string
  additionalRosterIds: string[]
  acceptedRosterIds: string[]
  status: string
  expiresAt: Date
  acceptedAt: Date | null
}

const h = vi.hoisted(() => ({
  proposals: [] as Row[],
  actedOnBeforeClaim: new Set<string>(),
  dispatch: vi.fn(async (_input: unknown) => undefined),
  dm: vi.fn(),
  rosters: vi.fn(),
  learning: vi.fn(async (_input: unknown) => undefined),
  market: vi.fn(async (_input: unknown) => undefined),
}))

const ROSTERS = [
  { id: 'rA', ownerId: 'uA', teamName: 'Alpha', ownerName: 'Ann' },
  { id: 'rB', ownerId: 'uB', teamName: 'Bravo', ownerName: 'Ben' },
  { id: 'rC', ownerId: 'uC', teamName: null, ownerName: 'Cat' },
  { id: 'rD', ownerId: 'uD', teamName: 'Delta', ownerName: 'Dan' },
]

vi.mock('@/lib/prisma', () => {
  const pass = (r: Row, w: { status?: string; acceptedAt?: null; expiresAt?: { lt: Date } }) =>
    (w.status === undefined || r.status === w.status) &&
    (!('acceptedAt' in w) || r.acceptedAt === null) &&
    (w.expiresAt === undefined || r.expiresAt < w.expiresAt.lt)
  const redraftTradeProposal = {
    findMany: vi.fn(async (args: { where: Parameters<typeof pass>[1] }) => h.proposals.filter((r) => pass(r, args.where)).map((r) => ({ ...r }))),
    updateMany: vi.fn(async (args: { where: { id: string } & Parameters<typeof pass>[1]; data: { status: string } }) => {
      const r = h.proposals.find((p) => p.id === args.where.id)
      if (!r) return { count: 0 }
      if (h.actedOnBeforeClaim.has(r.id)) r.status = 'accepted'
      if (!pass(r, args.where)) return { count: 0 }
      r.status = args.data.status
      return { count: 1 }
    }),
  }
  const redraftTradeDecision = { upsert: vi.fn(async () => ({})) }
  const tx = { redraftTradeProposal, redraftTradeDecision }
  return {
    prisma: {
      redraftTradeProposal,
      redraftTradeDecision,
      redraftRoster: {
        findFirst: vi.fn(async (args: { where: { id: string } }) => ({ ownerId: ROSTERS.find((r) => r.id === args.where.id)?.ownerId })),
        findMany: h.rosters,
      },
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    },
  }
})
vi.mock('@/lib/trade-market/redraftTradeMarketEvents', () => ({ recordRedraftTradeMarketEvent: h.market }))
vi.mock('@/lib/ai-learning-system/recordEvent', () => ({ recordAfLearningEvent: h.learning }))
vi.mock('@/lib/ai-learning-system/resolveLeagueSport', () => ({ resolveLeagueSport: vi.fn(async () => 'NFL') }))
vi.mock('@/lib/chat-notifications/tradeOfferDm', () => ({ queueTradeStatusInDm: h.dm }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))

import { expireDueRedraftTradeProposals } from '@/lib/redraft/tradeProposalExpiry'

const NOW = new Date('2026-10-31T12:00:00.000Z')
const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  leagueId: 'L',
  seasonId: 'S',
  proposerRosterId: 'rA',
  receiverRosterId: 'rB',
  additionalRosterIds: [],
  acceptedRosterIds: [],
  status: 'pending',
  expiresAt: new Date(NOW.getTime() - 3600_000),
  acceptedAt: null,
  ...over,
})

/** The dispatcher is reached through a dynamic import; let it settle before reading or ruling it out. */
const flush = () => new Promise((r) => setTimeout(r, 25))
type Sent = { userIds: string[]; title: string; body: string; dedupePrefix: string; category: string }
async function sent(): Promise<Sent[]> {
  await flush()
  return h.dispatch.mock.calls.map((c) => c[0] as Sent)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.actedOnBeforeClaim.clear()
  h.rosters.mockImplementation(async (args: { where: { id: { in: string[] } } }) => ROSTERS.filter((r) => args.where.id.in.includes(r.id)))
})

describe('expireDueRedraftTradeProposals tells every team', () => {
  it('two teams: the DM card gets its expired line, exactly the lazy path’s call; no in-app notice, no roster read', async () => {
    h.proposals = [row('p-2')]
    const r = await expireDueRedraftTradeProposals({ now: NOW })
    expect(r.expired).toBe(1)
    expect(h.dm.mock.calls).toEqual([[{ source: 'redraft', tradeId: 'p-2', status: 'expired' }]])
    expect(await sent()).toEqual([])
    expect(h.rosters).not.toHaveBeenCalled()
  })

  it('a multi-team offer: every team is told, every team named, under the lazy path’s `expired` key', async () => {
    h.proposals = [row('p-4', { additionalRosterIds: ['rC', 'rD'], acceptedRosterIds: ['rB'] })]
    await expireDueRedraftTradeProposals({ now: NOW })
    const all = await sent()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      userIds: ['uA', 'uB', 'uC', 'uD'],
      category: 'trade_proposals',
      title: 'Trade expired',
      body: 'The multi-team trade between Alpha, Bravo, Cat and Delta expired before every team accepted it, so it will not go through.',
      dedupePrefix: 'redraft_trade:p-4:expired',
    })
    // The DM status call is the same no-op it is on the lazy path (a multi-team trade has no card).
    expect(h.dm.mock.calls).toEqual([[{ source: 'redraft', tradeId: 'p-4', status: 'expired' }]])
  })

  it('🛑 the proposer’s existing learning event is exactly as before, once, and to the proposer only', async () => {
    h.proposals = [row('p-3', { additionalRosterIds: ['rC'] })]
    await expireDueRedraftTradeProposals({ now: NOW })
    expect(h.learning.mock.calls).toEqual([
      [
        {
          eventType: 'trade_expired',
          sport: 'NFL',
          leagueId: 'L',
          userId: 'uA',
          source: 'redraft_trade_proposal',
          payload: { proposalId: 'p-3', expiredBy: 'schedule' },
        },
      ],
    ])
    // And each manager hears about it exactly once.
    const all = await sent()
    expect(all.flatMap((s) => s.userIds)).toEqual(['uA', 'uB', 'uC'])
  })

  it('an offer someone acted on between the read and the claim tells nobody', async () => {
    h.proposals = [row('p-raced', { additionalRosterIds: ['rC'] })]
    h.actedOnBeforeClaim.add('p-raced')
    const r = await expireDueRedraftTradeProposals({ now: NOW })
    expect(r.skipped).toBe(1)
    expect(await sent()).toEqual([])
    expect(h.dm).not.toHaveBeenCalled()
  })

  it('a failed notice never fails the sweep: the roster read throws, the offer still counts as expired', async () => {
    h.proposals = [row('p-4', { additionalRosterIds: ['rC'] })]
    h.rosters.mockRejectedValue(new Error('roster read failed'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await expireDueRedraftTradeProposals({ now: NOW })
    expect(r).toMatchObject({ expired: 1, failures: [] })
    expect(h.proposals[0]!.status).toBe('expired')
    expect(h.market).toHaveBeenCalledTimes(1)
    expect(h.learning).toHaveBeenCalledTimes(1)
    expect(await sent()).toEqual([])
    err.mockRestore()
  })

  it('a dispatcher that rejects does not fail the sweep either', async () => {
    h.proposals = [row('p-4', { additionalRosterIds: ['rC'] })]
    h.dispatch.mockRejectedValueOnce(new Error('dispatch failed'))
    const r = await expireDueRedraftTradeProposals({ now: NOW })
    expect(r).toMatchObject({ expired: 1, failures: [] })
    await flush()
    expect(h.dispatch).toHaveBeenCalledTimes(1)
  })

  it('a market event that throws still leaves the teams told (the expiry happened)', async () => {
    h.proposals = [row('p-4', { additionalRosterIds: ['rC'] })]
    h.market.mockRejectedValueOnce(new Error('market event failed'))
    const r = await expireDueRedraftTradeProposals({ now: NOW })
    expect(r.failures).toHaveLength(1)
    const all = await sent()
    expect(all.map((s) => s.dedupePrefix)).toEqual(['redraft_trade:p-4:expired'])
  })
})
