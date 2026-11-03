/**
 * Multi-team (3- and 4-team) native trades: who is told when one is vetoed, closed or reversed.
 *
 * A two-team trade tells its two managers through the offer card in their DM. A multi-team trade has
 * no card (lib/redraft/multiTeamTradeNotices.ts), so a reader that only queued the DM status left
 * every team in it uninformed; and the reversal notice resolved only the proposer and the receiver.
 * Each multi-team case is paired with the two-team case it must leave exactly as it was.
 *
 *   - app/api/redraft/trades/veto/route.ts
 *   - lib/redraft/tradeReviewWindowSweep.ts      (the "could not be processed" close)
 *   - lib/trade-reversal/notice.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  commissioner: vi.fn(async () => true),
  notify: vi.fn(),
  dispatch: vi.fn(async (_input: unknown) => undefined),
  dm: vi.fn(),
  market: vi.fn(async () => ({})),
  learning: vi.fn(async () => undefined),
  finalize: vi.fn(),
  decision: vi.fn(async () => ({})),
  publish: vi.fn(async () => undefined),
  ingest: vi.fn(async () => ({ dispatched: true })),
  prisma: {
    redraftTradeProposal: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn(async () => 0) },
    redraftTradeDecision: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})), update: vi.fn() },
    redraftRoster: { findMany: vi.fn() },
    afLeagueTrade: { findUnique: vi.fn(async () => null) },
  },
}))

vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/league/permissions', () => ({ hasLeagueCommissionerRights: m.commissioner }))
vi.mock('@/lib/ai-learning-system/recordTradeParticipants', () => ({ recordTradeOutcomeForBothManagers: m.learning }))
vi.mock('@/lib/trade-market/redraftTradeMarketEvents', () => ({ recordRedraftTradeMarketEvent: m.market }))
vi.mock('@/lib/chat-notifications/tradeOfferDm', () => ({ queueTradeStatusInDm: m.dm }))
vi.mock('@/lib/redraft/multiTeamTradeNotices', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/redraft/multiTeamTradeNotices')>()),
  notifyMultiTeamTradeParties: m.notify,
}))
// The veto route now goes through notifyMultiTeamTradeOutcome, whose call to notifyMultiTeamTradeParties
// stays inside the module and so never reaches the `m.notify` mock above: what it sends is read here.
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.dispatch }))
vi.mock('@/lib/redraft/tradeMoveLock', () => ({ isRedraftLeagueMovesLocked: vi.fn(async () => false) }))
vi.mock('@/lib/redraft/finalizeRedraftTrade', () => ({ finalizeRedraftTrade: m.finalize, upsertRedraftTradeDecision: m.decision }))
vi.mock('@/lib/integrity/holdFlaggedTrades', () => ({ heldTradeIds: vi.fn(async () => []) }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: m.publish }))
vi.mock('@/lib/notification-engine', () => ({ ingest: m.ingest, tradeEvent: (opts: unknown) => opts }))

import { POST as vetoPOST } from '@/app/api/redraft/trades/veto/route'
import { processDueTradeReviews } from '@/lib/redraft/tradeReviewWindowSweep'
import {
  TRADE_REVERSED_MESSAGE,
  TRADE_REVERSED_MULTI_TEAM_MESSAGE,
  publishTradeReversalNotice,
} from '@/lib/trade-reversal/notice'
import { multiTeamTradeVetoedBody } from '@/lib/redraft/multiTeamTradeNotices'

const OWNERS = [
  { id: 'rA', ownerId: 'uA', teamName: 'Alpha', ownerName: 'Ann' },
  { id: 'rB', ownerId: 'uB', teamName: 'Bravo', ownerName: 'Ben' },
  { id: 'rC', ownerId: 'uC', teamName: null, ownerName: 'Cat' },
  { id: 'rD', ownerId: 'uD', teamName: 'Delta', ownerName: 'Dan' },
]

/** The dispatcher is reached through a dynamic import; let it settle before reading or ruling it out. */
const flush = () => new Promise((r) => setTimeout(r, 25))
type Sent = { userIds: string[]; title: string; body: string; dedupePrefix: string; category: string }
async function sent(): Promise<Sent[]> {
  await flush()
  return m.dispatch.mock.calls.map((c) => c[0] as Sent)
}

