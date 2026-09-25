/**
 * A Sleeper trade reaches the league page it is announced for — BEHAVIOURAL, not source-matching.
 *
 * 🛑 THE THREE BUGS (audit 2026-09-24, measured on production):
 *  1. A trade caught while PENDING was marked seen, then looked up in the graded ledger (completed
 *     trades only), not found, and dropped. It kept its id when accepted, so the completion was never
 *     announced either. Every AF trade email in the Resend log read "Trade completed in …".
 *  2. Every link pointed at `afLeagues[0]` — one importer's copy of the league. /core redirects a
 *     `?league=` the viewer does not play, so everyone else landed on a board that cannot show it.
 *     28 Sleeper leagues / 65 AF rows.
 *  3. An offer went nowhere at all; now it goes ONLY to the managers in it who still have to answer.
 *
 * The earlier suite for this feature (`pending-trade-detection.test.ts`) matched source strings and
 * never ran the grade filter, which is how bug 1 shipped behind a green check.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  leagueFindMany: vi.fn(),
  currentIds: vi.fn(),
  rosters: vi.fn(),
  getTradeGrades: vi.fn(),
  sendEmail: vi.fn(),
  sendPush: vi.fn(),
  gradeEmail: vi.fn(),
  pushGate: vi.fn(),
  archive: vi.fn(),
}))

vi.mock('server-only', () => ({}))
// The archive write (its own suite: __tests__/import-os/archive-feed-trades.test.ts). Mocked so this
// suite stays hermetic, and so the sweep's call can be asserted.
vi.mock('@/lib/import-os/collector/archiveFeedTrades', () => ({ archiveCompletedFeedTrades: h.archive }))
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
    league: { findMany: h.leagueFindMany },
    appUser: {
      findMany: async () => [
        { id: 'uA', email: 'a@example.org' },
        { id: 'uB', email: 'b@example.org' },
        { id: 'uC', email: 'c@example.org' },
      ],
    },
    emailPreference: { findMany: async () => [] },
    // uB's claimed team carries no platform id, so their Sleeper id must come from the profile —
    // the same fallback the league Trades panel uses.
    userProfile: { findMany: async () => [{ userId: 'uB', sleeperUserId: 'sl-B' }] },
  },
}))
vi.mock('@/lib/trade-intel/sleeperTradeSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/trade-intel/sleeperTradeSync')>()
  const override = { currentTradeIds: h.currentIds, fetchLeagueRosters: h.rosters }
  // A key that is not a real export overrides nothing and lets the suite hit Sleeper for real.
  for (const key of Object.keys(override)) {
    if (!(key in actual)) throw new Error(`mock stubs "${key}", which sleeperTradeSync does not export`)
  }
  return { ...actual, ...override }
})
vi.mock('@/lib/trade-intel/sleeperTradeGradeService', () => ({ getTradeGrades: h.getTradeGrades }))
vi.mock('@/lib/trade-intel/tradeExpectationLoader', () => ({ loadTradeExpectation: async () => null }))
vi.mock('@/lib/trade-intel/tradePsychologyLoader', () => ({ loadTradePsychology: async () => null }))
vi.mock('@/lib/access/canAccessForUser', () => ({ canAccessForUser: async () => ({ allowed: false }) }))
vi.mock('@/lib/resend-client', () => ({ sendTemplatedEmail: h.sendEmail }))
vi.mock('@/lib/push-notifications', () => ({ sendPushToUser: h.sendPush }))
vi.mock('@/lib/notifications/pushGate', () => ({ decidePushForUser: h.pushGate }))
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
  getLeagueUsers: async () => [{ user_id: 'sl-D', display_name: 'Dana' }],
}))
// The completed-trade email is built from a graded trade; what matters here is WHERE it links.
vi.mock('@/lib/trade-intel/tradeGradeEmail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/trade-intel/tradeGradeEmail')>()
  return { ...actual, buildTradeGradeEmail: h.gradeEmail }
})

import { detectAndNotifyLeague, planTradeNotifications } from '@/lib/trade-intel/tradeNotifyService'
import type { FeedTrade } from '@/lib/trade-intel/sleeperTradeSync'

const SEEN_KEY = 'trade-notify:v1:SL1'

/** Two AF copies of one Sleeper league: A imported it (C claimed a team there), B imported their own. */
const ROWS = [
  {
    id: 'af-A',
    name: 'Pirate League!',
    userId: 'uA',
    sport: 'NFL',
    teams: [
      { claimedByUserId: 'uA', platformUserId: 'sl-A' },
      { claimedByUserId: 'uC', platformUserId: 'sl-C' },
    ],
  },
  { id: 'af-B', name: 'Pirate League!', userId: 'uB', sport: 'NFL', teams: [{ claimedByUserId: 'uB', platformUserId: null }] },
]
const ROSTERS = [
  { roster_id: 1, owner_id: 'sl-A' },
  { roster_id: 2, owner_id: 'sl-B' },
  { roster_id: 3, owner_id: 'sl-C' },
  { roster_id: 4, owner_id: 'sl-D' }, // not on AllFantasy
]

