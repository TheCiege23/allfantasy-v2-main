import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The direct notice to the two managers whose trade a commissioner reversed.
 *
 * 🛑 WHY THIS EXISTS. The league announcement for a reversal names nobody, on purpose — so on its own, the two
 * people whose rosters just changed underneath them found out the same way as the other ten managers. They
 * now also get a `trade_reversed` notice addressed to them, through the notification engine path that
 * tradeService already uses to tell a manager their offer was accepted, rejected or countered.
 *
 * What these pin:
 *   - both engines resolve the RIGHT people: `Roster.platformUserId` (generic), `RedraftRoster.ownerId` (native)
 *   - placeholders are not people: `orphan-`, `ai-manager-`, and native `roster:<id>` owners are skipped
 *   - a commissioner who reversed a trade they were part of is not told what they just did
 *   - one person on both sides is told once
 *   - the direct notice carries no reason, like the announcement
 *   - one delivery failing never costs the other, and the failure still reaches the route's log
 */

const h = vi.hoisted(() => ({
  publish: vi.fn(),
  ingest: vi.fn(),
  afTrade: vi.fn(),
  redraftProposal: vi.fn(),
}))

vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: h.publish }))
vi.mock('@/lib/notification-engine', () => ({
  ingest: h.ingest,
  // Pass-through: the assertions read the event the notice module actually built.
  tradeEvent: (opts: unknown) => opts,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    afLeagueTrade: { findUnique: h.afTrade },
    redraftTradeProposal: { findUnique: h.redraftProposal },
  },
}))

import { publishTradeReversalNotice } from '@/lib/trade-reversal/notice'

const COMMISH = 'u-commish'

const genericTrade = (proposer: string | null, receiver: string | null) => ({
  proposerRoster: { platformUserId: proposer },
  receiverRoster: { platformUserId: receiver },
})
const nativeProposal = (proposer: string | null, receiver: string | null) => ({
  proposerRoster: { ownerId: proposer },
  receiverRoster: { ownerId: receiver },
})

const reverseGeneric = () =>
  publishTradeReversalNotice({
    leagueId: 'l-1',
    tradeId: 't-1',
    noticeKey: 'af_trade:t-1:reversed',
    engine: 'generic',
    actorUserId: COMMISH,
  })
const reverseNative = () =>
  publishTradeReversalNotice({
    leagueId: 'l-1',
    tradeId: 'p-1',
    noticeKey: 'redraft_trade:p-1:reversed',
    engine: 'native',
    actorUserId: COMMISH,
  })

const sent = () => h.ingest.mock.calls.map(([event]) => event as Record<string, unknown>)

beforeEach(() => {
  vi.clearAllMocks()
  h.publish.mockResolvedValue(undefined)
  h.ingest.mockResolvedValue({ dispatched: true, sourceKey: 'k' })
  h.afTrade.mockResolvedValue(null)
  h.redraftProposal.mockResolvedValue(null)
})

describe('direct notice to the managers of a reversed trade', () => {
  it('tells both managers of a generic trade, in one trade_reversed notice addressed to them', async () => {
    h.afTrade.mockResolvedValue(genericTrade('u-a', 'u-b'))
    await reverseGeneric()

    expect(h.afTrade).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 't-1' } }))
    expect(h.redraftProposal).not.toHaveBeenCalled()
    expect(sent()).toEqual([
      expect.objectContaining({
        type: 'trade_reversed',
        userIds: ['u-a', 'u-b'],
        leagueId: 'l-1',
        tradeId: 't-1',
        title: 'Your trade was reversed',
      }),
    ])
    // The announcement to the league still goes out alongside it.
    expect(h.publish).toHaveBeenCalledTimes(1)
  })

  it('tells both managers of a native redraft trade, resolved from the roster owners', async () => {
    h.redraftProposal.mockResolvedValue(nativeProposal('u-a', 'u-b'))
    await reverseNative()

    expect(h.redraftProposal).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p-1' } }))
    expect(h.afTrade).not.toHaveBeenCalled()
    expect(sent()).toEqual([expect.objectContaining({ type: 'trade_reversed', userIds: ['u-a', 'u-b'], tradeId: 'p-1' })])
  })

  it('does not tell a commissioner about a reversal of their own trade', async () => {
    h.afTrade.mockResolvedValue(genericTrade(COMMISH, 'u-b'))
    await reverseGeneric()
    expect(sent()).toEqual([expect.objectContaining({ userIds: ['u-b'] })])
  })

  it('skips placeholder owners — orphan and AI-manager slots, and unclaimed native rosters', async () => {
    h.afTrade.mockResolvedValue(genericTrade('orphan-r1', 'ai-manager-r2'))
    await reverseGeneric()
    expect(h.ingest).not.toHaveBeenCalled()
    expect(h.publish).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    h.publish.mockResolvedValue(undefined)
    h.ingest.mockResolvedValue({ dispatched: true, sourceKey: 'k' })
    h.redraftProposal.mockResolvedValue(nativeProposal('roster:generic-r1', 'u-b'))
    await reverseNative()
    expect(sent()).toEqual([expect.objectContaining({ userIds: ['u-b'] })])
  })

  it('tells one person once when they are on both sides', async () => {
    h.afTrade.mockResolvedValue(genericTrade('u-a', 'u-a'))
    await reverseGeneric()
    expect(sent()).toEqual([expect.objectContaining({ userIds: ['u-a'] })])
  })

  it('sends nothing directly when the trade row cannot be found, and does not throw', async () => {
    await expect(reverseGeneric()).resolves.toBeUndefined()
    expect(h.ingest).not.toHaveBeenCalled()
    expect(h.publish).toHaveBeenCalledTimes(1)
  })

  it('🛑 carries no reason and nothing beyond the fixed copy', async () => {
    h.afTrade.mockResolvedValue(genericTrade('u-a', 'u-b'))
    await reverseGeneric()
    const event = sent()[0]!
    expect(JSON.stringify(event).toLowerCase()).not.toContain('reason')
    expect(Object.keys(event).sort()).toEqual(['body', 'leagueId', 'title', 'tradeId', 'type', 'userIds'])
  })
})

describe('the two deliveries fail independently', () => {
  it('a failure resolving the managers does not stop the league announcement, and still propagates', async () => {
    h.afTrade.mockRejectedValue(new Error('trade lookup failed'))
    await expect(reverseGeneric()).rejects.toThrow('trade lookup failed')
    expect(h.publish).toHaveBeenCalledTimes(1)
  })

  it('a failed league announcement does not stop the direct notice, and still propagates', async () => {
    h.afTrade.mockResolvedValue(genericTrade('u-a', 'u-b'))
    h.publish.mockRejectedValue(new Error('league lookup failed'))
    await expect(reverseGeneric()).rejects.toThrow('league lookup failed')
    expect(h.ingest).toHaveBeenCalledTimes(1)
  })
})
