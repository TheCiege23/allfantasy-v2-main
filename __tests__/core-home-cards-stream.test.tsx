// @vitest-environment node
import { Suspense, isValidElement, type ReactElement, type ReactNode } from 'react'
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
 *   3. With the summary read failed, the honest "could not read your leagues" panel still stands
 *      in the issues card, and no card that depends on the summary claims emptiness.
 *   4. No screen waits for its tab badges.
 */

const g = vi.hoisted(() => {
  type Gate = { promise: Promise<unknown>; open: (value: unknown) => void }
  const gates = new Map<string, Gate>()
  const calls = new Map<string, number>()
  const gate = (name: string): Gate => {
    let existing = gates.get(name)
    if (!existing) {
      let open!: (value: unknown) => void
      const promise = new Promise<unknown>((resolve) => {
        open = resolve
      })
      existing = { promise, open }
      gates.set(name, existing)
    }
    return existing
  }
  return { gates, calls, gate }
})

/** A loader that records its call and resolves only when its gate is opened. */
function held(name: string) {
  return vi.fn(() => {
    g.calls.set(name, (g.calls.get(name) ?? 0) + 1)
    return g.gate(name).promise
  })
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
  getDashboardLeagueListForUser: vi.fn(async () => ({ leagues: [LEAGUE], sleeperUserId: 's1' })),
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
vi.mock('@/lib/core-app/weekAll', () => ({ getWeekAll: held('week'), scoredMatchupLeagueIds: vi.fn(() => []) }))
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
vi.mock('@/lib/core-app/recentTrades', () => ({ getRecentTrades: held('trades') }))
vi.mock('@/lib/core-app/sinceLastVisit', () => ({ getSinceLastVisit: held('brief') }))
vi.mock('@/lib/core-app/matchup', () => ({ getMatchupData: held('matchup') }))
vi.mock('@/lib/core-app/draftHqAll', () => ({ getDraftHqAll: held('drafts') }))
vi.mock('@/lib/decision-os/userOs', () => ({ resolveUserOsSnapshot: held('userOs') }))
vi.mock('@/lib/core-app/urgencyBadges', () => ({ getUrgencyBadges: held('urgency'), recordPendingOffers: vi.fn(async () => undefined) }))
vi.mock('@/lib/analytics/recordDashboardActivation', () => ({ recordDashboardActivation: vi.fn(async () => undefined) }))
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

const render = (el: AnyElement) => (el.type as (props: unknown) => Promise<AnyElement | null>)(el.props)

const pageArgs = (screen: string[], searchParams: Record<string, string>) => ({
  params: Promise.resolve({ screen }),
  searchParams: Promise.resolve(searchParams),
})

async function homeBody() {
  const AfCorePage = (await import('@/app/core/[[...screen]]/page')).default
  const tree = await AfCorePage(pageArgs([], {}))
  const boundary = findAll(tree, (el) => el.type === Suspense && el.key === '|')[0]
  expect(boundary, 'the home screen boundary').toBeTruthy()
  return boundary.props.children as AnyElement
}

/** The home body rendered, then CoreHomeCards rendered: card name -> the async card element. */
async function homeCards() {
  const body = await homeBody()
  const bodyTree = await render(body)
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
  return cards
}

const SUMMARY = { leagues: [], allLeagues: [], totalLeagues: 1, weekLabel: 'Week 3', book: [], valueBasis: null, coverage: [] }

beforeEach(() => {
  g.gates.clear()
  g.calls.clear()
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
    const cards = await homeCards()
    expect([...cards.keys()]).toEqual([
      'since-last-visit',
      'game-day',
      'drafts',
      'triage',
      'trade-band',
      'carryover',
      'user-os',
      'schedule',
      'routine',
      'issues',
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
    const cards = await homeCards()
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

    // Matchups also needs the week (and the win probabilities that follow it).
    expect(await within(matchups, 100)).toBe('pending')
    g.gate('week').open({ rows: [] })
    const matchupsCard = (await within(matchups)) as AnyElement
    expect(matchupsCard).not.toBe('pending')
    expect(matchupsCard.props.weekLabel).toBe('Week 3')
  })

  it('keeps the honest panel when the summary read fails, and no summary card claims emptiness', { timeout: 180_000 }, async () => {
    const cards = await homeCards()
    g.gate('dash34').open(null)
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
  })

  it('never makes a screen wait for its tab badges', { timeout: 180_000 }, async () => {
    const AfCorePage = (await import('@/app/core/[[...screen]]/page')).default
    const tree = await AfCorePage(pageArgs(['trades'], { league: 'L1' }))
    const boundary = findAll(tree, (el) => el.type === Suspense && el.key === 'trades|L1')[0]
    const body = boundary.props.children as AnyElement

    const outcome = await within(render(body).then(() => 'resolved'), 20_000)
    expect(outcome, 'the trades screen waited for its badges').toBe('resolved')
    // Positive control: the badges read did start — it just did not hold the screen.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(called('urgency')).toBe(1)
  })
})
