// @vitest-environment node
import { Suspense, isValidElement, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The /core home streams each card on its own.
 *
 * 🛑 THE REGRESSION IS ONE `await` LONG, AND NOTHING ELSE CATCHES IT. Put any home read back in
 * line — `const dash34 = await getDash34Data(...)` — and every card waits for it again: the page
 * still renders, every card still appears, every other test stays green. So this suite holds EVERY
 * home read open individually and asserts, by running the real page:
 *
 *   1. The home body returns while every read is still pending, and each independent read has
 *      already STARTED (a read that is merely never awaited would also "not block" — so the reads
 *      that should have started are checked, and the ones that must wait for another are too).
 *   2. Each card resolves as soon as ITS reads land, while cards waiting on other reads do not.
 *   3. With the summary read failed — null OR rejected — the honest "could not read your leagues"
 *      panel still stands in the issues card, no summary card claims emptiness, and the shell's
 *      signals still settle rather than taking the screen down.
 *   4. No screen waits for its tab badges — and on the home the badges wait for the trade scan's
 *      pending-offers write, because both rewrite the same cache row whole. They wait ONLY when a
 *      write is actually coming: with no Sleeper identity the scan writes nothing.
 *   5. A trades read that cannot stand behind what it returned does not advance the "since your
 *      last visit" TRADE boundary — a total failure, and the three ways the read resolves while
 *      blind to part of the picture. The visit itself moves either way: the standings and injury
 *      snapshot in the same marker were read fine.
 *   6. A league whose home could not be read gets that league's failure panel, not a blank screen
 *      and not the account-wide "could not read your leagues" copy — and a league that DID load
 *      gets its screen, so 6 is a claim about the failure and not about the branch.
 */

const g = vi.hoisted(() => {
  type Gate = { promise: Promise<unknown>; open: (value: unknown) => void; fail: (error: unknown) => void }
  const gates = new Map<string, Gate>()
  const calls = new Map<string, number>()
  const fns = new Map<string, ReturnType<typeof import('vitest').vi.fn>>()
  const gate = (name: string): Gate => {
    let existing = gates.get(name)
    if (!existing) {
      let open!: (value: unknown) => void
      let fail!: (error: unknown) => void
      const promise = new Promise<unknown>((resolve, reject) => {
        open = resolve
        fail = reject
      })
      // A gate nobody awaits must never surface as an unhandled rejection when a test fails it.
      promise.catch(() => undefined)
      existing = { promise, open, fail }
      gates.set(name, existing)
    }
    return existing
  }
  /*
   * What the trades read reports back: the offers a scan found, and whether it admits to having
   * been blind to part of the picture. Both are per-test — the scan only reports offers when there
   * is a Sleeper identity to scan for, and an incomplete read must hold the TRADE boundary open.
   */
  const scan: { scanned: Array<{ leagueId: string; waiting: number }>; incomplete: string | null } = {
    scanned: [],
    incomplete: null,
  }
  const account: { sleeperUserId: string | null; leagues: unknown[] | null } = { sleeperUserId: 's1', leagues: null }
  /** The league home read: null is "could not read it", an object is a league that loaded. */
  const leagueHome: { data: unknown } = { data: null }
  return { gates, calls, fns, gate, scan, account, leagueHome }
})

/** A loader that records its call and settles only when its gate is opened or failed. */
function held(name: string) {
  const fn = vi.fn(() => {
    g.calls.set(name, (g.calls.get(name) ?? 0) + 1)
    return g.gate(name).promise
  })
  g.fns.set(name, fn)
  return fn
}
const called = (name: string) => g.calls.get(name) ?? 0

const LEAGUE = {
  id: 'L1',
  name: 'Ice Kings',
  platform: 'sleeper',
  sport: 'NFL',
  hasUnifiedRecord: true,
  platformLeagueId: 'p1',
  isCommissioner: false,
  settings: {},
  leagueType: 'redraft',
  leagueVariant: null,
  isDynasty: false,
  lastSyncedAt: null,
}

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1', email: 'u1@example.test' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: 'NEXT_REDIRECT' })
  }),
  useRouter: () => ({ push() {}, replace() {}, prefetch() {}, refresh() {} }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }), headers: async () => new Headers() }))
