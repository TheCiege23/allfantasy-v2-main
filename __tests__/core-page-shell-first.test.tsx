// @vitest-environment node
import { Suspense, isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * /core renders its shell first and streams the screen behind it.
 *
 * 🛑 THE REGRESSION THIS EXISTS FOR IS ONE LINE LONG. Nothing about streaming is enforced by the
 * framework: add one `await getSomeScreenData()` back into `AfCorePage` and the page silently
 * returns to painting nothing until that read finishes — every test, typecheck and screen still
 * green. So this suite asserts the properties by running the page function:
 *
 *   1. No screen loader is called while the page function resolves.
 *   2. The screen is inside a Suspense boundary keyed on screen + league.
 *   3. The shell's reads START TOGETHER — all of them before any has resolved. A re-serialised
 *      chain (await one, then the next) fails this, which a source search could not see.
 *   4. The page resolves while the league's Decision OS read is still pending, and the two
 *      context-bar slots that wait on it are keyed on the league (a rail switch between leagues
 *      updates the page in place; an unkeyed slot would hold the whole navigation).
 *   5. The error boundary resets on any URL change, while the screen boundary survives a
 *      same-screen query change.
 *
 * ⚠ EACH NEGATIVE HAS ITS POSITIVE. The "not called" assertions are only evidence if the same
 * spies DO record calls when the screen body actually runs — so the body the page returns is
 * executed here too, and must call the trades loader. The "does not wait" assertion is only
 * evidence because the read it does not wait on is proven to have been called.
 */

const h = vi.hoisted(() => {
  type Deferred = { promise: Promise<void>; resolve: () => void }
  const makeGate = (): Deferred => {
    let resolve!: () => void
    const promise = new Promise<void>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }
  // `osGate` holds the league's Decision OS read, which only the context bar's streamed slots may wait on.
  return { gate: makeGate(), osGate: makeGate(), makeGate, gated: true }
})

/** Resolves `value`, but only after the shared gate opens when gating is on. */
function gatedValue<T>(value: T) {
  return vi.fn(async () => {
    if (h.gated) await h.gate.promise
    return value
  })
}

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

const shell = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>)
const screens = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>)
const os = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>)

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

vi.mock('@/lib/core-app/coreActivity', () => ({
  getCoreActivitySnapshot: (shell.coreActivity = gatedValue({ gameDayActive: false, liveGameCount: 0, draftLive: false, liveDraftLeagueIds: [] })),
}))
vi.mock('@/lib/core-app/leagueDataSignals', () => ({ getLeagueDataSignals: (shell.dataSignals = gatedValue({ hasScoredWeek: true })) }))
vi.mock('@/lib/values/valueSurfaceEligibility', () => ({ resolveLeagueValueSurfaces: (shell.valueSurfaces = gatedValue({ hasIdp: false })) }))
vi.mock('@/lib/core-app/devy', () => ({
  leagueDevyNav: (shell.devyNav = gatedValue({ devySlotCount: 0, devyFormat: false })),
  looksLikeDevyFormat: () => false,
  NO_DEVY_NAV: { devySlotCount: 0, devyFormat: false },
  getDevyCoreData: vi.fn(async () => null),
}))
vi.mock('@/lib/adminAuth', () => ({ getAdminAccessState: (shell.admin = gatedValue({ status: 'denied' })) }))
vi.mock('@/lib/chat-core/unreadCounts', () => ({ getChatUnread: (shell.chatUnread = gatedValue({ total: 0, mentions: 0 })) }))
vi.mock('@/lib/core-app/railMatchups', () => ({ getRailMatchups: (shell.railMatchups = gatedValue(null)) }))
vi.mock('@/lib/ai-access/AIAccessResolver', () => ({
  aiAccessResolver: { resolveForUser: (shell.access = gatedValue(null)) },
}))
vi.mock('@/lib/decision-os/userOs', () => ({
  resolveUserOsSnapshot: (os.snapshot = vi.fn(async () => {
    await h.osGate.promise
    return null
  })),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformNotification: { count: (shell.notificationCount = gatedValue(0)) },
    appUser: { findUnique: (shell.appUser = gatedValue(null)) },
    league: { findUnique: (shell.leagueCoverage = gatedValue({ settings: {}, platform: 'sleeper' })) },
  },
}))

