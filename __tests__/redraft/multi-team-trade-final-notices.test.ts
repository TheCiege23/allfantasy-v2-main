import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '../helpers/createMockNextRequest'

/**
 * How every team in a MULTI-TEAM (3- or 4-team) native trade learns the trade ended or went through.
 *
 * A multi-team trade has no DM offer card, so `queueTradeStatusInDm` is a no-op for it. These are the
 * in-app notices that replace it (lib/redraft/multiTeamTradeNotices.ts → `notifyMultiTeamTradeOutcome`):
 *
 *   app/api/redraft/trade-votes     commissioner_veto, a league vote veto, cancel, offer expiry
 *   lib/redraft/finalizeRedraftTrade the processed notice, for every settlement path (accept under
 *                                    no_veto, commissioner approval, passed league vote, review window)
 *
 * Every multi-team case is paired with the two-team case it must leave exactly as it was: no notice,
 * no extra roster read, the same DM status call.
 *
 * Harness modelled on multi-team-trade-votes.test.ts (stateful proposal row, REAL finalizer), with the
 * dispatcher mocked so what each team is actually sent can be read.
 */

const h = vi.hoisted(() => ({
  proposal: null as Record<string, unknown> | null,
  actor: 'uB',
  settle: vi.fn(),
  settlementClaim: vi.fn(),
  acceptedAtClaim: vi.fn(),
  update: vi.fn(),
  capCheck: vi.fn(async () => ({ ok: true })),
  dispatch: vi.fn(async () => undefined),
  dm: vi.fn(),
  rosters: vi.fn(),
  due: vi.fn(async () => [] as unknown[]),
  votes: [] as Array<{ rosterId: string; vote: string }>,
}))

const ROSTERS = [
  { id: 'rA', ownerId: 'uA', teamName: 'Alpha', ownerName: 'Ann' },
  { id: 'rB', ownerId: 'uB', teamName: 'Bravo', ownerName: 'Ben' },
  { id: 'rC', ownerId: 'uC', teamName: null, ownerName: 'Cat' },
  { id: 'rD', ownerId: 'uD', teamName: 'Delta', ownerName: 'Dan' },
]

function model(overrides: Record<string, unknown> = {}) {
  return new Proxy(overrides, {
    get: (target, key: string) => (key in target ? target[key] : vi.fn(async () => (key.startsWith('findMany') ? [] : null))),
  })
}

async function proposalUpdateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
  const p = h.proposal!
  const data = args.data
  if (data.acceptedRosterIds && typeof data.acceptedRosterIds === 'object') {
    const roster = (data.acceptedRosterIds as { push: string }).push
    const list = (p.acceptedRosterIds as string[]) ?? []
    if (p.status !== 'pending' || p.acceptedAt || list.includes(roster)) return { count: 0 }
    p.acceptedRosterIds = [...list, roster]
    return { count: 1 }
  }
  if ('acceptedAt' in data && 'expiresAt' in data) return h.acceptedAtClaim(args)
  return { count: 1 }
}

