import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ native: vi.fn(), profile: vi.fn(), scan: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { redraftTradeProposal: { findMany: h.native }, userProfile: { findUnique: h.profile } } }))
vi.mock('@/lib/provider-trades/scanPendingSleeperTrades', () => ({ scanPendingSleeperTrades: h.scan }))
import { pendingTradeQuestions } from '@/lib/chimmy/pendingTradeQuestions'
import type { ChimmyLeagueSnapshot } from '@/lib/chimmy/chimmy-league-snapshot'
const snapshot = { id: 'authorized', platform: 'sleeper', platformLeagueId: 'external', sport: 'NFL' } as ChimmyLeagueSnapshot
beforeEach(() => { vi.resetAllMocks(); h.native.mockResolvedValue([]); h.profile.mockResolvedValue({ sleeperUserId: 'owner' }) })
describe('pending offer readers', () => {
  it('scopes native incoming offers to this league and receiver', async () => {
    h.native.mockResolvedValue([{ id: 'offer', receiverRosterId: 'mine', assets: [{ fromRosterId: 'mine', toRosterId: 'other', playerName: 'Quincy Williams' }, { fromRosterId: 'other', toRosterId: 'mine', playerName: 'Tyrone Tracy' }] }])
    const out = await pendingTradeQuestions(snapshot, 'user')
    expect(h.native.mock.calls[0][0].where).toEqual({ leagueId: 'authorized', status: 'pending', receiverRoster: { ownerId: 'user' } })
    expect(out.offers[0].question).toBe('Should I trade Quincy Williams for Tyrone Tracy?')
    expect(h.scan).not.toHaveBeenCalled()
  })
  it('uses the linked owner for provider offers, with no writes or alerts', async () => {
    h.scan.mockResolvedValue({ scanned: true, trades: [{ transactionId: 'external-offer', assetsGiven: [{ playerName: 'Quincy Williams' }], assetsReceived: [{ playerName: '2027 1st' }] }] })
    const out = await pendingTradeQuestions(snapshot, 'user')
    expect(h.scan).toHaveBeenCalledWith({ platformLeagueId: 'external', ownerSleeperId: 'owner', sport: 'NFL' })
    expect(out.offers[0].question).toContain('for 2027 1st')
  })
  it('does not describe an empty public scan as an empty private inbox', async () => {
    h.scan.mockResolvedValue({ scanned: true, trades: [] })
    expect((await pendingTradeQuestions(snapshot, 'user')).gap).toContain('does not mean you have none')
  })
  it('does not use a league owner as the viewer when the viewer has no linked identity', async () => {
    h.profile.mockResolvedValue(null)
    expect((await pendingTradeQuestions(snapshot, 'user')).gap).toContain('not linked')
    expect(h.scan).not.toHaveBeenCalled()
  })
})
