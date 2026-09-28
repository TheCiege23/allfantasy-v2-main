/**
 * Imported leagues: a pending Sleeper offer surfaced by the trade sweep reaches the DM between
 * the two managers — only when BOTH are AllFantasy users — and its completion is said there.
 * Same fixture shape as trade-notify-offers.test.ts: two AF copies of one Sleeper league.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  currentIds: vi.fn(),
  rosters: vi.fn(),
  postImported: vi.fn(),
  postStatus: vi.fn(),
  sendEmail: vi.fn(),
  prefRows: [] as Array<{ email: string; tradeAlerts: boolean; unsubscribedAt: Date | null }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      findUnique: async ({ where }: { where: { cacheKey: string } }) =>
        h.store.has(where.cacheKey) ? { data: h.store.get(where.cacheKey) } : null,
      upsert: async ({ where, create }: { where: { cacheKey: string }; create: { data: unknown } }) => {
        h.store.set(where.cacheKey, JSON.parse(JSON.stringify(create.data)))
        return {}
      },
    },
    league: {
      findMany: async () => [
        {
          id: 'af-A', name: 'Pirate League!', userId: 'uA', sport: 'NFL',
          teams: [{ claimedByUserId: 'uA', platformUserId: 'sl-A' }, { claimedByUserId: 'uC', platformUserId: 'sl-C' }],
        },
        { id: 'af-B', name: 'Pirate League!', userId: 'uB', sport: 'NFL', teams: [{ claimedByUserId: 'uB', platformUserId: null }] },
      ],
    },
    appUser: {
      findMany: async () => [
        { id: 'uA', email: 'a@example.org' },
        { id: 'uB', email: 'b@example.org' },
        { id: 'uC', email: 'c@example.org' },
      ],
    },
    emailPreference: { findMany: async () => h.prefRows },
    userProfile: { findMany: async () => [{ userId: 'uB', sleeperUserId: 'sl-B' }] },
  },
}))
vi.mock('@/lib/trade-intel/sleeperTradeSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/trade-intel/sleeperTradeSync')>()
  return { ...actual, currentTradeIds: h.currentIds, fetchLeagueRosters: h.rosters }
})
vi.mock('@/lib/chat-notifications/tradeOfferSources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/chat-notifications/tradeOfferSources')>()
  return { ...actual, postImportedOfferToDm: h.postImported }
})
vi.mock('@/lib/chat-notifications/tradeOfferDm', () => ({ postTradeStatusToDm: h.postStatus }))
vi.mock('@/lib/trade-intel/sleeperTradeGradeService', () => ({ getTradeGrades: async () => null }))
vi.mock('@/lib/trade-intel/tradeExpectationLoader', () => ({ loadTradeExpectation: async () => null }))
vi.mock('@/lib/trade-intel/tradePsychologyLoader', () => ({ loadTradePsychology: async () => null }))
vi.mock('@/lib/access/canAccessForUser', () => ({ canAccessForUser: async () => ({ allowed: false }) }))
vi.mock('@/lib/resend-client', () => ({ sendTemplatedEmail: h.sendEmail }))
vi.mock('@/lib/push-notifications', () => ({ sendPushToUser: vi.fn(async () => []) }))
vi.mock('@/lib/notifications/pushGate', () => ({ decidePushForUser: vi.fn(async () => ({ allowed: false })) }))
vi.mock('@/lib/email/marketing-email', () => ({ createEmailUnsubscribeToken: (e: string) => `tok-${e}` }))
vi.mock('@/lib/email/undeliverableDomains', () => ({ isUndeliverableEmailDomain: () => false }))
vi.mock('@/lib/get-base-url', () => ({ getBaseUrl: () => 'https://af.test' }))
vi.mock('@/lib/api-cache/SleeperCacheLayer', () => ({
  SleeperHttpError: class extends Error {},
  getLeagueRosters: async () => [],
  getLeagueTransactions: async () => [],
  getAllPlayers: async () => ({
    p1: { full_name: 'Nico Collins', position: 'WR', team: 'HOU' },
    p2: { full_name: 'C.J. Stroud', position: 'QB', team: 'HOU' },
  }),
  getLeagueUsers: async () => [
    { user_id: 'sl-A', display_name: 'Dana' },
    { user_id: 'sl-B', display_name: 'bob@example.org', metadata: { team_name: 'Bob Squad' } },
    { user_id: 'sl-D', display_name: 'Dee' },
  ],
}))

import { detectAndNotifyLeague } from '@/lib/trade-intel/tradeNotifyService'
import type { FeedTrade } from '@/lib/trade-intel/sleeperTradeSync'

const ROSTERS = [
  { roster_id: 1, owner_id: 'sl-A' },
  { roster_id: 2, owner_id: 'sl-B' },
  { roster_id: 3, owner_id: 'sl-C' },
  { roster_id: 4, owner_id: 'sl-D' }, // not on AllFantasy
]

function trade(status: FeedTrade['status'], creator: string, rosterIds: number[], id = 'T1'): FeedTrade {
  const [a, b] = rosterIds
  return {
    id,
    status,
    rosterIds,
    creator,
    createdMs: 1_758_816_000_000,
    // Roster `a` sends Nico Collins (p1) to `b`; `b` sends C.J. Stroud (p2) to `a`.
    tx: { adds: { p1: b!, p2: a! }, drops: { p1: a!, p2: b! }, draft_picks: [], waiver_budget: [] },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.store.clear()
  h.store.set('trade-notify:v1:SL1', { version: 2, seen: [], lastRunIso: '2026-09-24T00:00:00Z' })
  h.rosters.mockResolvedValue(ROSTERS)
  h.postImported.mockResolvedValue({ posted: true })
  h.postStatus.mockResolvedValue({ posted: false, reason: 'no_offer_in_dm' })
  h.sendEmail.mockResolvedValue({ ok: true })
  h.prefRows = []
})

describe('a Sleeper offer between two AllFantasy managers reaches their DM', () => {
  it('A offers B: posted once, from A, each manager linked to their OWN copy of the league', async () => {
    h.currentIds.mockResolvedValue([trade('pending', 'sl-A', [1, 2])])
    await detectAndNotifyLeague('SL1')

    expect(h.postImported).toHaveBeenCalledTimes(1)
    expect(h.postImported.mock.calls[0][0]).toMatchObject({
      provider: 'sleeper',
      providerLeagueId: 'SL1',
      transactionId: 'T1',
      directionKnown: true,
      proposer: {
        userId: 'uA',
        manager: 'Dana',
        gives: [{ label: 'Nico Collins', detail: 'WR · HOU' }],
        href: '/core/trades?league=af-A&trade=T1',
      },
      receiver: {
        userId: 'uB',
        // The Sleeper display name is an address here; the team name is used instead.
        manager: 'Bob Squad',
        gives: [{ label: 'C.J. Stroud', detail: 'QB · HOU' }],
        href: '/core/trades?league=af-B&trade=T1',
      },
    })
  })

  it('🛑 the other manager is only on Sleeper: no DM is created with a non-user', async () => {
    h.currentIds.mockResolvedValue([trade('pending', 'sl-D', [4, 2])])
    await detectAndNotifyLeague('SL1')
    expect(h.postImported).not.toHaveBeenCalled()
    // B is still emailed about it — that path is unchanged.
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('the DM does not depend on trade emails: everyone unsubscribed, the offer still reaches the DM', async () => {
    h.prefRows = ['a@example.org', 'b@example.org', 'c@example.org'].map((email) => ({ email, tradeAlerts: false, unsubscribedAt: null }))
    h.currentIds.mockResolvedValue([trade('pending', 'sl-A', [1, 2])])
    await detectAndNotifyLeague('SL1')
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(h.postImported).toHaveBeenCalledTimes(1)
  })

  it('a three-roster offer has no single DM and is skipped', async () => {
    h.currentIds.mockResolvedValue([{ ...trade('pending', 'sl-A', [1, 2]), rosterIds: [1, 2, 3] }])
    await detectAndNotifyLeague('SL1')
    expect(h.postImported).not.toHaveBeenCalled()
  })

  it('when the offer completes, the DM hears "accepted"', async () => {
    h.store.set('trade-notify:v1:SL1', { version: 2, seen: ['T1'], pending: ['T1'], lastRunIso: '2026-09-24T00:00:00Z' })
    h.currentIds.mockResolvedValue([trade('complete', 'sl-A', [1, 2])])
    await detectAndNotifyLeague('SL1')
    expect(h.postStatus).toHaveBeenCalledWith({ source: 'sleeper', tradeId: 'SL1:T1', status: 'accepted' })
  })
})