// Screen loaders: the spies whose silence during the page function is the whole point.
vi.mock('@/lib/core-app/trades', () => ({ getTradesData: (screens.trades = vi.fn(async () => null)) }))
vi.mock('@/lib/core-app/dash34', () => ({ getDash34Data: (screens.dash34 = vi.fn(async () => null)), imageOf: () => null }))
vi.mock('@/lib/core-app/urgencyBadges', () => ({
  getUrgencyBadges: (screens.urgency = vi.fn(async () => null)),
  recordPendingOffers: vi.fn(async () => undefined),
}))
vi.mock('@/lib/core-app/myTeam', () => ({ getMyTeamData: (screens.myTeam = vi.fn(async () => null)) }))
vi.mock('@/lib/core-app/seasonOutlook', () => ({ getSeasonOutlook: (screens.outlook = vi.fn(async () => null)) }))
vi.mock('@/lib/core-app/weekBoard', () => ({
  getWeekBoard: (screens.weekBoard = vi.fn(async () => null)),
  getRivalryRadar: vi.fn(async () => null),
}))
vi.mock('@/lib/core-app/leagueHome', () => ({ getLeagueHomeData: (screens.leagueHome = vi.fn(async () => null)) }))
vi.mock('@/lib/core-app/crossLeagueValueActions', () => ({ getCrossLeagueValueActions: vi.fn(async () => []) }))

type AnyElement = ReactElement<Record<string, unknown>>

/** Every element in the tree matching `match`, including elements passed as props (slots). */
function findAll(node: ReactNode, match: (el: AnyElement) => boolean, into: AnyElement[] = []): AnyElement[] {
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, match, into)
    return into
  }
  if (!isValidElement(node)) return into
  const el = node as AnyElement
  if (match(el)) into.push(el)
  for (const value of Object.values(el.props ?? {})) {
    if (isValidElement(value) || Array.isArray(value)) findAll(value as ReactNode, match, into)
  }
  return into
}

function findElement(node: ReactNode, match: (el: AnyElement) => boolean): AnyElement | null {
  return findAll(node, match)[0] ?? null
}

async function loadPage() {
  return (await import('@/app/core/(shell)/[[...screen]]/page')).default
}

const pageArgs = (screen: string[], searchParams: Record<string, string>) => ({
  params: Promise.resolve({ screen }),
  searchParams: Promise.resolve(searchParams),
})

beforeEach(() => {
  h.gate = h.makeGate()
  h.osGate = h.makeGate()
  h.gated = true
  for (const spy of [...Object.values(shell), ...Object.values(screens), ...Object.values(os)]) spy.mockClear()
})

afterEach(() => {
  // Never leave a page's streamed read hanging past its test.
  h.gate.resolve()
  h.osGate.resolve()
})

