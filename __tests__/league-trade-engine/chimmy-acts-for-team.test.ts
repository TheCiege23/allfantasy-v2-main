// @vitest-environment node
/**
 * The league trade engine and the teams Chimmy runs (lib/league-trade-engine/chimmyActor.ts):
 * offers to such a team follow its commissioner's trade setting, Chimmy can accept, decline and make
 * offers for it — and only when the engine itself confirms Chimmy runs it, never as the commissioner.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  postStatus: vi.fn(),
  leagueFindUnique: vi.fn(),
  rosterFindFirst: vi.fn(),
  rosterFindMany: vi.fn(),
  tradeCreate: vi.fn(),
  tradeFindFirst: vi.fn(),
  tradeUpdate: vi.fn(),
  lifecycle: vi.fn(),
  actor: vi.fn(),
  runTeams: vi.fn(),
}))

vi.mock('@/lib/chat-notifications/tradeOfferDm', () => ({ postTradeOfferToDm: vi.fn(async () => ({ posted: true })), postTradeStatusToDm: h.postStatus }))
vi.mock('@/lib/chat-notifications/tradeOfferSources', () => ({ loadNativeTradeOffer: vi.fn() }))
vi.mock('@/lib/notification-engine', () => ({ ingest: vi.fn(async () => ({ dispatched: true })), tradeEvent: (o: unknown) => o }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFindUnique, findUniqueOrThrow: h.leagueFindUnique },
    roster: { findFirst: h.rosterFindFirst, findMany: h.rosterFindMany, findUnique: vi.fn(), count: vi.fn() },
    afLeagueTrade: { create: h.tradeCreate, findFirst: h.tradeFindFirst, findUniqueOrThrow: vi.fn(), update: h.tradeUpdate, updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    afLeagueTradeVote: { upsert: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock('@/lib/league-trade-engine/tradeLearningCapture', () => ({ captureLiveTradeOffer: vi.fn().mockResolvedValue('o'), captureLiveTradeOutcome: vi.fn().mockResolvedValue('o') }))
vi.mock('@/server/services/leagueLifecycleService', () => ({ assertLifecycleActionAllowed: h.lifecycle }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/league-trade-engine/tradeValidationService', () => ({ validateTradeAssets: vi.fn().mockReturnValue({ ok: true }) }))
vi.mock('@/lib/league-trade-engine/tradeSettingsResolver', () => ({
  resolveLeagueTradeSettings: vi.fn().mockReturnValue({
    tradeReviewMode: 'commissioner', tradeDeadlineWeek: null, tradeReviewHours: 48, vetoRule: { mode: 'count', value: 4 },
    vetoThresholdPercent: null, processingDelayHours: 0, tradesAllowed: true, faabTradingAllowed: true,
    draftPickTradingAllowed: true, devyTradingAllowed: true, c2cTradingAllowed: true,
  }),
}))
vi.mock('@/lib/league-trade-engine/tradeProcessor', () => ({ applyTradeAssetsInTransaction: vi.fn() }))
vi.mock('@/lib/league-trade-engine/tradeAudit', () => ({ appendAfTradeProcessingEvent: vi.fn(), appendAfTradeStatusHistory: vi.fn(), logAfTradeAudit: vi.fn() }))
vi.mock('@/lib/roster-legality/rosterTransactionGates', () => ({ assertRosterTransactionsAllowed: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/league-trade-engine/chimmyActor', () => ({
  resolveChimmyActor: h.actor,
  chimmyRunTeams: h.runTeams,
  CHIMMY_TRADES_OFF_MESSAGE: 'Chimmy is running this team while its manager is away, and it is not taking trade offers.',
  CHIMMY_TWO_TEAM_MESSAGE: 'Chimmy is running one of these teams, and it only takes two-team trade offers.',
}))

import { acceptAfLeagueTrade, createAfLeagueTrade, rejectAfLeagueTrade } from '@/lib/league-trade-engine/tradeService'

const L = 'league-1'
const roster = (id: string, platformUserId: string) => ({ id, leagueId: L, platformUserId })
const asChimmy = { rosterId: 'rC', actorUserId: 'commish', trades: 'answer' }

beforeEach(() => {
  vi.clearAllMocks()
  h.postStatus.mockResolvedValue({ posted: true })
  h.leagueFindUnique.mockResolvedValue({ id: L, settings: null, userId: 'commish' })
  h.tradeCreate.mockResolvedValue({ id: 'new-trade' })
  h.tradeUpdate.mockResolvedValue({})
  h.lifecycle.mockResolvedValue({ ok: true })
  h.actor.mockResolvedValue(null)
  h.runTeams.mockResolvedValue(new Map())
})

describe('offers made TO a team Chimmy runs', () => {
  const offerToChimmy = (assets = [{ itemType: 'player' as const, itemReference: 'p1', fromRosterId: 'rA', toRosterId: 'rC' }]) => {
    h.rosterFindFirst.mockResolvedValueOnce(roster('rA', 'uA')).mockResolvedValueOnce(roster('rC', 'orphan-rC'))
    return createAfLeagueTrade({ leagueId: L, proposedByUserId: 'uA', proposerRosterId: 'rA', receiverRosterId: 'rC', assets })
  }

  it('are made as normal when the team answers offers', async () => {
    h.runTeams.mockResolvedValue(new Map([['rC', 'answer']]))
    await expect(offerToChimmy()).resolves.toEqual({ id: 'new-trade' })
  })

  it('are refused before anything is written when its trades are off', async () => {
    h.runTeams.mockResolvedValue(new Map([['rC', 'off']]))
    await expect(offerToChimmy()).rejects.toMatchObject({ code: 'RECEIVER_ON_AUTOPILOT' })
    expect(h.tradeCreate).not.toHaveBeenCalled()
  })

  it('are refused in a multi-team trade, even when the team answers offers', async () => {
    h.runTeams.mockResolvedValue(new Map([['rC', 'answer']]))
    h.rosterFindMany.mockResolvedValue([roster('rA', 'uA'), roster('rB', 'uB'), roster('rC', 'orphan-rC')])
    await expect(createAfLeagueTrade({
      leagueId: L, proposedByUserId: 'uA', proposerRosterId: 'rA', receiverRosterId: 'rB',
      assets: [
        { itemType: 'player', itemReference: 'p1', fromRosterId: 'rA', toRosterId: 'rB' },
        { itemType: 'player', itemReference: 'p2', fromRosterId: 'rB', toRosterId: 'rC' },
        { itemType: 'player', itemReference: 'p3', fromRosterId: 'rC', toRosterId: 'rA' },
      ],
    })).rejects.toMatchObject({ code: 'RECEIVER_ON_AUTOPILOT', message: expect.stringMatching(/two-team/) })
    expect(h.tradeCreate).not.toHaveBeenCalled()
  })
})

describe('Chimmy making an offer for its team', () => {
  const chimmyOffer = (over: Record<string, unknown> = {}) => {
    h.rosterFindFirst.mockResolvedValueOnce(roster('rC', 'orphan-rC')).mockResolvedValueOnce(roster('rA', 'uA'))
    return createAfLeagueTrade({
      leagueId: L, proposedByUserId: 'commish', chimmyForRosterId: 'rC', proposerRosterId: 'rC', receiverRosterId: 'rA',
      assets: [{ itemType: 'player', itemReference: 'p1', fromRosterId: 'rC', toRosterId: 'rA' }], ...over,
    })
  }

  it('is made for a team with no account, as the team: never with commissioner powers', async () => {
    h.actor.mockResolvedValue(asChimmy)
    await expect(chimmyOffer()).resolves.toEqual({ id: 'new-trade' })
    expect(h.actor).toHaveBeenCalledWith(L, 'rC', 'commish')
    expect(h.lifecycle).toHaveBeenCalledWith(L, 'trade_act', 'commish', { isElevatedCommissioner: false })
  })

  it('is refused when Chimmy does not run the team, or names a team other than the proposer', async () => {
    await expect(chimmyOffer()).rejects.toThrow(/Chimmy is not running the proposing team/)
    h.actor.mockResolvedValue(asChimmy)
    await expect(createAfLeagueTrade({
      leagueId: L, proposedByUserId: 'commish', chimmyForRosterId: 'rC', proposerRosterId: 'rA', receiverRosterId: 'rC',
      assets: [{ itemType: 'player', itemReference: 'p1', fromRosterId: 'rA', toRosterId: 'rC' }],
    })).rejects.toThrow(/Chimmy is not running the proposing team/)
    expect(h.tradeCreate).not.toHaveBeenCalled()
  })

  it('without the flag, the commissioner cannot make an offer for a team they do not own', async () => {
    h.rosterFindFirst.mockResolvedValueOnce(roster('rC', 'orphan-rC')).mockResolvedValueOnce(roster('rA', 'uA'))
    await expect(createAfLeagueTrade({
      leagueId: L, proposedByUserId: 'commish', proposerRosterId: 'rC', receiverRosterId: 'rA',
      assets: [{ itemType: 'player', itemReference: 'p1', fromRosterId: 'rC', toRosterId: 'rA' }],
    })).rejects.toThrow(/Proposer must own the proposing roster/)
  })
})

describe('Chimmy answering an offer made to its team', () => {
  const pending = { id: 't1', status: 'pending', reviewType: 'commissioner', expiresAt: null, metadata: {}, proposerRosterId: 'rA', receiverRosterId: 'rC', proposedByUserId: 'uA', items: [] }

  it('accepts as the team, and the DM names Chimmy rather than the commissioner', async () => {
    h.actor.mockResolvedValue(asChimmy)
    h.tradeFindFirst.mockResolvedValue(pending)
    h.rosterFindMany.mockResolvedValue([roster('rA', 'uA'), roster('rC', 'orphan-rC')])
    await expect(acceptAfLeagueTrade({ tradeId: 't1', leagueId: L, userId: 'commish', chimmyForRosterId: 'rC' })).resolves.toEqual({ status: 'awaiting_commissioner' })
    await vi.waitFor(() => expect(h.postStatus).toHaveBeenCalled())
    expect(h.postStatus).toHaveBeenCalledWith(expect.objectContaining({ tradeId: 't1', status: 'accepted', actorName: 'Chimmy' }))
    expect(h.postStatus.mock.calls[0]![0]).toMatchObject({ actorUserId: null })
  })

  it('cannot accept when Chimmy does not run the team', async () => {
    h.tradeFindFirst.mockResolvedValue(pending)
    h.rosterFindMany.mockResolvedValue([roster('rA', 'uA'), roster('rC', 'orphan-rC')])
    await expect(acceptAfLeagueTrade({ tradeId: 't1', leagueId: L, userId: 'commish', chimmyForRosterId: 'rC' })).rejects.toThrow(/Only a participating manager can accept/)
  })

  it('cannot accept for the team that MADE the offer', async () => {
    h.actor.mockResolvedValue({ ...asChimmy, rosterId: 'rA' })
    h.tradeFindFirst.mockResolvedValue(pending)
    h.rosterFindMany.mockResolvedValue([roster('rA', 'orphan-rA'), roster('rC', 'uC')])
    await expect(acceptAfLeagueTrade({ tradeId: 't1', leagueId: L, userId: 'commish', chimmyForRosterId: 'rA' })).rejects.toThrow(/Only a participating manager can accept/)
  })

  it('declines with its one-line reason under the decline, named as Chimmy', async () => {
    h.actor.mockResolvedValue(asChimmy)
    h.tradeFindFirst.mockResolvedValue(pending)
    await rejectAfLeagueTrade({ tradeId: 't1', leagueId: L, userId: 'commish', chimmyForRosterId: 'rC', note: 'Chimmy would need a bit more coming back to do this deal.' })
    await vi.waitFor(() => expect(h.postStatus).toHaveBeenCalled())
    expect(h.postStatus).toHaveBeenCalledWith(expect.objectContaining({ tradeId: 't1', status: 'rejected', actorName: 'Chimmy', actorUserId: null, detail: 'Chimmy would need a bit more coming back to do this deal.' }))
  })

  it('cannot decline when Chimmy does not run the team', async () => {
    h.tradeFindFirst.mockResolvedValue(pending)
    await expect(rejectAfLeagueTrade({ tradeId: 't1', leagueId: L, userId: 'commish', chimmyForRosterId: 'rC' })).rejects.toThrow(/Chimmy is not running that team/)
    expect(h.tradeUpdate).not.toHaveBeenCalled()
  })
})