const proposal = (extra: string[]) => ({
  id: 'p-1', leagueId: 'L', seasonId: 'S', proposerRosterId: 'rA', receiverRosterId: 'rB', additionalRosterIds: extra,
  acceptedRosterIds: [], status: 'pending', vetoMode: 'commissioner', vetoThreshold: null,
  acceptedAt: new Date('2026-10-23T12:00:00Z'), expiresAt: new Date('2026-10-25T11:00:00Z'), assets: [],
})

beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue({ user: { id: 'commish' } })
  m.prisma.redraftRoster.findMany.mockImplementation(async (args: { where: { id?: { in: string[] }; seasonId?: string } }) =>
    args.where.id ? OWNERS.filter((o) => args.where.id!.in.includes(o.id)) : OWNERS,
  )
  m.prisma.redraftTradeProposal.update.mockResolvedValue({ id: 'p-1', leagueId: 'L', status: 'vetoed' })
  m.prisma.redraftTradeProposal.updateMany.mockResolvedValue({ count: 1 })
})

const veto = () =>
  vetoPOST(new Request('http://localhost/api/redraft/trades/veto', { method: 'POST', body: JSON.stringify({ proposalId: 'p-1' }) }) as never)

describe('commissioner veto (app/api/redraft/trades/veto)', () => {
  /*
   * Was: `body: MULTI_TEAM_TRADE_VETOED_BODY` ("The commissioner vetoed the multi-team trade, so it will
   * not go through."), read off the `notifyMultiTeamTradeParties` mock. That generic text named no team,
   * while trade-votes' commissioner_veto named every team under the same `vetoed` key — so one ruling read
   * differently depending on which route made it. Both now send notifyMultiTeamTradeCommissionerVeto.
   */
  it('a multi-team trade: every team in it is told, by name, with the same text and key as trade-votes', async () => {
    m.prisma.redraftTradeProposal.findUnique.mockResolvedValue(proposal(['rC', 'rD']))
    const res = await veto()
    expect(res.status).toBe(200)
    const all = await sent()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      leagueId: 'L',
      userIds: ['uA', 'uB', 'uC', 'uD'],
      category: 'trade_proposals',
      title: 'Trade vetoed',
      body: 'The commissioner vetoed the multi-team trade between Alpha, Bravo, Cat and Delta, so it will not go through.',
      dedupePrefix: 'redraft_trade:p-1:vetoed',
    })
    expect(all[0]!.body).toBe(multiTeamTradeVetoedBody('Alpha, Bravo, Cat and Delta'))
  })

  it('a commissioner who also manages a team in the trade is not told about their own veto', async () => {
    m.session.mockResolvedValue({ user: { id: 'uC' } })
    m.prisma.redraftTradeProposal.findUnique.mockResolvedValue(proposal(['rC', 'rD']))
    const res = await veto()
    expect(res.status).toBe(200)
    const all = await sent()
    expect(all[0]!.userIds).toEqual(['uA', 'uB', 'uD'])
  })

  it('a failed notice does not fail the veto: the roster read throws, the route still answers 200', async () => {
    m.prisma.redraftTradeProposal.findUnique.mockResolvedValue(proposal(['rC', 'rD']))
    m.prisma.redraftRoster.findMany.mockImplementation(async (args: { where: { id?: unknown } }) => {
      if (args.where.id) throw new Error('roster read failed')
      return OWNERS
    })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await veto()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ status: 'vetoed' })
    expect(await sent()).toEqual([])
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('two teams: no multi-team notice; the DM status and the two-party learning event exactly as before', async () => {
    m.prisma.redraftTradeProposal.findUnique.mockResolvedValue(proposal([]))
    const res = await veto()
    expect(res.status).toBe(200)
    expect(m.notify).not.toHaveBeenCalled()
    expect(await sent()).toEqual([])
    // No notice means no extra by-id roster read either: only the route's own season read.
    expect(m.prisma.redraftRoster.findMany.mock.calls.filter((c) => (c[0] as { where: { id?: unknown } }).where.id)).toEqual([])
    expect(m.dm).toHaveBeenCalledWith({ source: 'redraft', tradeId: 'p-1', status: 'vetoed', detail: 'The commissioner made the call.' })
    expect(m.learning).toHaveBeenCalledWith(expect.objectContaining({ proposerUserId: 'uA', receiverUserId: 'uB', eventType: 'trade_vetoed' }))
  })
})