vi.mock('@/lib/dashboard/get-dashboard-league-list', () => ({
  getDashboardLeagueListForUser: vi.fn(async () => ({ leagues: g.account.leagues ?? [LEAGUE], sleeperUserId: g.account.sleeperUserId })),
}))
vi.mock('@/lib/leagues/touchLeagueViewed', () => ({ touchLeagueViewed: vi.fn(async () => undefined) }))

// Shell reads: resolved at once — this suite is about what happens after the shell.
vi.mock('@/lib/core-app/coreActivity', () => ({
  getCoreActivitySnapshot: vi.fn(async () => ({ gameDayActive: false, liveGameCount: 0, draftLive: false, liveDraftLeagueIds: [] })),
}))
vi.mock('@/lib/core-app/leagueDataSignals', () => ({ getLeagueDataSignals: vi.fn(async () => ({ hasScoredWeek: true })) }))
vi.mock('@/lib/values/valueSurfaceEligibility', () => ({ resolveLeagueValueSurfaces: vi.fn(async () => ({ hasIdp: false })) }))
vi.mock('@/lib/core-app/devy', () => ({ leagueDevySlotCount: vi.fn(async () => 0), getDevyCoreData: vi.fn(async () => null) }))
vi.mock('@/lib/adminAuth', () => ({ getAdminAccessState: vi.fn(async () => ({ status: 'denied' })) }))
vi.mock('@/lib/chat-core/unreadCounts', () => ({ getChatUnread: vi.fn(async () => ({ total: 0, mentions: 0 })) }))
vi.mock('@/lib/core-app/railMatchups', () => ({ getRailMatchups: vi.fn(async () => null) }))
vi.mock('@/lib/ai-access/AIAccessResolver', () => ({ aiAccessResolver: { resolveForUser: vi.fn(async () => null) } }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformNotification: { count: vi.fn(async () => 0) },
    appUser: { findUnique: vi.fn(async () => null) },
    league: { findUnique: vi.fn(async () => ({ settings: {}, platform: 'sleeper' })) },
  },
}))

// The home's reads, each held open by its own gate.
vi.mock('@/lib/core-app/dash34', () => ({ getDash34Data: held('dash34'), imageOf: () => null }))
vi.mock('@/lib/core-app/currentWeek', () => ({ resolveCurrentWeek: held('tradeWeek') }))
vi.mock('@/lib/core-app/weekAll', () => ({
  getWeekAll: held('week'),
  // A real scored league once there is a week to score, so win probability really prices one.
  scoredMatchupLeagueIds: vi.fn((_live: string[], week: unknown) => (week ? ['L1'] : [])),
}))
vi.mock('@/lib/core-app/weekBoard', () => ({ getWeekBoard: held('schedule'), getRivalryRadar: vi.fn(async () => null) }))
vi.mock('@/lib/core-app/career', () => ({ getCareerData: held('career') }))
vi.mock('@/lib/core-app/dash3aPanels', () => ({ getCrossLeagueExposure: held('exposure'), getRivalRecords: held('rivals') }))
vi.mock('@/lib/core-app/followingCard', () => ({ getFollowingCard: held('following') }))
vi.mock('@/lib/core-app/decisionReceipts', () => ({ getDecisionReceipts: held('receipts') }))
vi.mock('@/lib/core-app/weeklyRoutine', () => ({
  getRoutineFacts: held('routineFacts'),
  buildWeeklyRoutine: vi.fn(() => ({ marker: 'routine' })),
}))
vi.mock('@/lib/core-app/todayStrip', () => ({ getTodayStrip: held('strip') }))
vi.mock('@/lib/live/playFeedPresentation', () => ({ getPlayFeed: held('plays') }))
vi.mock('@/lib/core-app/seasonPhase', () => ({ hasRegularSeasonStarted: held('regularSeason') }))
/*
 * The trades read reports as it lands, the way the real one does — including the part the real one
 * couples: offers are only reported when there is a Sleeper identity to scan for, while an
 * incompleteness report needs no identity at all (its commonest cause is the grade-cache read,
 * which runs for every account).
 */