vi.mock('@/lib/prisma', () => {
  const tx = {
    redraftTradeProposal: model({
      updateMany: h.settlementClaim,
      findUniqueOrThrow: vi.fn(async () => ({ ...h.proposal, status: 'accepted' })),
    }),
    iDPCapConfig: model(),
  }
  return {
    prisma: new Proxy(
      {
        redraftTradeProposal: model({
          findFirst: vi.fn(async () => (h.proposal ? { ...h.proposal } : null)),
          findMany: h.due,
          updateMany: vi.fn(proposalUpdateMany),
          update: h.update,
          findUnique: vi.fn(async () => (h.proposal ? { ...h.proposal } : null)),
        }),
        redraftTradeVote: model({
          findFirst: vi.fn(async () => null),
          create: vi.fn(async ({ data }: { data: { rosterId: string; vote: string } }) => (h.votes.push(data), data)),
          findMany: vi.fn(async () => [...h.votes]),
        }),
        redraftRoster: model({ findMany: h.rosters, findFirst: vi.fn(async () => ({ ownerId: 'uA' })) }),
        league: model({
          findUnique: vi.fn(async () => ({ id: 'L', lifecycleState: 'in_season', platform: 'allfantasy', lockAllMoves: false, tradeReviewHours: null })),
        }),
        $transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
      } as Record<string, unknown>,
      { get: (target, key: string) => (key in target ? target[key] : model()) },
    ),
  }
})
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: h.actor } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ ok: true, status: 200 })) }))
vi.mock('@/lib/league/permissions', () => ({ hasLeagueCommissionerRights: vi.fn(async (_l: string, u: string) => u === 'commish') }))
vi.mock('@/lib/team-coowners/access', () => ({ acceptedCoOwnerRosterId: vi.fn(async () => null) }))
vi.mock('@/lib/trade-deadline/tradeDeadlineWindow', () => ({
  evaluateRedraftTradeDeadline: vi.fn(async () => ({ passed: false })),
  tradeDeadlinePassedMessage: () => 'passed',
}))
vi.mock('@/server/services/postDraftRosterLockService', () => ({ postDraftRosterMoveRefusal: vi.fn(async () => null) }))
vi.mock('@/lib/redraft/tradeMoveLock', () => ({
  REDRAFT_MOVES_LOCKED_CODE: 'MOVE_LOCKED',
  REDRAFT_MOVES_LOCKED_MESSAGE: 'locked',
  REDRAFT_MOVES_LOCKED_STATUS: 409,
  isRedraftLeagueMovesLocked: vi.fn(async () => false),
}))
vi.mock('@/lib/idp/capEngine', () => ({
  validateRedraftTradeCap: h.capCheck,
  validateRedraftTradeCapInTransaction: h.capCheck,
  applyRedraftTradeCapTransfersInTransaction: vi.fn(async () => ({ moved: 0, transactionIds: [] })),
  refreshCapProjections: vi.fn(async () => undefined),
}))
vi.mock('@/lib/redraft/tradeSettlement', () => ({ settleRedraftTradeAssets: h.settle }))
vi.mock('@/lib/redraft/tradeExecutionSnapshot', () => ({
  captureRedraftRosterState: vi.fn(async () => ({})),
  writeRedraftTradeExecutionSnapshot: vi.fn(async () => undefined),
}))
vi.mock('@/lib/redraft/tradeReversal', () => ({ evaluateNativeTradeReversalReadiness: vi.fn(), reverseNativeTrade: vi.fn() }))
vi.mock('@/lib/trade-reversal/notice', () => ({ publishTradeReversalNotice: vi.fn() }))
vi.mock('@/lib/events', () => ({
  EVENT: { TRADE_ACCEPTED: 'a', TRADE_PROCESSED: 'p' },
  getPlatformEvents: () => ({ emit: vi.fn(async () => undefined), emitInTx: vi.fn(async () => undefined) }),
}))
vi.mock('@/lib/trade-market/redraftTradeMarketEvents', () => ({ recordRedraftTradeMarketEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/integrity/enqueueCollusionScan', () => ({ enqueueCollusionScan: vi.fn() }))
vi.mock('@/lib/ai-learning-system/recordEvent', () => ({ recordAfLearningEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/ai-learning-system/recordTradeParticipants', () => ({ recordTradeOutcomeForBothManagers: vi.fn(async () => undefined) }))
vi.mock('@/lib/ai-learning-system/resolveLeagueSport', () => ({ resolveLeagueSport: vi.fn(async () => 'NFL') }))
vi.mock('@/lib/chat-notifications/tradeOfferDm', () => ({ queueTradeStatusInDm: h.dm }))
vi.mock('@/lib/integrity/holdFlaggedTrades', () => ({ shouldHoldAcceptedTrade: vi.fn(async () => false), heldTradeIds: vi.fn(async () => []) }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))

import { finalizeRedraftTrade, type ProposalWithAssets } from '@/lib/redraft/finalizeRedraftTrade'
import { processDueTradeReviews } from '@/lib/redraft/tradeReviewWindowSweep'

const asset = (from: string, to: string, extra: Record<string, unknown>) => ({
  fromRosterId: from, toRosterId: to, assetType: 'player', playerId: null, playerName: null,
  pickSeason: null, pickRound: null, pickNumber: null, metadata: {}, ...extra,
})

const THREE_TEAM_ASSETS = [
  asset('rA', 'rB', { playerId: 'a1', playerName: 'Ace' }),
  asset('rB', 'rC', { assetType: 'draft_pick', pickSeason: 2027, pickRound: 2 }),
  asset('rC', 'rA', { assetType: 'faab', metadata: { amount: 5 } }),
]

function trade(extra: string[], over: Record<string, unknown> = {}) {
  h.proposal = {
    id: 'p-3', leagueId: 'L', seasonId: 'S', proposerRosterId: 'rA', receiverRosterId: 'rB', additionalRosterIds: extra,
    acceptedRosterIds: [], status: 'pending', vetoMode: 'commissioner', vetoThreshold: 1, expiresAt: null, acceptedAt: null, votes: [],
    assets: extra.length ? THREE_TEAM_ASSETS : [asset('rA', 'rB', { playerId: 'a1', playerName: 'Ace' }), asset('rB', 'rA', { playerId: 'b1', playerName: 'Bo' })],
    ...over,
  }
}
const threeTeam = (over: Record<string, unknown> = {}) => trade(['rC'], over)
const twoTeam = (over: Record<string, unknown> = {}) => trade([], over)
/** Agreed and inside its review window. */
const agreed = { acceptedAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) }

async function post(actor: string, body: Record<string, unknown>) {
  h.actor = actor
  const { POST } = await import('../../app/api/redraft/trade-votes/route')
  const res = await POST(createMockNextRequest('http://localhost/api/redraft/trade-votes', { method: 'POST', body }) as never)
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

/** The dispatcher is reached through a dynamic import; let it settle before reading or ruling it out. */
const flush = () => new Promise((r) => setTimeout(r, 25))
type Sent = { userIds: string[]; title: string; body: string; dedupePrefix: string; category: string }
async function sent(): Promise<Sent[]> {
  await flush()
  return h.dispatch.mock.calls.map((c) => (c as unknown as [Sent])[0])
}
const byKey = (all: Sent[], key: string) => all.filter((n) => n.dedupePrefix === `redraft_trade:p-3:${key}`)
/** Did anything read rosters BY ID (the notice's read) rather than by season (the route's own)? */
const rosterReadsById = () => h.rosters.mock.calls.filter((c) => (c[0] as { where: { id?: unknown } }).where.id)

beforeEach(() => {
  vi.clearAllMocks()
  h.settlementClaim.mockResolvedValue({ count: 1 })
  h.acceptedAtClaim.mockResolvedValue({ count: 1 })
  h.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...h.proposal, ...data }))
  h.settle.mockResolvedValue({ playersMoved: 1, faabTransferred: 5, picksRecorded: 1 })
  h.rosters.mockImplementation(async (args: { where: { id?: { in: string[] } } }) =>
    args.where.id ? ROSTERS.filter((r) => args.where.id!.in.includes(r.id)) : ROSTERS,
  )
  h.dispatch.mockResolvedValue(undefined)
  h.due.mockResolvedValue([])
  h.votes = []
})

const PROCESSED_MOVES =
  'Rosters are updated: Alpha gives Ace and gets 5 FAAB; Bravo gives a 2027 round 2 pick and gets Ace; Cat gives 5 FAAB and gets a 2027 round 2 pick.'

describe('commissioner_veto on /api/redraft/trade-votes', () => {
  it('a multi-team trade: every team is told, by name, under the same key as the veto route', async () => {
    threeTeam(agreed)
    const r = await post('commish', { proposalId: 'p-3', action: 'commissioner_veto' })
    expect(r.status).toBe(200)
    const all = await sent()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      userIds: ['uA', 'uB', 'uC'],
      category: 'trade_proposals',
      title: 'Trade vetoed',
      body: 'The commissioner vetoed the multi-team trade between Alpha, Bravo and Cat, so it will not go through.',
      dedupePrefix: 'redraft_trade:p-3:vetoed',
    })
  })

  it('two teams: no notice, no roster read, the DM status exactly as before', async () => {
    twoTeam(agreed)
    const r = await post('commish', { proposalId: 'p-3', action: 'commissioner_veto' })
    expect(r.status).toBe(200)
    expect(await sent()).toEqual([])
    expect(rosterReadsById()).toEqual([])
    expect(h.dm.mock.calls).toEqual([[{ source: 'redraft', tradeId: 'p-3', status: 'vetoed', detail: 'The commissioner made the call.' }]])
  })

  it('a failed notice does not fail the veto', async () => {
    threeTeam(agreed)
    h.rosters.mockImplementation(async (args: { where: { id?: unknown } }) => {
      if (args.where.id) throw new Error('roster read failed')
      return ROSTERS
    })
    const r = await post('commish', { proposalId: 'p-3', action: 'commissioner_veto' })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ resolved: true })
    expect(await sent()).toEqual([])
  })
})

