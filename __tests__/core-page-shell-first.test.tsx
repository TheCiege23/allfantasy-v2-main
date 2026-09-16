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
  leagueDevySlotCount: (shell.devySlots = gatedValue(0)),
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
  return (await import('@/app/core/[[...screen]]/page')).default
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
       consumers need — not a narrower read that happens to be alone. The last three are the
       Overview's "what's on file" panel, which takes this row rather than reading it again. */
    expect(shell.leagueCoverage).toHaveBeenCalledWith({
      where: { id: 'L1' },
      select: {
        id: true,
        settings: true,
        platform: true,
        platformLeagueId: true,
        syncStatus: true,
        lastSyncedAt: true,
      },
    })
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
    expect(screens.trades).toHaveBeenCalledWith('L1', 'u1')
    expect(screens.urgency).toHaveBeenCalled()
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
