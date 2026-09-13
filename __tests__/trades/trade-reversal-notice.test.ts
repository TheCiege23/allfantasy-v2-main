import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The league notice for a reversed trade.
 *
 * 🛑 THE PROPERTY THAT MATTERS MOST IS WHAT IT LEAVES OUT. The commissioner's reason lives on the reversal
 * row for commissioners. Broadcast to every member of the league, "collusion between A and B" stops being
 * a notice and becomes an accusation — so the reason is not even an input to this function.
 */

const publishMock = vi.fn()
vi.mock('@/lib/league-events/publisher', () => ({
  publishLeagueFanoutEvent: (...a: unknown[]) => publishMock(...a),
}))
// The direct notice to the two managers is covered in trade-reversal-party-notice.test.ts. Here the trade
// resolves to nobody, so only the league announcement is observed.
vi.mock('@/lib/notification-engine', () => ({ ingest: vi.fn(), tradeEvent: (opts: unknown) => opts }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    afLeagueTrade: { findUnique: async () => null },
    redraftTradeProposal: { findUnique: async () => null },
  },
}))

describe('publishTradeReversalNotice', () => {
  beforeEach(() => {
    publishMock.mockReset()
    publishMock.mockResolvedValue(undefined)
  })

  it('publishes one league-wide announcement, deduplicated by the reversal row’s own noticeKey', async () => {
    const { publishTradeReversalNotice } = await import('@/lib/trade-reversal/notice')
    await publishTradeReversalNotice({
      leagueId: 'l-1',
      tradeId: 't-1',
      noticeKey: 'af_trade:t-1:reversed',
      engine: 'generic',
      actorUserId: 'u-commish',
    })

    expect(publishMock).toHaveBeenCalledTimes(1)
    expect(publishMock.mock.calls[0][0]).toMatchObject({
      leagueId: 'l-1',
      eventType: 'af_trade_reversed',
      title: 'Trade reversed',
      category: 'league_announcements',
      visibility: 'all_members',
      actorUserId: 'u-commish',
      actionHref: '/league/l-1',
      // The key the reversal wrote — never rebuilt here, so the two cannot drift apart.
      dedupeKey: 'af_trade:t-1:reversed',
      meta: { tradeId: 't-1', engine: 'generic' },
    })
  })

  it('names the native engine’s event type for native reversals', async () => {
    const { publishTradeReversalNotice } = await import('@/lib/trade-reversal/notice')
    await publishTradeReversalNotice({
      leagueId: 'l-1',
      tradeId: 'p-1',
      noticeKey: 'redraft_trade:p-1:reversed',
      engine: 'native',
      actorUserId: 'u-commish',
    })
    expect(publishMock.mock.calls[0][0]).toMatchObject({
      eventType: 'redraft_trade_reversed',
      dedupeKey: 'redraft_trade:p-1:reversed',
    })
  })

  it('🛑 carries no reason and no team names in anything a member receives', async () => {
    const { publishTradeReversalNotice, TRADE_REVERSED_MESSAGE } = await import('@/lib/trade-reversal/notice')
    await publishTradeReversalNotice({
      leagueId: 'l-1',
      tradeId: 't-1',
      noticeKey: 'af_trade:t-1:reversed',
      engine: 'generic',
      actorUserId: 'u-commish',
    })
    const sent = publishMock.mock.calls[0][0] as Record<string, unknown>
    expect(sent.message).toBe(TRADE_REVERSED_MESSAGE)
    // Nothing in the payload may carry a reason, under any field name.
    expect(JSON.stringify(sent).toLowerCase()).not.toContain('reason')
    expect(Object.keys(sent.meta as object).sort()).toEqual(['engine', 'tradeId'])
  })

  it('lets a publisher failure propagate, so the caller decides it is best-effort', async () => {
    // The routes wrap this in `.catch` because the reversal has already committed. Swallowing here as
    // well would hide a failure the route is the right place to log.
    publishMock.mockRejectedValue(new Error('league lookup failed'))
    const { publishTradeReversalNotice } = await import('@/lib/trade-reversal/notice')
    await expect(
      publishTradeReversalNotice({
        leagueId: 'l-1',
        tradeId: 't-1',
        noticeKey: 'k',
        engine: 'generic',
        actorUserId: 'u',
      }),
    ).rejects.toThrow('league lookup failed')
  })
})
