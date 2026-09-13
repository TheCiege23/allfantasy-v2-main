import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Cancelling a generic league trade (audit #8).
 *
 * 🛑 THE PROPOSER COULD WITHDRAW A TRADE THE OTHER MANAGER HAD ALREADY ACCEPTED. `cancelAfLeagueTrade`
 * allowed `pending` OR `scheduled` for the proposer. `scheduled` is only ever set by
 * `finalizeAfLeagueTradeProcessing` when a processing delay applies — the trade was accepted and approved,
 * and is waiting out the delay. So the proposer could accept-then-renege: agree, watch the other side
 * commit, and pull it before processing.
 *
 * ⚠ AND THE WRITE WAS UNCONDITIONAL. A cancel that read `scheduled` and wrote a moment after the scheduled
 * processor claimed the trade overwrote `processed` with `cancelled` while the rosters had already moved.
 * Settlement claims on the status it read; cancel now does the same.
 *
 * Rules pinned here:
 *   - the proposer may cancel only a PENDING trade (not yet accepted)
 *   - a commissioner who is NOT the proposer may still cancel a pending or scheduled trade
 *   - a commissioner who IS the proposer is a party, and gets the proposer's rule
 *   - a cancel that loses the claim throws, and records nothing
 */

const h = vi.hoisted(() => ({
  tradeFindFirst: vi.fn(),
  tradeUpdate: vi.fn(),
  tradeUpdateMany: vi.fn(),
  rosterFindFirst: vi.fn(),
  isElevatedCommissioner: vi.fn(),
  appendStatusHistory: vi.fn(),
  captureOutcome: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    afLeagueTrade: { findFirst: h.tradeFindFirst, update: h.tradeUpdate, updateMany: h.tradeUpdateMany },
    roster: { findFirst: h.rosterFindFirst },
  },
}))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: h.isElevatedCommissioner }))
vi.mock('@/lib/league-trade-engine/tradeAudit', () => ({
  appendAfTradeProcessingEvent: vi.fn(),
  appendAfTradeStatusHistory: h.appendStatusHistory,
  logAfTradeAudit: vi.fn(),
}))
vi.mock('@/lib/league-trade-engine/tradeLearningCapture', () => ({
  captureLiveTradeOffer: vi.fn(),
  captureLiveTradeOutcome: h.captureOutcome,
}))
vi.mock('@/server/services/leagueLifecycleService', () => ({ assertLifecycleActionAllowed: vi.fn() }))
vi.mock('@/lib/league-trade-engine/tradeValidationService', () => ({ validateTradeAssets: vi.fn() }))
vi.mock('@/lib/league-trade-engine/tradeSettingsResolver', () => ({ resolveLeagueTradeSettings: vi.fn() }))
vi.mock('@/lib/league-trade-engine/tradeProcessor', () => ({ applyTradeAssetsInTransaction: vi.fn() }))
vi.mock('@/lib/roster-legality/rosterTransactionGates', () => ({ assertRosterTransactionsAllowed: vi.fn() }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn() }))
vi.mock('@/lib/events', () => ({ EVENT: {}, getPlatformEvents: () => ({ emitInTx: vi.fn() }) }))

import { cancelAfLeagueTrade } from '@/lib/league-trade-engine/tradeService'

const LEAGUE = 'league-1'
const PROPOSER = 'user-proposer'
const COMMISH = 'user-commish'

function arrange(opts: { status: string; actor: string; actorIsProposer: boolean; actorIsCommissioner: boolean }) {
  h.tradeFindFirst.mockResolvedValue({ id: 'trade-1', leagueId: LEAGUE, status: opts.status, proposerRosterId: 'roster-p' })
  h.rosterFindFirst.mockResolvedValue(opts.actorIsProposer ? { id: 'roster-p', leagueId: LEAGUE, platformUserId: opts.actor } : null)
  h.isElevatedCommissioner.mockResolvedValue(opts.actorIsCommissioner)
  return () => cancelAfLeagueTrade({ tradeId: 'trade-1', leagueId: LEAGUE, userId: opts.actor })
}

function expectNothingWritten() {
  expect(h.tradeUpdateMany).not.toHaveBeenCalled()
  expect(h.tradeUpdate).not.toHaveBeenCalled()
  expect(h.appendStatusHistory).not.toHaveBeenCalled()
  expect(h.captureOutcome).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  h.tradeUpdateMany.mockResolvedValue({ count: 1 })
  h.tradeUpdate.mockResolvedValue({})
  h.appendStatusHistory.mockResolvedValue(undefined)
  h.captureOutcome.mockResolvedValue(undefined)
})

describe('cancelAfLeagueTrade', () => {
  it('🛑 refuses the proposer once the trade is accepted and scheduled to process', async () => {
    const cancel = arrange({ status: 'scheduled', actor: PROPOSER, actorIsProposer: true, actorIsCommissioner: false })
    await expect(cancel()).rejects.toThrow(/only a commissioner/i)
    expectNothingWritten()
  })

  it('still lets the proposer withdraw a pending offer, claimed on the status it read', async () => {
    const cancel = arrange({ status: 'pending', actor: PROPOSER, actorIsProposer: true, actorIsCommissioner: false })
    await cancel()

    expect(h.tradeUpdateMany).toHaveBeenCalledWith({
      where: { id: 'trade-1', status: 'pending' },
      data: expect.objectContaining({ status: 'cancelled' }),
    })
    expect(h.appendStatusHistory).toHaveBeenCalledWith(expect.objectContaining({ fromStatus: 'pending', toStatus: 'cancelled' }))
    expect(h.captureOutcome).toHaveBeenCalledWith({ tradeId: 'trade-1', leagueId: LEAGUE, status: 'cancelled' })
  })

  it('lets a commissioner who is not a party cancel a scheduled trade before it processes', async () => {
    const cancel = arrange({ status: 'scheduled', actor: COMMISH, actorIsProposer: false, actorIsCommissioner: true })
    await cancel()
    expect(h.tradeUpdateMany).toHaveBeenCalledWith({
      where: { id: 'trade-1', status: 'scheduled' },
      data: expect.objectContaining({ status: 'cancelled' }),
    })
  })

  it('treats a commissioner who proposed the trade as the proposer', async () => {
    const cancel = arrange({ status: 'scheduled', actor: COMMISH, actorIsProposer: true, actorIsCommissioner: true })
    await expect(cancel()).rejects.toThrow(/only a commissioner/i)
    expectNothingWritten()
  })

  it('🛑 throws and records nothing when the trade changed state between the read and the write', async () => {
    // The scheduled processor claimed it first: this row is now `processed`, and the rosters have moved.
    const cancel = arrange({ status: 'scheduled', actor: COMMISH, actorIsProposer: false, actorIsCommissioner: true })
    h.tradeUpdateMany.mockResolvedValue({ count: 0 })

    await expect(cancel()).rejects.toThrow(/changed state/i)
    expect(h.tradeUpdate).not.toHaveBeenCalled()
    expect(h.appendStatusHistory).not.toHaveBeenCalled()
    expect(h.captureOutcome).not.toHaveBeenCalled()
  })

  it('still refuses someone who is neither the proposer nor a commissioner', async () => {
    const cancel = arrange({ status: 'pending', actor: 'user-other', actorIsProposer: false, actorIsCommissioner: false })
    await expect(cancel()).rejects.toThrow('Only proposer or commissioner can cancel')
    expectNothingWritten()
  })
})