function trade(status: FeedTrade['status'], creator = 'sl-D'): FeedTrade {
  // B (roster 2) gets Nico Collins from D (roster 4) and gives C.J. Stroud.
  return {
    id: 'T1',
    status,
    rosterIds: [2, 4],
    creator,
    createdMs: 1,
    tx: { adds: { p1: 2, p2: 4 }, drops: { p1: 4, p2: 2 }, draft_picks: [], waiver_budget: [] },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.store.clear()
  // Not a first run: an empty v2 record, so the bootstrap path is not what gets tested.
  h.store.set(SEEN_KEY, { version: 2, seen: [], lastRunIso: '2026-09-24T00:00:00Z' })
  h.leagueFindMany.mockResolvedValue(ROWS)
  h.rosters.mockResolvedValue(ROSTERS)
  h.sendEmail.mockResolvedValue({ ok: true })
  h.sendPush.mockResolvedValue([])
  h.pushGate.mockResolvedValue({ allowed: true })
  h.gradeEmail.mockImplementation((p: { ledgerUrl: string }) => ({ subject: 'Trade completed in X', html: p.ledgerUrl }))
  h.getTradeGrades.mockResolvedValue({
    trades: [{ id: 'SL1:T1', sides: [{ rosterId: 2, managerName: 'B' }, { rosterId: 4, managerName: 'D' }] }],
  })
})

describe('planTradeNotifications (pure)', () => {
  it('a new offer is announced and remembered as pending', () => {
    const plan = planTradeNotifications([trade('pending')], { seen: [] })
    expect(plan.offers.map((o) => o.id)).toEqual(['T1'])
    expect(plan.completions).toEqual([])
    expect(plan.pending).toEqual(['T1'])
    expect(plan.seen).toEqual(['T1'])
  })

  it('🛑 an offer seen while pending IS announced when it completes — the swallowed-trade bug', () => {
    const plan = planTradeNotifications([trade('complete')], { seen: ['T1'], pending: ['T1'] })
    expect(plan.completions).toEqual(['T1'])
    expect(plan.pending).toEqual([])
  })

  it('a completion already announced is not announced twice', () => {
    const plan = planTradeNotifications([trade('complete')], { seen: ['T1'], pending: [] })
    expect(plan.completions).toEqual([])
    expect(plan.offers).toEqual([])
  })

  it('a record written before `pending` existed reads as no offers outstanding', () => {
    expect(planTradeNotifications([trade('pending')], { seen: ['T1'] }).offers).toEqual([])
  })

  it('a trade listed twice in the feed is handled once', () => {
    expect(planTradeNotifications([trade('complete'), trade('complete')], { seen: [] }).completions).toEqual(['T1'])
  })
})