describe('commissioner_approve: told once, as processed (lib/redraft/finalizeRedraftTrade.ts)', () => {
  it('a multi-team trade: one processed notice naming every team and what each got — no separate approval notice', async () => {
    threeTeam(agreed)
    const r = await post('commish', { proposalId: 'p-3', action: 'commissioner_approve' })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ resolved: true })
    const all = await sent()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      userIds: ['uA', 'uB', 'uC'],
      title: 'Trade processed',
      body: `The commissioner approved the multi-team trade between Alpha, Bravo and Cat, and it went through. ${PROCESSED_MOVES}`,
      dedupePrefix: 'redraft_trade:p-3:processed',
    })
  })

  it('two teams: no notice, no roster read, the DM status exactly as before', async () => {
    twoTeam(agreed)
    const r = await post('commish', { proposalId: 'p-3', action: 'commissioner_approve' })
    expect(r.status).toBe(200)
    expect(await sent()).toEqual([])
    expect(rosterReadsById()).toEqual([])
    expect(h.dm.mock.calls).toEqual([[{ source: 'redraft', tradeId: 'p-3', status: 'processed', detail: 'The commissioner approved it.' }]])
  })

  it('a failed notice does not fail the settlement', async () => {
    threeTeam(agreed)
    h.rosters.mockImplementation(async (args: { where: { id?: unknown } }) => {
      if (args.where.id) throw new Error('roster read failed')
      return ROSTERS
    })
    const r = await post('commish', { proposalId: 'p-3', action: 'commissioner_approve' })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ resolved: true })
    expect(h.settle).toHaveBeenCalledTimes(1)
  })

  it('a dispatcher that rejects does not fail the settlement either', async () => {
    threeTeam(agreed)
    h.dispatch.mockRejectedValue(new Error('dispatch down'))
    const r = await post('commish', { proposalId: 'p-3', action: 'commissioner_approve' })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ resolved: true })
  })
})

