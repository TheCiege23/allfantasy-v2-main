import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 🛑 COUNTERING AN OFFER USED TO NOTIFY NOBODY.
 *
 * `createAfLeagueTrade` flipped the parent to status 'countered', wrote status
 * history, captured the COUNTERED learning outcome — and returned. Every other
 * decision path (accept ×4, reject, commissioner-reject) called
 * `notifyProposerOfDecision`; the counter path did not, and that helper's type
 * union was literally `'trade_accepted' | 'trade_rejected'`. The only thing that
 * fired was a league-wide `af_trade_proposed` fanout to `all_members` reading "A
 * trade has been proposed in your league" — unaddressed, identical for all twelve
 * managers, and silent about the fact that YOUR offer had just died.
 *
 * `trade_proposed` had the same shape of defect: a settings category with a label
 * and a push channel that no code in this engine ever fired.
 *
 * 🛑 THE HARD PART IS THAT THE TWO FIXES COLLIDE ON ONE PERSON. You counter
 * whoever offered to you, so "notify the countered proposer" and "notify the new
 * offer's receiver" normally select the SAME user — and firing both would push
 * twice for one action, which is exactly what the design rejected.
 *
 * ⚠ AND `if (isCounter) skip the proposal notice` WOULD LOOK CORRECT AND BE WRONG.
 * The counter route takes proposerRosterId/receiverRosterId from the REQUEST BODY
 * rather than deriving them from the parent, so a counter aimed at a third roster
 * is reachable — and there, two notices to two different people is right. The
 * dedupe is therefore by userId, and the third-roster case below is what
 * distinguishes the two implementations. A suite without it passes on both.
 */

const {
  mockIngest,
  mockLeagueFindUnique,
  mockRosterFindFirst,
  mockAfLeagueTradeCreate,
  mockAfLeagueTradeFindFirst,
  mockAfLeagueTradeUpdate,
} = vi.hoisted(() => ({
  mockIngest: vi.fn(),
  mockLeagueFindUnique: vi.fn(),
  mockRosterFindFirst: vi.fn(),
  mockAfLeagueTradeCreate: vi.fn(),
  mockAfLeagueTradeFindFirst: vi.fn(),
  mockAfLeagueTradeUpdate: vi.fn(),
}))