describe('🛑 an offer goes only to the managers in it, linked to their own copy of the league', () => {
  it('B is in the offer and did not send it: B alone is told, on B’s own row', async () => {
    h.currentIds.mockResolvedValue([trade('pending')])
    const r = await detectAndNotifyLeague('SL1')

    expect(r.newOffers).toBe(1)
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
    const mail = h.sendEmail.mock.calls[0][0] as { to: string; subject: string; html: string }
    expect(mail.to).toBe('b@example.org')
    expect(mail.subject).toBe('Trade offer in Pirate League! — you get Nico Collins for C.J. Stroud')
    expect(mail.html).toContain('Dana sent you an offer')
    expect(mail.html).toContain('https://af.test/core/trades?league=af-B&amp;trade=T1')
    // Sleeper's trade screen is a verified link; AllFantasy cannot answer the offer itself.
    expect(mail.html).toContain('https://sleeper.com/leagues/SL1/trades')

    expect(h.pushGate).toHaveBeenCalledWith('uB', expect.objectContaining({ category: 'trade_proposals', leagueId: 'af-B' }))
    expect(h.sendPush).toHaveBeenCalledWith('uB', expect.objectContaining({ href: '/core/trades?league=af-B&trade=T1' }))
    // No grade email for an offer: it is not a completed trade.
    expect(h.gradeEmail).not.toHaveBeenCalled()
  })

  it('the manager who SENT the offer is not told about it', async () => {
    h.currentIds.mockResolvedValue([trade('pending', 'sl-B')])
    await detectAndNotifyLeague('SL1')
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('rosters unavailable: the alert is skipped and SAID so, and the offer is still remembered', async () => {
    h.rosters.mockResolvedValue(null)
    h.currentIds.mockResolvedValue([trade('pending')])
    const r = await detectAndNotifyLeague('SL1')
    expect(r.error).toMatch(/rosters unavailable/)
    expect((h.store.get(SEEN_KEY) as { pending: string[] }).pending).toEqual(['T1'])
  })
})

describe('🛑 the completion of an offer we saw pending is announced, league-wide, per-row links', () => {
  it('run 1 sees the offer; run 2 sees it accepted and emails every member on their OWN row', async () => {
    h.currentIds.mockResolvedValue([trade('pending')])
    await detectAndNotifyLeague('SL1')
    vi.clearAllMocks()
    h.leagueFindMany.mockResolvedValue(ROWS)
    h.sendEmail.mockResolvedValue({ ok: true })
    h.pushGate.mockResolvedValue({ allowed: true })
    h.gradeEmail.mockImplementation((p: { ledgerUrl: string }) => ({ subject: 'Trade completed in X', html: p.ledgerUrl }))
    h.getTradeGrades.mockResolvedValue({
      trades: [{ id: 'SL1:T1', sides: [{ rosterId: 2, managerName: 'B' }, { rosterId: 4, managerName: 'D' }] }],
    })

    h.currentIds.mockResolvedValue([trade('complete')])
    const r = await detectAndNotifyLeague('SL1')

    expect(r.newTrades).toBe(1)
    const links = Object.fromEntries(
      (h.gradeEmail.mock.calls as Array<[{ ledgerUrl: string; leagueId: string }]>).map(([p], i) => [
        (h.sendEmail.mock.calls[i][0] as { to: string }).to,
        [p.ledgerUrl, p.leagueId],
      ]),
    )
    expect(links).toEqual({
      'a@example.org': ['https://af.test/core/trades?league=af-A&trade=T1', 'af-A'],
      'b@example.org': ['https://af.test/core/trades?league=af-B&trade=T1', 'af-B'],
      // C claimed a team on A's copy, so C's own row IS af-A.
      'c@example.org': ['https://af.test/core/trades?league=af-A&trade=T1', 'af-A'],
    })
    expect(h.sendPush).toHaveBeenCalledWith('uB', expect.objectContaining({ href: '/core/trades?league=af-B&trade=T1' }))
    // 🛑 The sweep that noticed the completion writes it to the trade archive from the same feed —
    // for leagues nobody has opened since, it is the first reader to see it.
    expect(h.archive).toHaveBeenCalledTimes(1)
    expect(h.archive).toHaveBeenCalledWith({ sleeperLeagueId: 'SL1', feed: [trade('complete')] })
  })

  it('an offer alone writes nothing to the archive — a trade that has not happened is not history', async () => {
    h.currentIds.mockResolvedValue([trade('pending')])
    await detectAndNotifyLeague('SL1')
    expect(h.archive).not.toHaveBeenCalled()
  })

  it('the AF rows are read in a fixed order, so the fallback row is stable', async () => {
    h.currentIds.mockResolvedValue([trade('complete')])
    await detectAndNotifyLeague('SL1')
    expect(h.leagueFindMany.mock.calls[0][0]).toMatchObject({ orderBy: { createdAt: 'asc' } })
  })
})