describe('league vote on /api/redraft/trade-votes', () => {
  it('a multi-team trade vetoed by the league: every team is told, with the count', async () => {
    threeTeam({ ...agreed, vetoMode: 'league_vote' })
    const r = await post('uD', { proposalId: 'p-3', action: 'vote_veto' })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ resolved: true })
    const all = await sent()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      userIds: ['uA', 'uB', 'uC'],
      title: 'Trade vetoed',
      body: 'The league voted to veto the multi-team trade between Alpha, Bravo and Cat (1 of 1 veto votes), so it will not go through.',
      dedupePrefix: 'redraft_trade:p-3:league_vetoed',
    })
  })

  it('a multi-team trade approved by the league: processed, once', async () => {
    threeTeam({ ...agreed, vetoMode: 'league_vote' })
    const r = await post('uD', { proposalId: 'p-3', action: 'vote_approve' })
    expect(r.status).toBe(200)
    const all = await sent()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      userIds: ['uA', 'uB', 'uC'],
      title: 'Trade processed',
      body: `The league vote approved the multi-team trade between Alpha, Bravo and Cat, and it went through. ${PROCESSED_MOVES}`,
    })
  })

  it.each(['vote_veto', 'vote_approve'])('two teams, %s: no notice, no roster read, the DM status as before', async (action) => {
    twoTeam({ ...agreed, vetoMode: 'league_vote' })
    const r = await post('uD', { proposalId: 'p-3', action })
    expect(r.status).toBe(200)
    expect(await sent()).toEqual([])
    expect(rosterReadsById()).toEqual([])
    expect(h.dm.mock.calls).toEqual([
      [
        action === 'vote_veto'
          ? { source: 'redraft', tradeId: 'p-3', status: 'vetoed', detail: '1 of 1 veto votes were in.' }
          : { source: 'redraft', tradeId: 'p-3', status: 'processed', detail: 'The league vote approved it.' },
      ],
    ])
  })
})

