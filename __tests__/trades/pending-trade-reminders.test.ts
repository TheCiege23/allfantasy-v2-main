import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findMany, findClaim, findUser, claim, dispatch, evaluate } = vi.hoisted(() => ({
  evaluate: vi.fn(),
  findMany: vi.fn(),
  findClaim: vi.fn(),
  findUser: vi.fn(),
  claim: vi.fn(),
  dispatch: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  afLeagueTrade: { findMany },
  leagueTeam: { findFirst: findClaim },
  appUser: { findUnique: findUser },
  sportsDataCache: { create: claim },
} }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: dispatch }))
vi.mock('@/lib/decision-os/trade/evaluateStoredTrade', () => ({ evaluateStoredTrade: evaluate }))
vi.mock('@/lib/decision-os/world', () => ({ resolveCanonicalWorld: async () => null }))

import { pendingOfferReminderKind, remindPendingTrades } from '@/lib/automation/jobs/trades/remindPendingTrades'

const now = new Date('2026-10-03T18:00:00.000Z')
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000)

beforeEach(() => {
  findMany.mockReset()
  findClaim.mockReset().mockResolvedValue({ claimedByUserId: 'receiver' })
  findUser.mockReset().mockResolvedValue(null)
  claim.mockReset().mockResolvedValue({})
  dispatch.mockReset().mockResolvedValue(undefined)
  evaluate.mockReset().mockResolvedValue({ ok: false, refusal: { code: 'not_found', reason: 'gone', missingAssets: [] } })
})

describe('pending trade reminders', () => {
  it('only selects an open day-later offer or a near-expiry offer', () => {
    expect(pendingOfferReminderKind({ createdAt: hoursAgo(25), expiresAt: null }, now)).toBe('followup')
    expect(pendingOfferReminderKind({ createdAt: hoursAgo(1), expiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1000) }, now)).toBe('expiring')
    expect(pendingOfferReminderKind({ createdAt: hoursAgo(2), expiresAt: null }, now)).toBeNull()
    expect(pendingOfferReminderKind({ createdAt: hoursAgo(25), expiresAt: hoursAgo(1) }, now)).toBeNull()
  })

  it('alerts only the receiving manager and links to the actionable league view once', async () => {
    findMany.mockResolvedValue([{
      id: 'trade-1', leagueId: 'league-1', proposedByUserId: 'proposer',
      createdAt: hoursAgo(25), expiresAt: null,
      league: { name: 'Test League' }, receiverRoster: { platformUserId: 'receiver' },
    }])
    const first = await remindPendingTrades(now)
    expect(first).toEqual({ checked: 1, sent: 1, regraded: 0, moved: 0 })
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      userIds: ['receiver'], category: 'trade_proposals',
      actionHref: '/league/league-1?view=trades',
      skipChannels: { email: true, sms: true },
    }))
    claim.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 'P2002' }))
    const second = await remindPendingTrades(now)
    expect(second.sent).toBe(0)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('does not address a provider roster id as an app user', async () => {
    findMany.mockResolvedValue([{
      id: 'trade-2', leagueId: 'league-1', proposedByUserId: 'proposer',
      createdAt: hoursAgo(25), expiresAt: null,
      league: { name: 'Test League' }, receiverRoster: { platformUserId: 'sleeper-123' },
    }])
    findClaim.mockResolvedValue(null)
    expect((await remindPendingTrades(now)).sent).toBe(0)
    expect(dispatch).not.toHaveBeenCalled()
  })
})

/**
 * Trade OS, 2026-11-21: the reminder re-grades its offer for the receiver on a schedule — the only grade a native
 * offer got before was the one frozen when it was sent.
 */
