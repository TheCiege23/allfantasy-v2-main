import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 🛑 A NATIVE TRADE'S NOTICES CARRY THE GRADE (2026-09-27).
 *
 * "Someone in your league sent you a trade offer" went out by email, push and in-app — while THE
 * grade for that exact offer had been computed seconds earlier (`evaluateServerTradeDecision`) and
 * frozen into its receipt. The Sleeper offer and completed-trade emails already carried it; the
 * native ones did not. Title and body are what every channel renders, so the line goes there.
 *
 * Harness from `counter-notification-dispatch.test.ts`, with the server decision mocked so the
 * letters are known.
 */

const {
  mockIngest,
  mockLeagueFindUnique,
  mockRosterFindFirst,
  mockAfLeagueTradeCreate,
  mockAfLeagueTradeFindFirst,
  mockAfLeagueTradeFindUnique,
  mockSnapshotFindFirst,
  mockDecision,
  store,
} = vi.hoisted(() => ({
  mockIngest: vi.fn(),
  mockLeagueFindUnique: vi.fn(),
  mockRosterFindFirst: vi.fn(),
  mockAfLeagueTradeCreate: vi.fn(),
  mockAfLeagueTradeFindFirst: vi.fn(),
  mockAfLeagueTradeFindUnique: vi.fn(),
  mockSnapshotFindFirst: vi.fn(),
  mockDecision: vi.fn(),
  /*
   * ⚠ THE RECEIPT STORE IS ON ONLY FOR THE RECEIPT READ. With it present, `createAfLeagueTrade`
   * takes its transactional path (it writes the receipt inside the create); without it, the plain
   * path `counter-notification-dispatch.test.ts` drives. The notices are sent AFTER either path, so
   * the creation tests use the plain one rather than a hand-built transaction double.
   */
  store: { receipts: false },
}))