describe('the last acceptance under no_veto', () => {
  it('a multi-team trade: told it was accepted, then processed — each once, never to the team that accepted', async () => {
    threeTeam({ vetoMode: 'no_veto', acceptedRosterIds: ['rB'] })
    const r = await post('uC', { proposalId: 'p-3', action: 'accept' })
    expect(r.json).toMatchObject({ resolved: true })
    const all = await sent()
    expect(byKey(all, 'all_accepted')).toHaveLength(1)
    const processed = byKey(all, 'processed')
    expect(processed).toHaveLength(1)
    expect(processed[0]).toMatchObject({
      userIds: ['uA', 'uB'],
      body: `Every team accepted the multi-team trade between Alpha, Bravo and Cat, and it went through. ${PROCESSED_MOVES}`,
    })
  })

  it('two teams: no notice, the DM status exactly as before', async () => {
    twoTeam({ vetoMode: 'no_veto' })
    const r = await post('uB', { proposalId: 'p-3', action: 'accept' })
    expect(r.json).toMatchObject({ resolved: true })
    expect(await sent()).toEqual([])
    expect(rosterReadsById()).toEqual([])
    expect(h.dm.mock.calls).toEqual([[{ source: 'redraft', tradeId: 'p-3', status: 'accepted', actorUserId: 'uB', detail: 'Rosters are updated.' }]])
  })
})

describe('the review window ends with no veto (lib/redraft/tradeReviewWindowSweep.ts → finalize)', () => {
  it('a multi-team trade: processed, once, to every team — the sweep itself adds nothing on success', async () => {
    threeTeam({ acceptedAt: new Date('2026-10-01T00:00:00Z'), expiresAt: new Date('2026-10-02T00:00:00Z') })
    h.due.mockResolvedValue([{ ...h.proposal }])
    const r = await processDueTradeReviews({ now: new Date('2026-10-03T00:00:00Z') })
    expect(r.processed).toBe(1)
    const all = await sent()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      userIds: ['uA', 'uB', 'uC'],
      title: 'Trade processed',
      body: `The review window for the multi-team trade between Alpha, Bravo and Cat ended with no veto, and it went through. ${PROCESSED_MOVES}`,
    })
  })

  it('two teams: no notice, the DM status exactly as before', async () => {
    twoTeam({ acceptedAt: new Date('2026-10-01T00:00:00Z'), expiresAt: new Date('2026-10-02T00:00:00Z') })
    h.due.mockResolvedValue([{ ...h.proposal }])
    const r = await processDueTradeReviews({ now: new Date('2026-10-03T00:00:00Z') })
    expect(r.processed).toBe(1)
    expect(await sent()).toEqual([])
    expect(h.dm.mock.calls).toEqual([[{ source: 'redraft', tradeId: 'p-3', status: 'processed', detail: 'The review window ended with no veto.' }]])
  })
})