vi.mock('@/lib/core-app/recentTrades', () => ({
  getRecentTrades: vi.fn(
    (
      _leagues: unknown,
      _now: unknown,
      _limit: unknown,
      options?: {
        ownerSleeperId?: string | null
        onPendingOffers?: (scanned: Array<{ leagueId: string; waiting: number }>) => void
        onIncomplete?: (reason: string) => void
      },
    ) => {
      g.calls.set('trades', (g.calls.get('trades') ?? 0) + 1)
      return g.gate('trades').promise.then((value) => {
        if (g.scan.incomplete) options?.onIncomplete?.(g.scan.incomplete)
        if (options?.ownerSleeperId) options.onPendingOffers?.(g.scan.scanned)
        return value
      })
    },
  ),
}))
vi.mock('@/lib/core-app/sinceLastVisit', () => ({ getSinceLastVisit: held('brief') }))
vi.mock('@/lib/core-app/matchup', () => ({ getMatchupData: held('matchup') }))
vi.mock('@/lib/core-app/draftHqAll', () => ({ getDraftHqAll: held('drafts') }))
vi.mock('@/lib/decision-os/userOs', () => ({ resolveUserOsSnapshot: held('userOs') }))
vi.mock('@/lib/core-app/urgencyBadges', () => ({ getUrgencyBadges: held('urgency'), recordPendingOffers: held('offersWrite') }))
vi.mock('@/lib/analytics/recordDashboardActivation', () => ({ recordDashboardActivation: vi.fn(async () => undefined) }))
// The league home — its loader failing is case 6.
vi.mock('@/lib/core-app/leagueHome', () => ({ getLeagueHomeData: vi.fn(async () => g.leagueHome.data) }))
// A non-home screen for the badges case.
vi.mock('@/lib/core-app/trades', () => ({ getTradesData: vi.fn(async () => null) }))
vi.mock('@/lib/core-app/crossLeagueValueActions', () => ({ getCrossLeagueValueActions: vi.fn(async () => []) }))

type AnyElement = ReactElement<Record<string, unknown>>

/** Every element matching `match`, walking children, element props and plain-object props (slots). */
function findAll(node: unknown, match: (el: AnyElement) => boolean, into: AnyElement[] = []): AnyElement[] {
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, match, into)
    return into
  }
  if (isValidElement(node)) {
    const el = node as AnyElement
    if (match(el)) into.push(el)
    for (const value of Object.values(el.props ?? {})) findAll(value, match, into)
    return into
  }
  if (node && typeof node === 'object' && !(node instanceof Promise) && !(node instanceof Date)) {
    for (const value of Object.values(node)) if (isValidElement(value) || Array.isArray(value)) findAll(value, match, into)
  }
  return into
}

/** Resolves to the value, or 'pending' if it has not settled within `ms`. */
async function within<T>(promise: Promise<T>, ms = 1_500): Promise<T | 'pending'> {
  return Promise.race([promise, new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), ms))])
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const render = (el: AnyElement) => (el.type as (props: unknown) => Promise<AnyElement | null>)(el.props)

const pageArgs = (screen: string[], searchParams: Record<string, string>) => ({
  params: Promise.resolve({ screen }),
  searchParams: Promise.resolve(searchParams),
})

async function screenBody(screen: string[], searchParams: Record<string, string>, key: string) {
  const AfCorePage = (await import('@/app/core/[[...screen]]/page')).default
  const tree = await AfCorePage(pageArgs(screen, searchParams))
  const boundary = findAll(tree, (el) => el.type === Suspense && el.key === key)[0]
  expect(boundary, `the screen boundary ${key}`).toBeTruthy()
  return boundary.props.children as AnyElement
}

const homeBody = () => screenBody([], {}, '|')