vi.mock('@/lib/notification-engine', () => ({
  ingest: mockIngest,
  tradeEvent: (opts: unknown) => opts,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mockLeagueFindUnique, findUniqueOrThrow: mockLeagueFindUnique },
    roster: { findFirst: mockRosterFindFirst, findUnique: vi.fn(), count: vi.fn() },
    afLeagueTrade: {
      create: mockAfLeagueTradeCreate,
      findFirst: mockAfLeagueTradeFindFirst,
      findUnique: mockAfLeagueTradeFindUnique,
      findUniqueOrThrow: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    get tradeDecisionSnapshot() {
      return store.receipts ? { findFirst: mockSnapshotFindFirst } : undefined
    },
    afLeagueTradeVote: { upsert: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/league-trade-engine/serverTradeDecision', () => ({ evaluateServerTradeDecision: mockDecision }))
vi.mock('@/lib/league-trade-engine/tradeLearningCapture', () => ({
  captureLiveTradeOffer: vi.fn().mockResolvedValue('offer-1'),
  captureLiveTradeOutcome: vi.fn().mockResolvedValue('outcome-1'),
}))
vi.mock('@/server/services/leagueLifecycleService', () => ({ assertLifecycleActionAllowed: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/league-trade-engine/tradeValidationService', () => ({ validateTradeAssets: vi.fn().mockReturnValue({ ok: true }) }))
vi.mock('@/lib/league-trade-engine/tradeSettingsResolver', () => ({
  resolveLeagueTradeSettings: vi.fn().mockReturnValue({
    tradeReviewMode: 'instant', tradeDeadlineWeek: null, tradeReviewHours: 48, vetoThresholdPercent: 50, processingDelayHours: 0,
    tradesAllowed: true, faabTradingAllowed: true, draftPickTradingAllowed: true, devyTradingAllowed: true, c2cTradingAllowed: true,
  }),
}))
vi.mock('@/lib/league-trade-engine/tradeProcessor', () => ({ applyTradeAssetsInTransaction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/league-trade-engine/tradeAudit', () => ({
  appendAfTradeProcessingEvent: vi.fn().mockResolvedValue(undefined),
  appendAfTradeStatusHistory: vi.fn().mockResolvedValue(undefined),
  logAfTradeAudit: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/roster-legality/rosterTransactionGates', () => ({ assertRosterTransactionsAllowed: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn().mockResolvedValue(undefined) }))

import { createAfLeagueTrade, frozenProposerGrade, gradeNoticeLine } from '@/lib/league-trade-engine/tradeService'

const LEAGUE_ID = 'league-1'
const roster = (id: string, platformUserId: string | null) => ({ id, leagueId: LEAGUE_ID, platformUserId })

/** THE grade for an A→B offer: A (proposer) comes out ahead, B reads the mirror. */
const decision = (over: Record<string, unknown> = {}) => ({
  modelVersion: 'v', capturedAt: '2026-09-27T00:00:00Z', scope: 'market', evaluatorSupported: true, reason: null,
  participants: [
    { rosterId: 'roster-a', grade: 'B', valueGiven: 1500, valueReceived: 2000 },
    { rosterId: 'roster-b', grade: 'D', valueGiven: 2000, valueReceived: 1500 },
  ],
  ...over,
})

type Notice = { userIds: string[]; type: string; title: string; body: string }
const notices = (): Notice[] => mockIngest.mock.calls.map(([e]) => e as Notice)

beforeEach(() => {
  vi.clearAllMocks()
  store.receipts = false
  mockLeagueFindUnique.mockResolvedValue({ id: LEAGUE_ID, settings: null })
  mockIngest.mockResolvedValue({ dispatched: true })
  mockDecision.mockResolvedValue(decision())
})

describe('gradeNoticeLine — THE grade in a notice’s words', () => {
  it('states the letter and the values, from the recipient’s side', () => {
    expect(gradeNoticeLine({ grade: 'D', valueGiven: 2000, valueReceived: 1500 }, 'offer')).toEqual({
      titleSuffix: ' — D for you',
      bodyLine: 'AllFantasy grades it D for you on this league’s values — you get 1,500 for 2,000.',
    })
    expect(gradeNoticeLine({ grade: 'B', valueGiven: 1500, valueReceived: 2000 }, 'sent')?.bodyLine)
      .toBe('You sent it graded B for you on this league’s values — you get 2,000 for 1,500.')
  })

  it('no letter, no line — a withheld grade is never replaced by a neutral one', () => {
    expect(gradeNoticeLine({ grade: null, valueGiven: null, valueReceived: null }, 'offer')).toBeNull()
    expect(gradeNoticeLine(null, 'offer')).toBeNull()
    expect(gradeNoticeLine({ grade: 'ACCEPT', valueGiven: 1, valueReceived: 1 }, 'offer')).toBeNull()
  })
})

describe('the notices a new native offer sends', () => {
  it('🛑 the receiver of a fresh offer is told THEIR letter and values', async () => {
    mockRosterFindFirst.mockResolvedValueOnce(roster('roster-a', 'user-a')).mockResolvedValueOnce(roster('roster-b', 'user-b'))
    mockAfLeagueTradeCreate.mockResolvedValue({ id: 'trade-new' })
    await createAfLeagueTrade({
      leagueId: LEAGUE_ID, proposedByUserId: 'user-a', proposerRosterId: 'roster-a', receiverRosterId: 'roster-b',
      assets: [{ itemType: 'player', itemReference: 'p1', fromRosterId: 'roster-a', toRosterId: 'roster-b' }],
    })
    const [n] = notices()
    expect(n).toMatchObject({ userIds: ['user-b'], type: 'trade_proposed', title: 'New trade offer — D for you' })
    expect(n!.body).toBe('Someone in your league sent you a trade offer. AllFantasy grades it D for you on this league’s values — you get 1,500 for 2,000.')
  })

  it('the proposer of a COUNTERED offer is told their side of the new one', async () => {
    // B counters A's offer back at A: the new trade's proposer is B, and A reads the mirror.
    mockDecision.mockResolvedValue(decision({ participants: [
      { rosterId: 'roster-b', grade: 'A', valueGiven: 1000, valueReceived: 2000 },
      { rosterId: 'roster-a', grade: 'F', valueGiven: 2000, valueReceived: 1000 },
    ] }))
    mockRosterFindFirst.mockResolvedValueOnce(roster('roster-b', 'user-b')).mockResolvedValueOnce(roster('roster-a', 'user-a'))
    mockAfLeagueTradeFindFirst.mockResolvedValue({ id: 'trade-parent', rootTradeId: null, status: 'pending', metadata: {}, proposedByUserId: 'user-a', proposerRosterId: 'roster-a', receiverRosterId: 'roster-b', items: [] })
    mockAfLeagueTradeCreate.mockResolvedValue({ id: 'trade-new' })
    await createAfLeagueTrade({
      leagueId: LEAGUE_ID, proposedByUserId: 'user-b', proposerRosterId: 'roster-b', receiverRosterId: 'roster-a', parentTradeId: 'trade-parent',
      assets: [{ itemType: 'player', itemReference: 'p1', fromRosterId: 'roster-b', toRosterId: 'roster-a' }],
    })
    expect(notices()).toHaveLength(1)
    expect(notices()[0]).toMatchObject({ userIds: ['user-a'], type: 'trade_countered', title: 'Your trade offer was countered — F for you' })
    expect(notices()[0]!.body).toContain('AllFantasy grades it F for you on this league’s values — you get 1,000 for 2,000.')
  })

  it('a withheld grade leaves the notice exactly as it was', async () => {
    mockDecision.mockResolvedValue(decision({ participants: [
      { rosterId: 'roster-a', grade: null, valueGiven: null, valueReceived: null },
      { rosterId: 'roster-b', grade: null, valueGiven: null, valueReceived: null },
    ] }))
    mockRosterFindFirst.mockResolvedValueOnce(roster('roster-a', 'user-a')).mockResolvedValueOnce(roster('roster-b', 'user-b'))
    mockAfLeagueTradeCreate.mockResolvedValue({ id: 'trade-new' })
    await createAfLeagueTrade({
      leagueId: LEAGUE_ID, proposedByUserId: 'user-a', proposerRosterId: 'roster-a', receiverRosterId: 'roster-b',
      assets: [{ itemType: 'player', itemReference: 'p1', fromRosterId: 'roster-a', toRosterId: 'roster-b' }],
    })
    expect(notices()[0]).toMatchObject({ title: 'New trade offer', body: 'Someone in your league sent you a trade offer.' })
  })
})

describe('frozenProposerGrade — the letter the proposer SENT it at', () => {
  beforeEach(() => {
    store.receipts = true
  })

  it('a deployment without the receipt table: null, never a throw', async () => {
    store.receipts = false
    mockAfLeagueTradeFindUnique.mockResolvedValue({ proposerRosterId: 'roster-a' })
    expect(await frozenProposerGrade('trade-1')).toBeNull()
  })

  it('reads the proposer’s side of the frozen receipt', async () => {
    mockAfLeagueTradeFindUnique.mockResolvedValue({ proposerRosterId: 'roster-a' })
    mockSnapshotFindFirst.mockResolvedValue({
      completeness: 'complete', policyVersion: 'p', format: 'redraft', capturedAt: new Date('2026-09-27T00:00:00Z'),
      evidence: {}, readiness: {}, outcomeSimulation: {}, assetContext: {},
      decisionResult: { participants: [
        { rosterId: 'roster-a', grade: 'B', valueGiven: 1500, valueReceived: 2000, action: 'accept', recommendation: 'x', reason: 'Market: +33%.', coveragePct: 100 },
        { rosterId: 'roster-b', grade: 'D', valueGiven: 2000, valueReceived: 1500, action: 'counter', recommendation: 'x', reason: 'Market: -25%.', coveragePct: 100 },
      ] },
    })
    expect(await frozenProposerGrade('trade-1')).toMatchObject({ rosterId: 'roster-a', grade: 'B', valueGiven: 1500, valueReceived: 2000 })
  })

  it('no receipt, or an unreadable one: null, never a thrown notice', async () => {
    mockAfLeagueTradeFindUnique.mockResolvedValue({ proposerRosterId: 'roster-a' })
    mockSnapshotFindFirst.mockResolvedValue(null)
    expect(await frozenProposerGrade('trade-1')).toBeNull()
    mockSnapshotFindFirst.mockRejectedValue(new Error('relation "trade_decision_snapshots" does not exist'))
    expect(await frozenProposerGrade('trade-1')).toBeNull()
  })
})
