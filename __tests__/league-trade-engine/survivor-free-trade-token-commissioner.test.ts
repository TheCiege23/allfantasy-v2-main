// @vitest-environment node
/**
 * The REAL generic trade engine (lib/league-trade-engine/tradeService.ts) with the REAL Survivor trade
 * rules, the REAL bypass registry and the REAL free-trade-token provider/redeemer. Only the database
 * and the reward ledger's token store (`getSurvivorTradeTokens` / `redeemSurvivorTradeToken`) are
 * doubles. A cross-tribe trade in a league that bans cross-tribe trades passes only because the
 * receiver holds a free-trade token:
 *  - processed through a commissioner's decision (approval of a reviewed trade): the token is NOT spent;
 *  - processed after a normal accept: the token IS spent, once, under `af:<tradeId>`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  trade: null as Record<string, unknown> | null,
  tokens: vi.fn(),
  redeem: vi.fn(),
  updateMany: vi.fn(),
}))

const LEAGUE = {
  id: 'L1', settings: { tribalCouncilDay: 'Tuesday', tribalCouncilTime: '20:00', survivorGovernance: { tradeRulesEnabled: true, crossTribeTrades: 'banned', withinTribeUnplayedOnly: false, playedLockUntilTribal: false } },
  survivorMode: true, sport: 'NFL', season: 2026, language: 'en',
}

vi.mock('@/lib/prisma', () => {
  const db: Record<string, unknown> = {
    league: { findUnique: vi.fn(async () => LEAGUE), findUniqueOrThrow: vi.fn(async () => LEAGUE) },
    roster: {
      findMany: vi.fn(async () => [{ id: 'ra', redraftRosterId: 'rd-a', platformUserId: 'ua' }, { id: 'rb', redraftRosterId: 'rd-b', platformUserId: 'ub' }]),
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => null),
    },
    survivorPlayer: { findMany: vi.fn(async () => [{ userId: 'ua', redraftRosterId: 'ra', tribeId: 'scorps' }, { userId: 'ub', redraftRosterId: 'rb', tribeId: 'shrooms' }]) },
    survivorGameState: { findUnique: vi.fn(async () => ({ currentWeek: 9, phase: 'pre_merge', mergeTriggeredAt: null })) },
    survivorTribalCouncil: { findFirst: vi.fn(async () => null) },
    redraftRosterPlayer: { findMany: vi.fn(async () => []) },
    afLeagueTrade: {
      findUniqueOrThrow: vi.fn(async () => h.trade),
      findFirst: vi.fn(async () => h.trade),
      update: vi.fn(async () => ({})),
      updateMany: h.updateMany,
    },
  }
  db.$transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb({
    afLeagueTrade: { update: vi.fn(), updateMany: h.updateMany },
    roster: { findUnique: vi.fn(async () => null) },
    tradeExecutionSnapshot: { create: vi.fn(async () => ({ id: 'snap' })) },
  }))
  return { prisma: db }
})
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ getActiveEffectsForRoster: async () => [], getSurvivorTradeTokens: h.tokens, redeemSurvivorTradeToken: h.redeem }))
vi.mock('@/lib/redraft/lineupLock', () => ({
  buildWeekKickoffMap: async () => ({ byTeam: new Map(), firstKickoff: null, warnings: [] }),
  lockTeamLookupKeys: (_s: string, t: string | null | undefined) => (t ? [t] : []),
}))
vi.mock('@/lib/league-trade-engine/tradeLearningCapture', () => ({ captureLiveTradeOffer: vi.fn(), captureLiveTradeOutcome: vi.fn() }))
vi.mock('@/lib/events', () => ({ EVENT: { TRADE_PROCESSED: 'p' }, getPlatformEvents: () => ({ emitInTx: vi.fn(async () => ({ eventId: 'e' })) }) }))
vi.mock('@/server/services/leagueLifecycleService', () => ({ assertLifecycleActionAllowed: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/league-trade-engine/tradeValidationService', () => ({ validateTradeAssets: vi.fn().mockReturnValue({ ok: true }) }))
vi.mock('@/lib/league-trade-engine/tradeSettingsResolver', () => ({
  resolveLeagueTradeSettings: vi.fn().mockReturnValue({ tradeReviewMode: 'instant', tradeDeadlineWeek: null, tradeReviewHours: 48, vetoThresholdPercent: 50, processingDelayHours: 0, tradesAllowed: true }),
}))
vi.mock('@/lib/league-trade-engine/tradeProcessor', () => ({ applyTradeAssetsInTransaction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/league-trade-engine/tradeAudit', () => ({ appendAfTradeProcessingEvent: vi.fn(), appendAfTradeStatusHistory: vi.fn(), logAfTradeAudit: vi.fn() }))
vi.mock('@/lib/roster-legality/rosterTransactionGates', () => ({ assertRosterTransactionsAllowed: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/integrity/enqueueCollusionScan', () => ({ enqueueCollusionScan: vi.fn() }))

import { commissionerAfTradeDecision, finalizeAfLeagueTradeProcessing } from '@/lib/league-trade-engine/tradeService'
import { checkSurvivorTradeRules } from '@/lib/survivor/survivorTradeRuleHook'

const trade = (status: string) => ({
  id: 'trade-1', leagueId: 'L1', status, proposerRosterId: 'ra', receiverRosterId: 'rb', processingDelayHours: 0, scheduledProcessAt: null,
  reviewType: status === 'awaiting_commissioner' ? 'commissioner' : 'instant', vetoThresholdPercent: null, proposedByUserId: 'ua',
  items: [{ itemType: 'player', itemReference: 'p1', fromRosterId: 'ra', toRosterId: 'rb', metadata: {} }, { itemType: 'player', itemReference: 'p2', fromRosterId: 'rb', toRosterId: 'ra', metadata: {} }],
})
const token = { rewardId: 'tok1', type: 'free_trade_token', status: 'available', spec: { type: 'free_trade_token', rosterId: 'rb', samePositionOnly: false }, holderRosterIds: ['rb'] }

beforeEach(() => {
  vi.clearAllMocks()
  h.updateMany.mockResolvedValue({ count: 1 })
  h.tokens.mockImplementation(async (_l: string, rosterId: string) => (rosterId === 'rb' ? [token] : []))
  h.redeem.mockResolvedValue({ ok: true, rewardId: 'tok1', status: 'consumed', duplicate: false, changes: [], note: 'trade:af:trade-1' })
})

describe('free-trade token through the real trade engine', () => {
  it('control: the trade only passes the Survivor rules because of the token', async () => {
    h.tokens.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const blocked = await checkSurvivorTradeRules({ leagueId: 'L1', rosterIds: ['ra', 'rb'], rosterIdSpace: 'league', players: [{ playerId: 'p1', fromRosterId: 'ra' }] })
    expect(blocked).toMatchObject({ ok: false, code: 'SURVIVOR_CROSS_TRIBE_BANNED' })
    const allowed = await checkSurvivorTradeRules({ leagueId: 'L1', rosterIds: ['ra', 'rb'], rosterIdSpace: 'league', players: [{ playerId: 'p1', fromRosterId: 'ra' }] })
    expect(allowed).toMatchObject({ ok: true, bypassRequired: true, bypassSource: 'free_trade_token:rb' })
  })

  it('a commissioner-approved trade is processed and the held token is NOT spent', async () => {
    h.trade = trade('awaiting_commissioner')
    await commissionerAfTradeDecision({ tradeId: 'trade-1', leagueId: 'L1', userId: 'commish', decision: 'approve' })
    expect(h.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'processed' }) }))
    expect(h.redeem).not.toHaveBeenCalled()
  })

  it('the commissioner-only process route path (commissionerApproved) does not spend it either', async () => {
    h.trade = trade('scheduled')
    await finalizeAfLeagueTradeProcessing({ tradeId: 'trade-1', actorUserId: 'commish', commissionerApproved: true })
    expect(h.updateMany).toHaveBeenCalled()
    expect(h.redeem).not.toHaveBeenCalled()
  })

  it('a normal accept that needed the bypass spends the token, once, under af:<tradeId>', async () => {
    h.trade = trade('pending')
    await finalizeAfLeagueTradeProcessing({ tradeId: 'trade-1', actorUserId: 'ub', deadlineChecked: true })
    expect(h.redeem).toHaveBeenCalledTimes(1)
    expect(h.redeem).toHaveBeenCalledWith({ leagueId: 'L1', rosterId: 'rb', tradeRef: 'af:trade-1', week: 9, actorUserId: 'ub' })
  })
})