describe('/core renders the shell first', () => {
  it('starts every shell read before any of them has resolved', { timeout: 180_000 }, async () => {
    const AfCorePage = await loadPage()
    const pending = AfCorePage(pageArgs(['trades'], { league: 'L1' }))

    // Let the page get past the session and the league list, and into the shell reads.
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0))

    const notStarted = Object.entries(shell).filter(([, spy]) => spy.mock.calls.length === 0).map(([name]) => name)
    expect(notStarted, 'shell reads that had not started while the others were still pending').toEqual([])

    h.gate.resolve()
    await pending
  })

  /*
   * 🛑 THE SELECTED LEAGUE'S ROW IS READ ONCE PER RENDER, AND NOTHING ELSE ENFORCES IT.
   * Two shell reads each used to fetch it — `resolveLeagueValueSurfaces` wanted
   * `{id, settings}` and the import-coverage summary wanted `{settings, platform}` — so one
   * render issued the same query twice. Both sit in the same `Promise.all`, so they were
   * concurrent and no reordering could collapse them; the row is now resolved once and
   * handed to both.
   *
   * ⚠ THE COST OF GETTING THIS WRONG IS NOT THE QUERY, IT IS DISAGREEMENT. Two reads of one
   * row inside one render can straddle a settings write, and the nav gate would then be
   * deciding which tabs to show from different bytes than the banner explaining why they
   * are missing.
   *
   * ⚠ AND THE OBVIOUS FIX RE-SERIALISES THE SHELL. Passing the ROW (`sharedRead.then(row =>
   * resolve(…, row))`) delays the CALL until the read lands, which the test above catches —
   * it did, on the first attempt. The resolver takes the PROMISE and awaits it itself.
   */
  it('reads the selected league row once, however many shell reads want it', { timeout: 180_000 }, async () => {
    const AfCorePage = await loadPage()
    const pending = AfCorePage(pageArgs(['trades'], { league: 'L1' }))
    h.gate.resolve()
    await pending

    expect(
      shell.leagueCoverage.mock.calls.length,
      'prisma.league.findUnique calls for the selected league in one render',
    ).toBe(1)

    /* Positive control: the one call is the shared read, asking for every field its
       consumers need — not a narrower read that happens to be alone. `platformLeagueId`,
       `syncStatus` and `lastSyncedAt` are the Overview's "what's on file" panel, which takes this
       row rather than reading it again; the rest are the screen loaders' (see below). */
    const { LEAGUE_CONTEXT_SELECT } = await import('@/lib/core-app/leagueContext')
    expect(shell.leagueCoverage).toHaveBeenCalledWith({ where: { id: 'L1' }, select: LEAGUE_CONTEXT_SELECT })
    expect(LEAGUE_CONTEXT_SELECT).toMatchObject({
      id: true,
      settings: true,
      platform: true,
      platformLeagueId: true,
      syncStatus: true,
      lastSyncedAt: true,
    })
  })

  /*
   * 🛑 AND THE SCREEN'S LOADER READS IT THROUGH THE SAME CONTEXT (item 3, "one shared league
   * context"). Loaders used to read the row again after the shell's wave had been awaited — one
   * more serial cross-coast round trip on every league tab, and up to five on Draft HQ.
   */
  it('hands the screen loader the context the shell read through, so its row costs no query', { timeout: 180_000 }, async () => {
    h.gated = false
    h.osGate.resolve()
    const AfCorePage = await loadPage()
    const tree = await AfCorePage(pageArgs(['trades'], { league: 'L1' }))
    const boundary = findElement(tree, (el) => el.type === Suspense && el.key === 'trades|L1')
    const body = boundary!.props.children as AnyElement
    await (body.type as (props: unknown) => Promise<unknown>)(body.props)

    const handed = screens.trades.mock.calls[0]?.[2] as
      | { leagueId: string; userId: string; league: () => Promise<unknown> }
      | undefined
    expect(handed, 'the trades loader was handed a league context').toBeTruthy()
    expect([handed!.leagueId, handed!.userId]).toEqual(['L1', 'u1'])

    const readsBefore = shell.leagueCoverage.mock.calls.length
    expect(readsBefore, 'the shell read the row').toBe(1)
    await expect(handed!.league()).resolves.toEqual({ settings: {}, platform: 'sleeper' })
    expect(shell.leagueCoverage.mock.calls.length, 'the loader re-read the row').toBe(readsBefore)
  })

  /*
   * ⚠ AND NO READ AT ALL WHEN THERE IS NO LEAGUE. The row is resolved beside the shell reads
   * rather than inside a screen, so an unscoped /core must not pay for it — the cross-league
   * home is the most-visited screen in the product.
   */
  it('reads no league row when no league is selected', { timeout: 180_000 }, async () => {
    const AfCorePage = await loadPage()
    const pending = AfCorePage(pageArgs([], {}))
    h.gate.resolve()
    await pending

    expect(shell.leagueCoverage).not.toHaveBeenCalled()
  })

  /*
   * 🛑 CHIMMY'S LEAGUE PICKER GETS EVERY LEAGUE (user report, 2026-09-16). It was capped at the first
   * twelve of a name-sorted list, so a league further down could not be picked at all.
   */
  it('hands the Chimmy drawer every played league, the selected one first', { timeout: 180_000 }, async () => {
    h.gated = false
    h.osGate.resolve()
    const { getDashboardLeagueListForUser } = await import('@/lib/dashboard/get-dashboard-league-list')
    const many = Array.from({ length: 15 }, (_, i) => ({ ...LEAGUE, id: `M${String(i).padStart(2, '0')}`, name: `League ${String(i).padStart(2, '0')}` }))
    vi.mocked(getDashboardLeagueListForUser).mockResolvedValue({ leagues: many, sleeperUserId: 's1' } as never)
    try {
      const AfCorePage = await loadPage()
      const commsOf = async (sp: Record<string, string>) => {
        const tree = await AfCorePage(pageArgs(['trades'], sp))
        const shellEl = findElement(tree, (el) => Array.isArray((el.props?.comms as { leagues?: unknown })?.leagues))
        return ((shellEl?.props.comms as { leagues: Array<{ id: string }> }).leagues ?? []).map((l) => l.id)
      }

      expect(await commsOf({})).toHaveLength(15)
      const scoped = await commsOf({ league: 'M13' })
      expect(scoped).toHaveLength(15)
      expect(scoped[0]).toBe('M13')
    } finally {
      vi.mocked(getDashboardLeagueListForUser).mockImplementation(async () => ({ leagues: [LEAGUE], sleeperUserId: 's1' }) as never)
    }
  })

  it('resolves without running a screen loader, and puts the screen in a keyed Suspense', { timeout: 180_000 }, async () => {
    h.gated = false
    const AfCorePage = await loadPage()
    const pending = AfCorePage(pageArgs(['trades'], { league: 'L1' }))

    // The Decision OS read is still held by `osGate`: the page must not be waiting for it.
    const outcome = await Promise.race([
      pending.then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('still waiting'), 20_000)),
    ])
    expect(outcome, 'the page waited for the league Decision OS read').toBe('resolved')
    expect(os.snapshot).toHaveBeenCalledWith('L1', 'u1')
    const tree = await pending

    const called = Object.entries(screens).filter(([, spy]) => spy.mock.calls.length > 0).map(([name]) => name)
    expect(called, 'screen loaders run before the shell could render').toEqual([])

    const boundary = findElement(tree, (el) => el.type === Suspense && el.key === 'trades|L1')
    expect(boundary, 'a Suspense boundary keyed on screen|league').not.toBeNull()

    // Both context-bar slots stream behind their own boundaries, keyed on the league.
    const slots = findAll(tree, (el) => el.type === Suspense && el.key === 'L1')
    expect(slots, 'context-bar slot boundaries keyed on the league').toHaveLength(2)

    const body = boundary!.props.children as AnyElement
    expect(typeof body.type).toBe('function')
    expect((body.props.ctx as { activeKey: string }).activeKey).toBe('trades')

    // Positive control: the same spies DO see calls once the streamed body actually runs.
    await (body.type as (props: unknown) => Promise<unknown>)(body.props)
    expect(screens.trades).toHaveBeenCalledWith('L1', 'u1', expect.objectContaining({ leagueId: 'L1', userId: 'u1' }))
    expect(screens.urgency).toHaveBeenCalled()
  })

  /*
   * 🛑 THE DEVY ENTRY FOLLOWS THE LEAGUE (user report, 2026-09-16: it showed for every league).
   * The page decides; the shell only renders what it is told — see devy-nav-gating.test.tsx.
   */
  it('tells the shell whether the selected league is a devy league, from the devy read', { timeout: 180_000 }, async () => {
    h.gated = false
    h.osGate.resolve()
    const AfCorePage = await loadPage()
    const shellOf = async () => {
      const tree = await AfCorePage(pageArgs(['trades'], { league: 'L1' }))
      return findElement(tree, (el) => typeof el.props?.devyInScope === 'boolean')
    }

    const plain = await shellOf()
    expect(plain, 'the shell element carries devyInScope').not.toBeNull()
    expect(plain!.props.devyInScope).toBe(false)
    expect(shell.devyNav).toHaveBeenCalledWith('L1', expect.anything())

    shell.devyNav.mockImplementationOnce(async () => ({ devySlotCount: 2, devyFormat: true }))
    const devy = await shellOf()
    expect(devy!.props.devyInScope).toBe(true)
    expect(devy!.props.devySlotCount).toBe(2)
  })

  it('resets the error boundary on any URL change, but keeps the screen boundary across a same-screen query', { timeout: 180_000 }, async () => {
    h.gated = false
    h.osGate.resolve()
    const AfCorePage = await loadPage()

    const read = async (searchParams: Record<string, string>) => {
      const tree = await AfCorePage(pageArgs(['trades'], searchParams))
      const suspense = findElement(tree, (el) => el.type === Suspense && String(el.key).startsWith('trades|'))
      const errorBoundary = findElement(tree, (el) => typeof el.props?.resetKey === 'string')
      return { suspenseKey: suspense?.key, resetKey: errorBoundary?.props.resetKey as string | undefined }
    }

    const plain = await read({ league: 'L1' })
    const withWeek = await read({ league: 'L1', week: '3' })
    const plainAgain = await read({ league: 'L1' })

    expect(plain.suspenseKey).toBe('trades|L1')
    expect(plain.resetKey, 'an error boundary with a reset key').toBeTruthy()
    expect(withWeek.suspenseKey).toBe(plain.suspenseKey)
    expect(withWeek.resetKey).not.toBe(plain.resetKey)
    // The SAME URL must keep the same key: anything volatile in it would reset the boundary on every
    // game-day refresh and re-report a failing screen every 20 seconds.
    expect(plainAgain.resetKey).toBe(plain.resetKey)
  })
})