vi.mock('@/lib/notification-engine', () => ({
  ingest: mockIngest,
  // Pass-through: the assertions read the event tradeService actually built.
  tradeEvent: (opts: unknown) => opts,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mockLeagueFindUnique, findUniqueOrThrow: mockLeagueFindUnique },
    roster: { findFirst: mockRosterFindFirst, findUnique: vi.fn(), count: vi.fn() },
    afLeagueTrade: {
      create: mockAfLeagueTradeCreate,
      findFirst: mockAfLeagueTradeFindFirst,
      findUniqueOrThrow: vi.fn(),
      update: mockAfLeagueTradeUpdate,
    },
    afLeagueTradeVote: { upsert: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/league-trade-engine/tradeLearningCapture', () => ({
  captureLiveTradeOffer: vi.fn().mockResolvedValue('offer-1'),
  captureLiveTradeOutcome: vi.fn().mockResolvedValue('outcome-1'),
}))
vi.mock('@/server/services/leagueLifecycleService', () => ({
  assertLifecycleActionAllowed: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/server/services/permissionService', () => ({
  isElevatedCommissioner: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/league-trade-engine/tradeValidationService', () => ({
  validateTradeAssets: vi.fn().mockReturnValue({ ok: true }),
}))
vi.mock('@/lib/league-trade-engine/tradeSettingsResolver', () => ({
  resolveLeagueTradeSettings: vi.fn().mockReturnValue({
    tradeReviewMode: 'instant',
    tradeDeadlineWeek: null,
    tradeReviewHours: 48,
    vetoThresholdPercent: 50,
    processingDelayHours: 0,
    tradesAllowed: true,
    faabTradingAllowed: true,
    draftPickTradingAllowed: true,
    devyTradingAllowed: true,
    c2cTradingAllowed: true,
  }),
}))
vi.mock('@/lib/league-trade-engine/tradeProcessor', () => ({
  applyTradeAssetsInTransaction: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/league-trade-engine/tradeAudit', () => ({
  appendAfTradeProcessingEvent: vi.fn().mockResolvedValue(undefined),
  appendAfTradeStatusHistory: vi.fn().mockResolvedValue(undefined),
  logAfTradeAudit: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/roster-legality/rosterTransactionGates', () => ({
  assertRosterTransactionsAllowed: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({
  publishLeagueFanoutEvent: vi.fn().mockResolvedValue(undefined),
}))

import { createAfLeagueTrade } from '@/lib/league-trade-engine/tradeService'

const LEAGUE_ID = 'league-1'
const NEW_TRADE = 'trade-new'
const PARENT_TRADE = 'trade-parent'

/* A proposes to B; B counters. */
const ROSTER_A = 'roster-a'
const USER_A = 'user-a'
const ROSTER_B = 'roster-b'
const USER_B = 'user-b'
const ROSTER_C = 'roster-c'
const USER_C = 'user-c'

function roster(id: string, platformUserId: string | null) {
  return { id, leagueId: LEAGUE_ID, platformUserId }
}

/** Events handed to `ingest`, flattened to the fields these tests care about. */
function sentNotices(): Array<{ userId: string; type: string; tradeId: string }> {
  return mockIngest.mock.calls.map(([e]) => ({
    userId: (e.userIds as string[])[0]!,
    type: e.type as string,
    tradeId: e.tradeId as string,
  }))
}

/** B counters A's offer, aimed back at A — the ordinary case. */
async function counterBackAtProposer(receiverRoster = roster(ROSTER_A, USER_A)) {
  mockRosterFindFirst
    .mockResolvedValueOnce(roster(ROSTER_B, USER_B)) // proposer of the counter
    .mockResolvedValueOnce(receiverRoster) // receiver of the counter
  mockAfLeagueTradeFindFirst.mockResolvedValue({
    id: PARENT_TRADE,
    rootTradeId: null,
    status: 'pending',
    metadata: {},
    proposedByUserId: USER_A,
  })
  mockAfLeagueTradeCreate.mockResolvedValue({ id: NEW_TRADE })

  return createAfLeagueTrade({
    leagueId: LEAGUE_ID,
    proposedByUserId: USER_B,
    proposerRosterId: ROSTER_B,
    receiverRosterId: receiverRoster.id,
    parentTradeId: PARENT_TRADE,
    assets: [{ itemType: 'player', itemReference: 'p1', fromRosterId: ROSTER_B, toRosterId: receiverRoster.id }],
  })
}

describe('a countered offer notifies the person whose offer died', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLeagueFindUnique.mockResolvedValue({ id: LEAGUE_ID, settings: null })
    mockIngest.mockResolvedValue({ dispatched: true })
    mockAfLeagueTradeUpdate.mockResolvedValue({})
  })

  it('🛑 sends EXACTLY ONE notice, to the countered proposer, typed trade_countered', async () => {
    await counterBackAtProposer()

    expect(sentNotices()).toEqual([{ userId: USER_A, type: 'trade_countered', tradeId: NEW_TRADE }])
  })

  it('🛑 does NOT also send trade_proposed — one action by one person is one notification', async () => {
    /*
     * The counter's receiver IS the countered proposer here, so both rules select
     * user-a. Firing both is the regression this guards, and it would look like a
     * feature ("now they get told twice!") in every other test.
     */
    await counterBackAtProposer()

    expect(sentNotices().filter((n) => n.type === 'trade_proposed')).toHaveLength(0)
    expect(mockIngest).toHaveBeenCalledTimes(1)
  })

  it('🛑 the surviving notice is the COUNTERED one, not the generic proposal', async () => {
    /*
     * Order is the tie-break: trade_countered is planned first so it wins the
     * dedupe. Swap the two pushes and this is the only test that goes red — the
     * count stays 1 and the recipient stays correct, so "exactly one notice" alone
     * would pass against the degraded behaviour.
     */
    await counterBackAtProposer()

    expect(sentNotices()[0]!.type).toBe('trade_countered')
  })

  it('🛑 points at the NEW trade, never the parent the recipient can no longer act on', async () => {
    await counterBackAtProposer()

    const notices = sentNotices()
    expect(notices[0]!.tradeId).toBe(NEW_TRADE)
    expect(notices.some((n) => n.tradeId === PARENT_TRADE)).toBe(false)
  })
})