describe('finalizeRedraftTrade called directly', () => {
  it('a race lost to another finalizer tells nobody — only the winner sends "processed"', async () => {
    threeTeam(agreed)
    h.settlementClaim.mockResolvedValue({ count: 0 })
    const r = await finalizeRedraftTrade(h.proposal as unknown as ProposalWithAssets, 'uA', 'uB', 'commish', undefined, 'commissioner_approved', 'commissioner')
    expect(r).toMatchObject({ ok: false, alreadyResolved: true })
    expect(await sent()).toEqual([])
  })

  it('four teams: all four named and told', async () => {
    trade(['rC', 'rD'], {
      ...agreed,
      assets: [...THREE_TEAM_ASSETS, asset('rD', 'rA', { playerId: 'd1', playerName: 'Dee' })],
    })
    const r = await finalizeRedraftTrade(h.proposal as unknown as ProposalWithAssets, 'uA', 'uB', 'commish', undefined, 'commissioner_approved', 'commissioner')
    expect(r.ok).toBe(true)
    const all = await sent()
    expect(all[0]!.userIds).toEqual(['uA', 'uB', 'uC', 'uD'])
    expect(all[0]!.body).toContain('between Alpha, Bravo, Cat and Delta')
    expect(all[0]!.body).toContain('Delta gives Dee and gets nothing')
  })
})

describe('cancel and expiry on /api/redraft/trade-votes', () => {
  it('a multi-team trade cancelled by its proposer: every other team is told who cancelled it', async () => {
    threeTeam()
    const r = await post('uA', { proposalId: 'p-3', action: 'cancel' })
    expect(r.status).toBe(200)
    const all = await sent()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      userIds: ['uB', 'uC'],
      title: 'Trade cancelled',
      body: 'Alpha cancelled the multi-team trade between Alpha, Bravo and Cat, so it will not go through.',
      dedupePrefix: 'redraft_trade:p-3:cancelled',
    })
  })

  it('a multi-team offer that expired: every team is told, including whoever clicked', async () => {
    threeTeam({ expiresAt: new Date(Date.now() - 60_000) })
    const r = await post('uB', { proposalId: 'p-3', action: 'accept' })
    expect(r.json).toMatchObject({ resolved: true })
    const all = await sent()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      userIds: ['uA', 'uB', 'uC'],
      title: 'Trade expired',
      body: 'The multi-team trade between Alpha, Bravo and Cat expired before every team accepted it, so it will not go through.',
      dedupePrefix: 'redraft_trade:p-3:expired',
    })
  })

  it('two teams: cancel and expiry send no notice and keep their DM status', async () => {
    twoTeam()
    await post('uA', { proposalId: 'p-3', action: 'cancel' })
    twoTeam({ expiresAt: new Date(Date.now() - 60_000) })
    await post('uB', { proposalId: 'p-3', action: 'accept' })
    expect(await sent()).toEqual([])
    expect(rosterReadsById()).toEqual([])
    expect(h.dm.mock.calls).toEqual([
      [{ source: 'redraft', tradeId: 'p-3', status: 'cancelled', actorUserId: 'uA' }],
      [{ source: 'redraft', tradeId: 'p-3', status: 'expired' }],
    ])
  })
})

describe('🛑 the two commissioner-veto routes send the SAME notice (notifyMultiTeamTradeCommissionerVeto)', () => {
  async function vetoRoute() {
    h.actor = 'commish'
    const { POST } = await import('../../app/api/redraft/trades/veto/route')
    const res = await POST(
      createMockNextRequest('http://localhost/api/redraft/trades/veto', { method: 'POST', body: { proposalId: 'p-3' } }) as never,
    )
    return res.status
  }

  it('trade-votes commissioner_veto and /api/redraft/trades/veto: identical title, body, recipients and key', async () => {
    threeTeam(agreed)
    expect((await post('commish', { proposalId: 'p-3', action: 'commissioner_veto' })).status).toBe(200)
    const fromVotes = await sent()
    h.dispatch.mockClear()
    threeTeam(agreed)
    expect(await vetoRoute()).toBe(200)
    const fromVetoRoute = await sent()
    expect(fromVotes).toHaveLength(1)
    expect(fromVetoRoute).toEqual(fromVotes)
    expect(fromVetoRoute[0]).toMatchObject({
      body: 'The commissioner vetoed the multi-team trade between Alpha, Bravo and Cat, so it will not go through.',
      dedupePrefix: 'redraft_trade:p-3:vetoed',
    })
  })
})