/** The rendered home body, plus CoreHomeCards rendered: card name -> the async card element. */
async function homeCards() {
  const bodyTree = await render(await homeBody())
  const home = findAll(bodyTree, (el) => typeof el.props?.loads === 'object' && el.props?.resetKey !== undefined)[0]
  expect(home, 'CoreHomeCards in the home body').toBeTruthy()
  const cardsTree = (home.type as (props: unknown) => AnyElement)(home.props)
  const boundaries = findAll(cardsTree, (el) => typeof el.props?.card === 'string' && typeof el.props?.resetKey === 'string')
  const cards = new Map<string, AnyElement>()
  for (const boundary of boundaries) {
    const suspense = boundary.props.children as AnyElement
    expect(suspense.type, `card ${String(boundary.props.card)} streams behind a Suspense`).toBe(Suspense)
    cards.set(String(boundary.props.card), suspense.props.children as AnyElement)
  }
  const signals = findAll(bodyTree, (el) => el.props?.urgencyBadges instanceof Promise)[0]
  return { cards, signals }
}

const SUMMARY = { leagues: [], allLeagues: [], totalLeagues: 1, weekLabel: 'Week 3', book: [], valueBasis: null, coverage: [] }

beforeEach(() => {
  g.gates.clear()
  g.calls.clear()
  // The loader mocks live for the whole file; their recorded arguments must not leak between tests.
  for (const fn of g.fns.values()) fn.mockClear()
  // The per-test knobs, back to the defaults every other case assumes.
  g.scan.scanned = []
  g.scan.incomplete = null
  g.account.sleeperUserId = 's1'
  g.account.leagues = null
  g.leagueHome.data = null
})

afterEach(() => {
  // Open everything so no page promise outlives its test.
  for (const gate of g.gates.values()) gate.open(null)
})