describe('review window ends and the trade cannot be processed (lib/redraft/tradeReviewWindowSweep.ts)', () => {
  beforeEach(() => {
    m.finalize.mockResolvedValue({ ok: false, error: 'a roster is over its limit' })
  })

  it('a multi-team trade: every team is told why, and owners are read for every team', async () => {
    m.prisma.redraftTradeProposal.findMany.mockResolvedValue([proposal(['rC'])])
    const r = await processDueTradeReviews({ now: new Date('2026-10-25T12:00:00Z') })
    expect(r.closed).toBe(1)
    expect(m.prisma.redraftRoster.findMany.mock.calls[0]![0].where).toEqual({ id: { in: ['rA', 'rB', 'rC'] } })
    expect(m.notify.mock.calls[0]![0]).toMatchObject({
      userIds: ['uA', 'uB', 'uC'],
      key: 'closed',
      title: 'Trade could not go through',
      body: 'Could not be processed when the review window ended: a roster is over its limit',
    })
  })

  it('two teams: proposer and receiver only, no multi-team notice', async () => {
    m.prisma.redraftTradeProposal.findMany.mockResolvedValue([proposal([])])
    await processDueTradeReviews({ now: new Date('2026-10-25T12:00:00Z') })
    expect(m.prisma.redraftRoster.findMany.mock.calls[0]![0].where).toEqual({ id: { in: ['rA', 'rB'] } })
    expect(m.notify).not.toHaveBeenCalled()
    expect(m.dm).toHaveBeenCalledWith(expect.objectContaining({ status: 'expired' }))
  })
})

describe('a reversed native trade (lib/trade-reversal/notice.ts)', () => {
  const reverse = () =>
    publishTradeReversalNotice({ leagueId: 'L', tradeId: 'p-1', noticeKey: 'redraft_trade:p-1:reversed', engine: 'native', actorUserId: 'commish' })
  const native = (extra: string[]) => ({ proposerRoster: { ownerId: 'uA' }, receiverRoster: { ownerId: 'uB' }, additionalRosterIds: extra })

  it('a multi-team trade: every team’s manager is told, and the league is not told "both rosters"', async () => {
    m.prisma.redraftTradeProposal.findUnique.mockResolvedValue(native(['rC', 'rD']))
    await reverse()
    expect(m.prisma.redraftTradeProposal.findUnique).toHaveBeenCalledTimes(1)
    expect(m.ingest.mock.calls[0]![0]).toMatchObject({ userIds: ['uA', 'uB', 'uC', 'uD'], type: 'trade_reversed' })
    expect(m.publish.mock.calls[0]![0]).toMatchObject({ message: TRADE_REVERSED_MULTI_TEAM_MESSAGE })
  })

  it('two teams: the same two managers and the same announcement as before, with no roster read', async () => {
    m.prisma.redraftTradeProposal.findUnique.mockResolvedValue(native([]))
    await reverse()
    expect(m.ingest.mock.calls[0]![0]).toMatchObject({ userIds: ['uA', 'uB'] })
    expect(m.publish.mock.calls[0]![0]).toMatchObject({ message: TRADE_REVERSED_MESSAGE })
    expect(m.prisma.redraftRoster.findMany).not.toHaveBeenCalled()
  })

  it('an unreadable proposal still announces (two-team copy) and still propagates the failure', async () => {
    m.prisma.redraftTradeProposal.findUnique.mockRejectedValue(new Error('lookup failed'))
    await expect(reverse()).rejects.toThrow('lookup failed')
    expect(m.publish).toHaveBeenCalledTimes(1)
    expect(m.publish.mock.calls[0]![0]).toMatchObject({ message: TRADE_REVERSED_MESSAGE })
  })
})