describe('a counter aimed elsewhere notifies two different people', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLeagueFindUnique.mockResolvedValue({ id: LEAGUE_ID, settings: null })
    mockIngest.mockResolvedValue({ dispatched: true })
    mockAfLeagueTradeUpdate.mockResolvedValue({})
  })

  it('🛑 THE DISCRIMINATOR: dedupe is by userId, not a branch on "is this a counter"', async () => {
    /*
     * The counter route reads proposerRosterId/receiverRosterId from the request
     * body, so B can counter A's offer while aiming the new one at C. Two distinct
     * people then need telling two distinct things.
     *
     * An implementation that skipped the proposal notice whenever parentTradeId was
     * set would pass every test above and fail only this one — leaving C, the person
     * actually being offered a trade, with no notification at all.
     */
    await counterBackAtProposer(roster(ROSTER_C, USER_C))

    const notices = sentNotices()
    expect(notices).toHaveLength(2)
    expect(notices).toContainEqual({ userId: USER_A, type: 'trade_countered', tradeId: NEW_TRADE })
    expect(notices).toContainEqual({ userId: USER_C, type: 'trade_proposed', tradeId: NEW_TRADE })
  })
})

describe('a fresh offer notifies its receiver — trade_proposed previously fired nowhere', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLeagueFindUnique.mockResolvedValue({ id: LEAGUE_ID, settings: null })
    mockIngest.mockResolvedValue({ dispatched: true })
  })

  async function freshOffer(receiver = roster(ROSTER_B, USER_B)) {
    mockRosterFindFirst.mockResolvedValueOnce(roster(ROSTER_A, USER_A)).mockResolvedValueOnce(receiver)
    mockAfLeagueTradeCreate.mockResolvedValue({ id: NEW_TRADE })
    return createAfLeagueTrade({
      leagueId: LEAGUE_ID,
      proposedByUserId: USER_A,
      proposerRosterId: ROSTER_A,
      receiverRosterId: receiver.id,
      assets: [{ itemType: 'player', itemReference: 'p1', fromRosterId: ROSTER_A, toRosterId: receiver.id }],
    })
  }

  it('sends trade_proposed to the receiver, exactly once', async () => {
    await freshOffer()

    expect(sentNotices()).toEqual([{ userId: USER_B, type: 'trade_proposed', tradeId: NEW_TRADE }])
  })

  it('does not invent a trade_countered when nothing was countered', async () => {
    await freshOffer()

    expect(sentNotices().filter((n) => n.type === 'trade_countered')).toHaveLength(0)
  })

  it('⚠ never notifies the actor about their own action', async () => {
    /* Proposing to a roster you own must not push a notification to yourself. */
    await freshOffer(roster(ROSTER_B, USER_A))

    expect(mockIngest).not.toHaveBeenCalled()
  })

  it('⚠ an UNCLAIMED roster is skipped, not notified with a null user id', async () => {
    /*
     * `Roster.platformUserId` is nullable — an unclaimed team has no owner. Passing
     * that straight through would ingest an event whose only recipient is null.
     */
    await freshOffer(roster(ROSTER_B, null))

    expect(mockIngest).not.toHaveBeenCalled()
  })
})

describe('notification failure never fails the trade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLeagueFindUnique.mockResolvedValue({ id: LEAGUE_ID, settings: null })
    mockAfLeagueTradeUpdate.mockResolvedValue({})
  })

  it('🛑 a rejected ingest still returns the created trade id', async () => {
    /*
     * Same fire-and-forget contract as every other notify path in this file. A
     * notification outage must not make countering impossible.
     */
    mockIngest.mockRejectedValue(new Error('notification backend down'))

    const { id } = await counterBackAtProposer()

    expect(id).toBe(NEW_TRADE)
    expect(mockIngest).toHaveBeenCalledTimes(1)
  })
})