/**
 * An unknown segment redirects to /core instead of rendering the whole home under the wrong URL.
 * Production, 2026-09-16: `/core/contact_support` ran every home card for 11.9s and was tagged
 * `af.screen: other`. The redirect must happen before the session read, so it costs nothing.
 */
describe('/core with an unknown segment', () => {
  const redirectTarget = async (run: Promise<unknown>): Promise<string | null> => {
    try {
      await run
      return null
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (!message.startsWith('NEXT_REDIRECT ')) throw e
      return message.slice('NEXT_REDIRECT '.length)
    }
  }

  beforeEach(async () => {
    const { getServerSession } = await import('next-auth')
    const { getDashboardLeagueListForUser } = await import('@/lib/dashboard/get-dashboard-league-list')
    vi.mocked(getServerSession).mockClear()
    vi.mocked(getDashboardLeagueListForUser).mockClear()
  })

  it('redirects to /core, keeping the query, before reading the session or any league', { timeout: 180_000 }, async () => {
    h.gated = false
    h.osGate.resolve()
    const AfCorePage = await loadPage()
    const { getServerSession } = await import('next-auth')
    const { getDashboardLeagueListForUser } = await import('@/lib/dashboard/get-dashboard-league-list')

    expect(await redirectTarget(AfCorePage(pageArgs(['contact_support'], { league: 'L1', week: '3' })))).toBe(
      '/core?league=L1&week=3',
    )
    expect(await redirectTarget(AfCorePage(pageArgs(['.env'], {})))).toBe('/core')
    expect(await redirectTarget(AfCorePage(pageArgs(['app', '.env'], {})))).toBe('/core')

    expect(getServerSession).not.toHaveBeenCalled()
    expect(getDashboardLeagueListForUser).not.toHaveBeenCalled()
    const called = [...Object.entries(shell), ...Object.entries(screens)].filter(([, spy]) => spy.mock.calls.length > 0)
    expect(called.map(([name]) => name), 'reads made for an unknown segment').toEqual([])
  })

  it('still renders known segments, dashboard-v2 and a differently cased one included', { timeout: 180_000 }, async () => {
    h.gated = false
    h.osGate.resolve()
    const AfCorePage = await loadPage()
    const { getServerSession } = await import('next-auth')

    expect(await redirectTarget(AfCorePage(pageArgs(['dashboard-v2'], {})))).toBeNull()
    expect(await redirectTarget(AfCorePage(pageArgs(['Trades'], { league: 'L1' })))).toBeNull()
    expect(await redirectTarget(AfCorePage(pageArgs([], {})))).toBeNull()
    // Positive control for the "before the session" assertion above: a known segment does read it.
    expect(getServerSession).toHaveBeenCalled()
  })
})

vi.mock('@/lib/core-app/attachLeagueHubs', () => ({ attachLeagueHubs: vi.fn(async () => {}) }))
