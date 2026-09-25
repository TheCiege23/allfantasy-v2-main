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
 *  4. (2026-09-25) The completion email graded ONE row for everybody — `findFirst`, whichever
 *     importer's copy — so the inbox said B (+24%) where a reader's own screen said A (+25%). Each
 *     recipient is now graded on their own row by the app's own function, and an offer carries the
 *     grade the /core Trades inbox shows.
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
  completedGrader: vi.fn(),
  oneGrade: vi.fn(),
  createGrader: vi.fn(),
  gradeDeal: vi.fn(),
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
      // The per-recipient delivery claim: a unique key, so a second create is P2002 like Postgres.
      create: async ({ data }: { data: { cacheKey: string; data: unknown } }) => {
        if (h.store.has(data.cacheKey)) throw Object.assign(new Error('unique'), { code: 'P2002' })
        h.store.set(data.cacheKey, data.data)
        return {}
      },
      deleteMany: async ({ where }: { where: { cacheKey: string } }) => {
        h.store.delete(where.cacheKey)
        return { count: 1 }
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
// The one grade. Mocked to answer DIFFERENTLY per league row, which is the whole point: the email
// must carry the grade of the reader's own copy of the league, not one row's grade for everyone.
vi.mock('@/lib/decision-os/trade/completedTradeGrade', () => ({
  completedTradeGraderFor: h.completedGrader,
  oneGradeForCompletedTrade: h.oneGrade,
}))
vi.mock('@/lib/decision-os/trade/leagueTradeGrader', () => ({
  createLeagueTradeGrader: h.createGrader,
  gradeDeal: h.gradeDeal,
}))
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
const LEAGUE_TYPE = { type: 'dynasty', label: 'Dynasty', source: 'platform', platform: 'Sleeper' }

/** A graded view, side one's letter as given. Only the fields the notifier or email read matter. */
function view(letter: 'A' | 'B', percentDiff: number) {
  return {
    graded: true,
    letter,
    partnerLetter: letter === 'A' ? 'F' : 'D',
    percentDiff,
    label: 'x',
    sideAdvantage: 'you',
    action: 'accept',
    recommendation: 'x',
    giveValue: 100,
    getValue: 125,
    giveMarket: 100,
    getMarket: 125,
    basis: 'Dynasty',
    scoringApplied: true,
    needApplied: true,
    needGap: null,
    lines: [],
    moves: [],
    leagueType: LEAGUE_TYPE,
  }
}

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
  // Row af-A grades the deal A (+25%), row af-B grades it B (+24%) — the pair measured in production.
  h.completedGrader.mockImplementation(async (rowId: string) => ({ leagueId: rowId, leagueType: LEAGUE_TYPE }))
  h.oneGrade.mockImplementation(async (rowId: string) => (rowId === 'af-A' ? view('A', 25) : view('B', 24)))
  h.createGrader.mockImplementation(async (args: { leagueId: string; userId: string }) => ({ ...args, leagueType: LEAGUE_TYPE }))
  h.gradeDeal.mockImplementation(async () => view('B', 14))
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
    // The grade the /core Trades inbox shows: B's own row, B's side, B's roster need.
    expect(mail.subject).toBe('Trade offer in Pirate League! — B for you: you get Nico Collins for C.J. Stroud')
    expect(h.createGrader).toHaveBeenCalledWith({ leagueId: 'af-B', userId: 'uB' })
    expect(h.gradeDeal).toHaveBeenCalledWith(
      expect.objectContaining({ leagueId: 'af-B', userId: 'uB' }),
      {
        give: { assets: [{ kind: 'player', name: 'C.J. Stroud' }], unpriceable: [] },
        get: { assets: [{ kind: 'player', name: 'Nico Collins' }], unpriceable: [] },
        viewerSide: true,
      },
    )
    expect(mail.html).toContain('https://af.test/core?league=af-B#league-type')
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

  it('a grade that cannot be computed withholds its letter and the alert still goes', async () => {
    h.createGrader.mockRejectedValue(new Error('chart unavailable'))
    h.gradeDeal.mockImplementation(async (grader: unknown) =>
      grader ? view('B', 14) : { graded: false, reason: 'This league’s values could not be loaded just now.', basis: null },
    )
    h.currentIds.mockResolvedValue([trade('pending')])
    await detectAndNotifyLeague('SL1')
    const mail = h.sendEmail.mock.calls[0][0] as { subject: string; html: string }
    expect(mail.subject).toBe('Trade offer in Pirate League! — you get Nico Collins for C.J. Stroud')
    expect(mail.html).toContain('could not be loaded just now')
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

    // 🛑 EACH READER'S OWN ROW'S GRADE — A (+25%) on af-A, B (+24%) on af-B — never one row's for all.
    const graded = Object.fromEntries(
      (h.gradeEmail.mock.calls as Array<[{ grade: { letter: string }; viewerOwnerId: string | null; confirmUrl: string }]>).map(
        ([p], i) => [(h.sendEmail.mock.calls[i][0] as { to: string }).to, [p.grade.letter, p.viewerOwnerId, p.confirmUrl]],
      ),
    )
    expect(graded).toEqual({
      'a@example.org': ['A', 'sl-A', 'https://af.test/core?league=af-A#league-type'],
      'b@example.org': ['B', 'sl-B', 'https://af.test/core?league=af-B#league-type'],
      'c@example.org': ['A', 'sl-C', 'https://af.test/core?league=af-A#league-type'],
    })
    // Graded with the function /core Trades uses, once per row, not once per reader.
    expect(h.oneGrade.mock.calls.map((c) => c[0]).sort()).toEqual(['af-A', 'af-B'])
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

/**
 * 🛑 NEVER LOSE AN ALERT (2026-09-25). The seen-set is written before grading, so any failure after
 * that write — grading unavailable, a trade not in the graded ledger yet, rosters unavailable, one
 * failed send — used to drop the email for good. An alert is now OWED until delivered, retried by
 * the next sweep, and claimed per recipient so the retry reaches only the people it missed.
 */
describe('🛑 an undelivered alert is owed and retried, never lost and never sent twice', () => {
  const owed = () =>
    ((h.store.get(SEEN_KEY) as { owed?: Array<{ kind: string; id: string }> }).owed ?? []).map((a) => `${a.kind}:${a.id}`)
  const mailedTo = () => (h.sendEmail.mock.calls as Array<[{ to: string }]>).map(([m]) => m.to).sort()
  const EVERYONE = ['a@example.org', 'b@example.org', 'c@example.org']

  it('grading unavailable: nothing is sent, the completion stays owed, and the next sweep sends it once', async () => {
    h.currentIds.mockResolvedValue([trade('complete')])
    h.getTradeGrades.mockResolvedValueOnce(null)
    const first = await detectAndNotifyLeague('SL1')
    expect(first.error).toMatch(/grading unavailable/)
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(owed()).toEqual(['completion:T1'])
    expect(first.stillOwed).toBe(1)

    const second = await detectAndNotifyLeague('SL1')
    expect(mailedTo()).toEqual(EVERYONE)
    expect(second.stillOwed).toBe(0)
    expect(owed()).toEqual([])

    // A third sweep has nothing new and nothing owed: nobody hears about it twice.
    h.sendEmail.mockClear()
    await detectAndNotifyLeague('SL1')
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('a completed trade not in the graded ledger yet is owed, then announced when it lands', async () => {
    h.currentIds.mockResolvedValue([trade('complete')])
    h.getTradeGrades.mockResolvedValueOnce({ trades: [] })
    const first = await detectAndNotifyLeague('SL1')
    expect(first.error).toMatch(/not in the graded ledger yet/)
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(owed()).toEqual(['completion:T1'])

    await detectAndNotifyLeague('SL1')
    expect(mailedTo()).toEqual(EVERYONE)
    expect(owed()).toEqual([])
  })

  it('an owed completion is retried after it leaves the feed window — the email is built from the ledger', async () => {
    h.currentIds.mockResolvedValueOnce([trade('complete')])
    h.getTradeGrades.mockResolvedValueOnce(null)
    await detectAndNotifyLeague('SL1')
    h.currentIds.mockResolvedValue([])
    await detectAndNotifyLeague('SL1')
    expect(mailedTo()).toEqual(EVERYONE)
  })

  it('one failed send: the next sweep emails ONLY the recipient it missed, and buzzes nobody again', async () => {
    h.currentIds.mockResolvedValue([trade('complete')])
    h.sendEmail.mockImplementation(async (m: { to: string }) => ({ ok: m.to !== 'b@example.org' }))
    const first = await detectAndNotifyLeague('SL1')
    expect(first.emailsSent).toBe(2)
    expect(owed()).toEqual(['completion:T1'])
    expect(h.sendPush).toHaveBeenCalledTimes(3)

    h.sendEmail.mockReset()
    h.sendEmail.mockResolvedValue({ ok: true })
    h.sendPush.mockClear()
    const second = await detectAndNotifyLeague('SL1')
    expect(mailedTo()).toEqual(['b@example.org'])
    expect(second.emailsSent).toBe(1)
    expect(owed()).toEqual([])
    expect(h.sendPush).not.toHaveBeenCalled()
    // Only B's copy was composed again: 3 on the first sweep, 1 on the retry.
    expect(h.gradeEmail).toHaveBeenCalledTimes(4)
  })

  it('rosters unavailable: the offer is owed, and the next sweep tells B once', async () => {
    h.currentIds.mockResolvedValue([trade('pending')])
    h.rosters.mockResolvedValueOnce(null)
    const first = await detectAndNotifyLeague('SL1')
    expect(first.error).toMatch(/rosters unavailable/)
    expect(owed()).toEqual(['offer:T1'])

    await detectAndNotifyLeague('SL1')
    expect(mailedTo()).toEqual(['b@example.org'])
    expect(owed()).toEqual([])
    await detectAndNotifyLeague('SL1')
    expect(mailedTo()).toEqual(['b@example.org'])
  })

  it('a sweep that throws after marking the trade seen leaves it owed, and the next sweep sends it', async () => {
    h.currentIds.mockResolvedValue([trade('complete')])
    h.getTradeGrades.mockRejectedValueOnce(new Error('connection reset'))
    const first = await detectAndNotifyLeague('SL1')
    expect(first.error).toBe('unexpected failure')
    expect(first.stillOwed).toBe(1)
    expect(owed()).toEqual(['completion:T1'])

    await detectAndNotifyLeague('SL1')
    expect(mailedTo()).toEqual(EVERYONE)
  })

  it('two overlapping sweeps in the same state send each email once', async () => {
    h.currentIds.mockResolvedValue([trade('complete')])
    await Promise.all([detectAndNotifyLeague('SL1'), detectAndNotifyLeague('SL1')])
    expect(mailedTo()).toEqual(EVERYONE)
  })

  it('a failed send gives its claim back — the store holds no email claim for the recipient it missed', async () => {
    h.currentIds.mockResolvedValue([trade('complete')])
    h.sendEmail.mockImplementation(async (m: { to: string }) => ({ ok: m.to !== 'b@example.org' }))
    await detectAndNotifyLeague('SL1')
    const claims = [...h.store.keys()].filter((k) => k.startsWith('trade-notify:sent:v1:SL1:completion:T1:email:')).sort()
    expect(claims).toEqual([
      'trade-notify:sent:v1:SL1:completion:T1:email:uA',
      'trade-notify:sent:v1:SL1:completion:T1:email:uC',
    ])
  })
})

describe('owed alerts in the pure plan', () => {
  const NOW = Date.parse('2026-09-25T12:00:00Z')
  const since = (hoursAgo: number) => new Date(NOW - hoursAgo * 3600_000).toISOString()

  it('new alerts are owed from now', () => {
    const plan = planTradeNotifications([trade('pending')], { seen: [] }, NOW)
    expect(plan.owed).toEqual([{ kind: 'offer', id: 'T1', since: new Date(NOW).toISOString() }])
  })

  it('an owed completion keeps its original `since`', () => {
    const plan = planTradeNotifications([], { seen: ['T1'], owed: [{ kind: 'completion', id: 'T1', since: since(3) }] }, NOW)
    expect(plan.completions).toEqual(['T1'])
    expect(plan.owed).toEqual([{ kind: 'completion', id: 'T1', since: since(3) }])
  })

  it('anything owed longer than 48h is dropped as stale, not sent', () => {
    const plan = planTradeNotifications([], { seen: ['T1'], owed: [{ kind: 'completion', id: 'T1', since: since(49) }] }, NOW)
    expect(plan.completions).toEqual([])
    expect(plan.dropped.map((a) => a.id)).toEqual(['T1'])
    expect(plan.owed).toEqual([])
  })

  it('an owed offer that was accepted is dropped as an offer and announced as a completion', () => {
    const plan = planTradeNotifications(
      [trade('complete')],
      { seen: ['T1'], pending: ['T1'], owed: [{ kind: 'offer', id: 'T1', since: since(1) }] },
      NOW,
    )
    expect(plan.offers).toEqual([])
    expect(plan.completions).toEqual(['T1'])
    expect(plan.dropped).toEqual([{ kind: 'offer', id: 'T1', since: since(1) }])
  })

  it('an owed offer that was withdrawn is dropped', () => {
    const plan = planTradeNotifications([], { seen: ['T1'], pending: ['T1'], owed: [{ kind: 'offer', id: 'T1', since: since(1) }] }, NOW)
    expect(plan.offers).toEqual([])
    expect(plan.dropped.map((a) => a.kind)).toEqual(['offer'])
  })

  it('an owed offer still open is retried', () => {
    const plan = planTradeNotifications(
      [trade('pending')],
      { seen: ['T1'], pending: ['T1'], owed: [{ kind: 'offer', id: 'T1', since: since(1) }] },
      NOW,
    )
    expect(plan.offers.map((o) => o.id)).toEqual(['T1'])
  })

  it('a malformed owed entry is ignored, not thrown on', () => {
    const plan = planTradeNotifications([], { seen: [], owed: [null as never, { kind: 'x', id: 'T9', since: since(1) } as never] }, NOW)
    expect(plan.owed).toEqual([])
  })
})