describe('pending trade reminders carry the grade it has now', () => {
  const offer = {
    id: 'trade-9', leagueId: 'league-1', proposedByUserId: 'proposer', receiverRosterId: 'R-recv',
    createdAt: hoursAgo(25), expiresAt: null,
    league: { name: 'Test League' }, receiverRoster: { platformUserId: 'receiver' },
  }
  const deps = (over: Record<string, unknown> = {}) => ({
    regrade: vi.fn(async () => ({ kind: 'graded' as const, letter: 'D', valueGiven: 4000, valueReceived: 3100 })),
    sentLetter: vi.fn(async () => 'B'),
    resolveWorld: vi.fn(async () => null),
    clock: () => 0,
    ...over,
  })

  it('re-grades for the receiver and says the letter moved since it was sent', async () => {
    findMany.mockResolvedValue([offer])
    const d = deps()
    const out = await remindPendingTrades(now, d)
    expect(out).toEqual({ checked: 1, sent: 1, regraded: 1, moved: 0 })
    expect(d.regrade).toHaveBeenCalledWith({ leagueId: 'league-1', tradeId: 'trade-9' }, 'receiver', expect.any(Function))
    expect(d.sentLetter).toHaveBeenCalledWith('trade-9', 'R-recv')
    const sent = dispatch.mock.calls[0]![0]
    expect(sent.title).toBe('Trade offer waiting in Test League — D for you')
    expect(sent.body).toBe(
      'An offer sent to you is still waiting for a response. It was graded B for you when it was sent; on today’s values AllFantasy grades it D — you get 3,100 for 4,000.',
    )
  })

  it('says "still" when the letter has not moved', async () => {
    findMany.mockResolvedValue([offer])
    await remindPendingTrades(now, deps({ sentLetter: vi.fn(async () => 'D') }))
    expect(dispatch.mock.calls[0]![0].body).toContain('On today’s values AllFantasy still grades it D for you')
  })

  it('names a player who left the sending roster instead of grading a deal that cannot be made', async () => {
    findMany.mockResolvedValue([offer])
    const out = await remindPendingTrades(now, deps({ regrade: vi.fn(async () => ({ kind: 'moved' as const, players: ['Gone Guy'] })) }))
    expect(out.moved).toBe(1)
    expect(dispatch.mock.calls[0]![0].title).toBe('Trade offer waiting in Test League')
    expect(dispatch.mock.calls[0]![0].body).toContain('Gone Guy is no longer on the roster sending him')
  })

  it('by default it grades through the one trade engine, as the receiver, without writing a receipt', async () => {
    findMany.mockResolvedValue([offer])
    evaluate.mockResolvedValueOnce({ ok: true, receipt: { grade: { graded: true, letter: 'C', giveValue: 2000, getValue: 2050 } } })
    const out = await remindPendingTrades(now, { sentLetter: vi.fn(async () => null) })
    expect(evaluate).toHaveBeenCalledWith(
      { leagueId: 'league-1', ref: { kind: 'af', tradeId: 'trade-9' }, userId: 'receiver', surface: 'offer-reminder', persist: false },
      { resolveWorld: expect.any(Function) },
    )
    expect(out.regraded).toBe(1)
    expect(dispatch.mock.calls[0]![0].title).toBe('Trade offer waiting in Test League — C for you')

    dispatch.mockClear()
    claim.mockResolvedValue({})
    evaluate.mockResolvedValueOnce({ ok: false, refusal: { code: 'asset_moved', reason: 'moved', missingAssets: ['Gone Guy', 'Other Guy'] } })
    expect((await remindPendingTrades(now, { sentLetter: vi.fn(async () => null) })).moved).toBe(1)
    expect(dispatch.mock.calls[0]![0].body).toContain('Gone Guy, Other Guy are no longer on the roster sending them')
  })

  it('a failed re-grade, or a tick past its budget, sends the reminder exactly as before — never a guessed grade', async () => {
    findMany.mockResolvedValue([offer])
    await remindPendingTrades(now, deps({ regrade: vi.fn(async () => { throw new Error('boom') }) }))
    expect(dispatch.mock.calls[0]![0]).toMatchObject({ title: 'Trade offer waiting in Test League', body: 'An offer sent to you is still waiting for a response.' })
    dispatch.mockClear()
    let t = 0
    const late = deps({ clock: () => (t += 60_000) })
    await remindPendingTrades(now, late)
    expect(late.regrade).not.toHaveBeenCalled()
    expect(dispatch.mock.calls[0]![0].body).toBe('An offer sent to you is still waiting for a response.')
  })
})