describe('/core home cards stream independently', () => {
  it('returns the home while every read is pending — with the independent reads already started', { timeout: 180_000 }, async () => {
    const body = await homeBody()
    const outcome = await within(render(body).then(() => 'resolved'), 20_000)
    expect(outcome, 'the home body waited for a card read').toBe('resolved')

    for (const name of ['dash34', 'tradeWeek', 'week', 'schedule', 'career', 'exposure', 'rivals', 'following', 'strip', 'plays', 'regularSeason', 'drafts']) {
      expect(called(name), `${name} should start at once`).toBe(1)
    }
    // Each of these needs another read first; none may start before it lands, or be started twice.
    for (const name of ['trades', 'receipts', 'routineFacts', 'brief', 'userOs', 'urgency', 'matchup']) {
      expect(called(name), `${name} started before the read it needs`).toBe(0)
    }
  })

  it('puts every card behind its own boundary', { timeout: 180_000 }, async () => {
    const { cards } = await homeCards()
    expect([...cards.keys()]).toEqual([
      // The decision queue leads the home (2026-09-16) — ahead of every band.
      'issues',
      'since-last-visit',
      'game-day',
      'drafts',
      'triage',
      'trade-band',
      'carryover',
      'user-os',
      'schedule',
      'routine',
      'matchups',
      'chimmy',
      'career',
      'rivals',
      'portfolio-chart',
      'exposure',
      'following',
      'receipts',
      'leagues',
      'coverage',
    ])
  })

  it('lets each card through as soon as its own reads land, and holds the rest', { timeout: 180_000 }, async () => {
    const { cards } = await homeCards()
    const career = render(cards.get('career')!)
    const issues = render(cards.get('issues')!)
    const matchups = render(cards.get('matchups')!)

    expect(await within(career, 100)).toBe('pending')
    g.gate('career').open({ marker: 'career' })
    const careerCard = (await within(career)) as AnyElement
    expect(careerCard, 'career renders once its read lands').not.toBe('pending')
    expect(careerCard.props.career).toEqual({ marker: 'career' })

    // The summary is still held: issues and matchups must still be waiting.
    expect(await within(issues, 100)).toBe('pending')
    g.gate('dash34').open(SUMMARY)
    const issuesCard = (await within(issues)) as AnyElement
    expect(issuesCard).not.toBe('pending')
    expect(Array.isArray(issuesCard.props.issues)).toBe(true)

    // Matchups also needs the week, and then the win probability priced for the scored league.
    expect(await within(matchups, 100)).toBe('pending')
    g.gate('week').open({ rows: [] })
    await tick()
    expect(called('matchup'), 'win probability prices the scored league once the week lands').toBe(1)
    expect(await within(matchups, 100)).toBe('pending')
    g.gate('matchup').open(null)
    const matchupsCard = (await within(matchups)) as AnyElement
    expect(matchupsCard).not.toBe('pending')
    expect(matchupsCard.props.weekLabel).toBe('Week 3')
    // Across the client boundary goes the league list, never the whole summary.
    expect(matchupsCard.props).not.toHaveProperty('data')
    expect(matchupsCard.props.leagues).toEqual([])
  })

  it.each([
    ['comes back empty', (gate: { open: (v: unknown) => void }) => gate.open(null)],
    ['rejects', (gate: { fail: (e: unknown) => void }) => gate.fail(new Error('summary read failed'))],
  ])('keeps the honest panel when the summary read %s, and nothing else claims emptiness', { timeout: 180_000 }, async (_label, settle) => {
    const { cards, signals } = await homeCards()
    settle(g.gate('dash34'))
    g.gate('week').open(null)
    g.gate('career').open({ marker: 'career' })

    const issues = (await within(render(cards.get('issues')!))) as AnyElement
    expect(JSON.stringify(issues.props)).toContain('We could not read your leagues just now')

    for (const name of ['chimmy', 'leagues', 'portfolio-chart', 'matchups', 'triage']) {
      expect(await within(render(cards.get(name)!)), `${name} rendered without the summary`).toBeNull()
    }
    // A card with its own read is not hidden by the summary's failure.
    const career = (await within(render(cards.get('career')!))) as AnyElement
    expect(career.props.career).toEqual({ marker: 'career' })

    // The shell's signals still settle — a failed summary must not reach the screen's boundary.
    g.gate('tradeWeek').open(null)
    g.gate('trades').open([])
    g.gate('offersWrite').open(undefined)
    g.gate('urgency').open(null)
    const published = (await within(render(signals))) as AnyElement
    expect(published, 'the shell signals settled').not.toBe('pending')
    expect(published.props.weekLabel).toBeNull()
  })

  it('makes the home badges wait for the pending-offers write, not just the summary', { timeout: 180_000 }, async () => {
    await render(await homeBody())
    g.gate('dash34').open(SUMMARY)
    await tick()
    expect(called('urgency'), 'badges ran before the trade scan').toBe(0)

    g.gate('tradeWeek').open(3)
    await tick()
    g.gate('trades').open([])
    await tick()
    expect(called('offersWrite'), 'the scan reported its pending offers').toBe(1)
    expect(called('urgency'), 'badges ran while the offers write was still in flight').toBe(0)

    g.gate('offersWrite').open(undefined)
    await tick()
    await tick()
    expect(called('urgency')).toBe(1)
  })

  /*
   * The other half of that rule, and the reason it is not simply "always wait". Without a Sleeper
   * identity the scan reports nothing and writes nothing, so chaining the badges behind the trades
   * read would put the slowest read on the page in front of the tab counts for no reason at all.
   */
  it('does not make the badges wait for a pending-offers write that is never coming', { timeout: 180_000 }, async () => {
    g.account.sleeperUserId = null
    await render(await homeBody())
    g.gate('dash34').open(SUMMARY)
    await tick()
    await tick()
    expect(called('urgency'), 'badges waited on a trade scan that writes nothing').toBe(1)
    expect(called('offersWrite'), 'no identity, so nothing to record').toBe(0)
    // The trades read is still in flight — the point is that the badges did not wait for it.
    expect(called('trades')).toBe(0)
  })

  it.each([
    ['lands complete', (gate: { open: (v: unknown) => void; fail: (e: unknown) => void }) => gate.open([]), null, true],
    ['fails outright', (gate: { open: (v: unknown) => void; fail: (e: unknown) => void }) => gate.fail(new Error('scan failed')), null, false],
    /*
     * 🛑 THE ONES A REJECTION CHECK MISSES, AND THEY ARE THE COMMON CASE. Every source inside the
     * read degrades instead of throwing, so it RESOLVES with trades simply absent: the grade cache
     * — the primary source, and the only one that runs without a Sleeper identity — falls back to
     * `[]`; a league's scan catches its own failure; a scan that answered one of three weeks still
     * reports success. Closing the trade boundary on any of those loses those trades from every
     * future brief.
     */
    ['cannot read the grade cache', (gate: { open: (v: unknown) => void; fail: (e: unknown) => void }) => gate.open([]), 'grade-cache-unreadable', false],
    ['has a league that never answered', (gate: { open: (v: unknown) => void; fail: (e: unknown) => void }) => gate.open([]), 'league-scan-unanswered', false],
    ['has a scan missing weeks', (gate: { open: (v: unknown) => void; fail: (e: unknown) => void }) => gate.open([]), 'league-scan-partial-weeks', false],
  ])('reports the trades read to the brief when it %s', { timeout: 180_000 }, async (_label, settle, incomplete, tradesComplete) => {
    g.scan.incomplete = incomplete
    await render(await homeBody())
    g.gate('tradeWeek').open(3)
    await tick()
    settle(g.gate('trades'))
    await tick()
    await tick()
    expect(called('brief')).toBe(1)
    /*
     * ⚠ AND THE VISIT ITSELF MOVES EITHER WAY. Holding the whole marker back would freeze the
     * standings and injury baselines — which this read got right — over a trade problem.
     */
    expect(g.fns.get('brief')!.mock.calls[0][0]).toMatchObject({ recordVisit: true, tradesComplete })
  })

  /*
   * A scoped home (lib/core-app/homeScope.ts) reads only the leagues in scope — and must not write
   * whole-portfolio state from that partial read: the "since your last visit" marker's baselines, and
   * the tab badges' lineup cache. The badges themselves still count every league.
   */
  it('scopes every home read to the chosen leagues, and writes no whole-portfolio state from them', { timeout: 180_000 }, async () => {
    const ESPN = { ...LEAGUE, id: 'L2', name: 'Hoops', platform: 'espn', sport: 'NBA', platformLeagueId: 'p2' }
    g.account.leagues = [LEAGUE, ESPN]
    const ids = (list: unknown) => (list as Array<{ id: string }>).map((l) => l.id)

    await render(await screenBody([], { scope: 'platform:espn' }, '|'))
    expect(ids(g.fns.get('dash34')!.mock.calls[0][1])).toEqual(['L2'])
    expect(ids(g.fns.get('week')!.mock.calls[0][1])).toEqual(['L2'])
    expect(ids(g.fns.get('schedule')!.mock.calls[0][1])).toEqual(['L2'])
    expect(g.fns.get('exposure')!.mock.calls[0][1]).toEqual(['L2'])
    expect(g.fns.get('rivals')!.mock.calls[0][1]).toEqual(['L2'])
    expect(ids(g.fns.get('drafts')!.mock.calls[0][1])).toEqual(['L2'])

    g.gate('tradeWeek').open(3)
    await tick()
    g.gate('trades').open([])
    await tick()
    await tick()
    expect(g.fns.get('brief')!.mock.calls[0][0]).toMatchObject({ recordVisit: false })
    expect(ids((g.fns.get('brief')!.mock.calls[0][0] as { leagues: unknown }).leagues)).toEqual(['L2'])

    g.gate('dash34').open({ ...SUMMARY, allLeagues: [{ id: 'L2', emptyStarters: 1 }] })
    g.gate('offersWrite').open(undefined)
    for (let i = 0; i < 4; i += 1) await tick()
    expect(called('urgency')).toBe(1)
    const badges = g.fns.get('urgency')!.mock.calls[0][0] as { leagues: unknown; lineupLeagues: unknown }
    expect(badges.lineupLeagues, 'a scoped summary refreshed the whole-portfolio lineup cache').toBeNull()
    expect(ids(badges.leagues).sort(), 'the badges count every league, not the scope').toEqual(['L1', 'L2'])
  })

  it('reads nothing at all for a scope that matches no league', { timeout: 180_000 }, async () => {
    // LEAGUE is NFL; nothing is NBA.
    const bodyTree = await render(await screenBody([], { scope: 'sport:NBA' }, '|'))
    await tick()
    for (const name of ['dash34', 'tradeWeek', 'trades', 'week', 'schedule', 'career', 'exposure', 'rivals', 'following', 'receipts', 'routineFacts', 'strip', 'plays', 'regularSeason', 'drafts', 'brief', 'userOs', 'matchup']) {
      expect(called(name), `${name} ran for an empty scope`).toBe(0)
    }
    const home = findAll(bodyTree, (el) => typeof el.props?.loads === 'object' && el.props?.resetKey !== undefined)[0]
    expect((home.props.scope as { count: number; scoped: boolean }).count).toBe(0)
  })

  // The positive control for the case above: unscoped, the same reads see every league.
  it('reads every league, moves the visit and refreshes the lineup cache when the home is not scoped', { timeout: 180_000 }, async () => {
    g.account.leagues = [LEAGUE, { ...LEAGUE, id: 'L2', name: 'Hoops', platform: 'espn', sport: 'NBA', platformLeagueId: 'p2' }]
    const ids = (list: unknown) => (list as Array<{ id: string }>).map((l) => l.id).sort()

    await render(await homeBody())
    expect(ids(g.fns.get('dash34')!.mock.calls[0][1])).toEqual(['L1', 'L2'])
    g.gate('tradeWeek').open(3)
    await tick()
    g.gate('trades').open([])
    await tick()
    await tick()
    expect(g.fns.get('brief')!.mock.calls[0][0]).toMatchObject({ recordVisit: true })

    const allLeagues = [{ id: 'L2', emptyStarters: 1 }]
    g.gate('dash34').open({ ...SUMMARY, allLeagues })
    g.gate('offersWrite').open(undefined)
    for (let i = 0; i < 4; i += 1) await tick()
    expect((g.fns.get('urgency')!.mock.calls[0][0] as { lineupLeagues: unknown }).lineupLeagues).toEqual(allLeagues)
  })

  it('never makes a screen wait for its tab badges', { timeout: 180_000 }, async () => {
    const body = await screenBody(['trades'], { league: 'L1' }, 'trades|L1')
    const outcome = await within(render(body).then(() => 'resolved'), 20_000)
    expect(outcome, 'the trades screen waited for its badges').toBe('resolved')
    // Positive control: the badges read did start — it just did not hold the screen.
    await tick()
    expect(called('urgency')).toBe(1)
  })

  it('shows the failure panel, not a blank screen, when a league home cannot be read', { timeout: 180_000 }, async () => {
    const body = await screenBody([], { league: 'L1' }, '|L1')
    const tree = await render(body)
    const panels = JSON.stringify(findAll(tree, (el) => el.type === 'div' && el.props?.className === 'af-frame').map((el) => el.props))
    expect(panels).toContain('We could not read this league just now')
    // It names the league it failed to read, and says the OTHERS are fine — the rail beside this
    // panel is showing them, so the account-wide copy this branch first reused contradicted the page.
    expect(panels).toContain('Ice Kings')
    expect(panels).toContain('your other leagues are unaffected')
    expect(panels).not.toContain('We could not read your leagues just now')
    expect(findAll(tree, (el) => typeof el.props?.loads === 'object')).toHaveLength(0)
  })

  /*
   * The positive control for the case above. `getLeagueHomeData` is mocked null for every other
   * test in this file, so without this the panel assertion would pass with the league branch
   * deleted entirely — it would be asserting about the only outcome the mock can produce.
   */
  it('renders the league screen, not the failure panel, when that league home did load', { timeout: 180_000 }, async () => {
    g.leagueHome.data = { league: { id: 'L1', name: 'Ice Kings' } }
    const body = await screenBody([], { league: 'L1' }, '|L1')
    const tree = await render(body)
    const league = findAll(tree, (el) => (el.props?.data as { league?: { id?: string } } | undefined)?.league?.id === 'L1')
    expect(league, 'the league home rendered').toHaveLength(1)
    expect(JSON.stringify(findAll(tree, (el) => el.type === 'div' && el.props?.className === 'af-frame').map((el) => el.props))).not.toContain(
      'We could not read this league just now',
    )
  })
})
