// @vitest-environment node
/**
 * The run budget on `/api/cron/import-news?xnews=1`.
 *
 * WHY THIS EXISTS. The job was unbounded and nobody noticed for the whole offseason, because
 * "unbounded" and "fast" look identical while there is nothing new to write. Measured across the
 * 40 scheduled runs GitHub still retains: every run under 70s reported `newRecords: 0`, every run
 * over 200s reported 32-38, the two populations do not overlap, and the switch happened within a
 * day of the NFL season starting on 2026-09-04. Four runs then died at the platform's 300s edge
 * ceiling with HTTP 502.
 *
 * 🛑 EVERY ASSERTION HERE IS WRITTEN TO GO RED IF THE GUARD IS REMOVED, and the exhausted-budget
 * cases are the ones that matter: an assertion that only ever sees a budget with time left would
 * pass with the whole feature deleted. CLAUDE.md's rule — make the check reproduce a known
 * positive before trusting its negative — is the reason the "does nothing" cases assert on the
 * provider call count rather than on the returned totals, which are zero either way.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const searchCalls: Array<{ query: string }> = []

// The provider. Counting calls is the only way to tell "the budget stopped us" from "the search
// happened and returned nothing" — both report fetched: 0.
vi.mock('@/lib/xai-client', () => ({
  xaiResponsesJson: vi.fn(async (opts: { messages: Array<{ content: string }> }) => {
    searchCalls.push({ query: opts.messages[0].content })
    return { ok: true, status: 200, json: {} }
  }),
  // No output text -> parseXNewsResponse is never reached, so a search contributes no items.
  // The budget behaviour under test is about whether the CALL happens at all.
  parseTextFromXaiResponse: () => '',
}))

const indexBuilds: string[] = []

vi.mock('@/lib/player-identity/resolveNewsPlayer', () => ({
  buildNewsPlayerIndex: async (sport: string) => {
    indexBuilds.push(sport)
    return { resolve: () => ({ playerId: null }) }
  },
}))

const updateManyCalls: Array<{ ids: string[] }> = []
const dispatchedRows: string[] = []

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerNewsRecord: {
      findMany: vi.fn(async () => newsRows),
      create: vi.fn(async () => ({})),
      updateMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => {
        updateManyCalls.push({ ids: args.where.id.in })
        return { count: args.where.id.in.length }
      }),
    },
    redraftRosterPlayer: {
      findMany: vi.fn(async () => [{ roster: { ownerId: 'u1', leagueId: 'l1' } }]),
    },
    injuryReportRecord: { upsert: vi.fn(async () => ({})) },
  },
}))

vi.mock('@/lib/notifications/NotificationDispatcher', () => ({
  dispatchNotification: vi.fn(async () => {
    dispatchedRows.push('sent')
  }),
}))

import { createRunBudget, rotateForFairness } from '@/lib/cron/runBudget'
import { runXNewsIngestion } from '@/lib/workers/x-news-ingestion'
import { dispatchPendingPlayerNewsNotifications } from '@/lib/notifications/PlayerNewsNotificationService'

/** NFL's entry in SPORT_SEARCH_QUERIES. Asserted below rather than assumed. */
const NFL_QUERY_COUNT = 4

let newsRows: Array<Record<string, unknown>> = []

/**
 * ONE clock, driving BOTH guards.
 *
 * 🛑 AN INJECTED-ONLY CLOCK CANNOT REACH HALF THE CODE, AND THAT IS HOW A BRANCH BECOMES
 * UNTESTABLE WHILE THE SUITE STAYS GREEN. `createRunBudget` accepts an injected `now`, but
 * `remainingFor` reads `Date.now()` directly and takes no injection point. A hand-rolled closure
 * therefore drives `exhausted()` while `remainingFor` still sees real wall-clock time, so the
 * deadline branch is never once exercised — it would sit in the diff looking covered.
 *
 * `vi.setSystemTime` moves the real `Date.now()`, so both see the same instant. The budget is
 * still constructed with the default `now` deliberately: injecting a second time source here
 * would reintroduce exactly the split this exists to remove.
 */
function clockAt(startMs = 1_700_000_000_000) {
  vi.useFakeTimers()
  vi.setSystemTime(startMs)
  let t = startMs
  return {
    advance: (ms: number) => {
      t += ms
      vi.setSystemTime(t)
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

/*
 * ⚠ IMPLEMENTATIONS RESET HERE, NOT JUST THE ARRAYS. Two tests below install a `mockImplementation`
 * that advances a clock belonging to THAT test's closure. Left in place, the next test runs against
 * a dead clock and passes or fails for a reason that has nothing to do with what it asserts —
 * order-dependent, and the kind of green that survives the guard being deleted.
 */
beforeEach(async () => {
  searchCalls.length = 0
  updateManyCalls.length = 0
  dispatchedRows.length = 0
  indexBuilds.length = 0
  newsRows = []

  const { xaiResponsesJson } = await import('@/lib/xai-client')
  ;(xaiResponsesJson as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (opts: { messages: Array<{ content: string }> }) => {
      searchCalls.push({ query: opts.messages[0].content })
      return { ok: true, status: 200, json: {} }
    },
  )

  const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
  ;(dispatchNotification as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    dispatchedRows.push('sent')
  })
})

describe('runXNewsIngestion — budget', () => {
  it('runs every query when the budget has room, and reports nothing deferred', async () => {
    clockAt()
    const budget = createRunBudget(240_000)

    const result = await runXNewsIngestion(['nfl'], budget)

    expect(searchCalls).toHaveLength(NFL_QUERY_COUNT)
    expect(result.deferredQueries).toBe(0)
  })

  it('is a no-op when the budget is already spent — the positive control', async () => {
    const clock = clockAt()
    const budget = createRunBudget(240_000)
    clock.advance(240_001)

    const result = await runXNewsIngestion(['nfl'], budget)

    // The load-bearing assertion. `fetched: 0` would hold with the guard deleted; zero PROVIDER
    // CALLS is what distinguishes "we stopped" from "we searched and found nothing".
    expect(searchCalls).toHaveLength(0)
    expect(result.deferredQueries).toBe(NFL_QUERY_COUNT)

    /*
     * ⚠ THIS PINS THE OUTER, PER-SPORT GUARD, WHICH THE PER-QUERY ONE OTHERWISE HIDES. Delete the
     * per-sport check and the per-query check still defers all four at i=0, so every assertion
     * above stays green and the branch becomes untestable dead code. Its one unique effect is
     * skipping the registry read, so that is what has to be asserted.
     */
    expect(indexBuilds).toHaveLength(0)
  })

  it('stops mid-sport and counts exactly the queries it did not reach', async () => {
    const clock = clockAt()
    const budget = createRunBudget(240_000)

    // Each query burns a third of the budget, so the third check is the one that trips.
    const { xaiResponsesJson } = await import('@/lib/xai-client')
    ;(xaiResponsesJson as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (opts: { messages: Array<{ content: string }> }) => {
      searchCalls.push({ query: opts.messages[0].content })
      clock.advance(90_000)
      return { ok: true, status: 200, json: {} }
    })

    const result = await runXNewsIngestion(['nfl'], budget)

    expect(searchCalls).toHaveLength(3)
    expect(result.deferredQueries).toBe(NFL_QUERY_COUNT - 3)
  })

  it('still runs unbudgeted, so every existing caller keeps working', async () => {
    clockAt()
    const result = await runXNewsIngestion(['nfl'])
    expect(searchCalls).toHaveLength(NFL_QUERY_COUNT)
    expect(result.deferredQueries).toBe(0)
  })

  /**
   * ⚠ THE `remainingFor` BRANCH, WHICH `exhausted()` CANNOT REACH. These are two different
   * guards and only one of them can fire here: with 500ms left the budget is NOT exhausted, so
   * `exhausted()` waves the query through, and the only thing standing between this run and a
   * search that outlives the request is the per-call deadline clamp. That gap — a unit admitted
   * with almost no time left — is the exact failure `import-players`, `import-schedules` and
   * `import-stat-lines` hit at the edge on 2026-09-07 with a budget already in place.
   */
  it('refuses to START a search that cannot finish, while the budget still reads healthy', async () => {
    const clock = clockAt()
    const budget = createRunBudget(240_000)
    clock.advance(239_500)

    expect(budget.exhausted()).toBe(false) // the guard that does NOT fire — pinned deliberately

    const result = await runXNewsIngestion(['nfl'], budget)

    expect(searchCalls).toHaveLength(0)
    expect(result.deferredQueries).toBe(NFL_QUERY_COUNT)
  })
})

describe('query rotation', () => {
  /**
   * ⚠ A BUDGET WITHOUT ROTATION STARVES THE TAIL, which is worse than the 502 it replaces
   * because it looks healthy. `lib/cron/runBudget.ts` records the measured case: four sports
   * frozen for months behind NFL in a fixed list.
   */
  it('gives a different query the lead in successive six-hour periods', () => {
    const SIX_H = 6 * 60 * 60 * 1000
    const queries = ['a', 'b', 'c', 'd']
    const lead = (periods: number) => rotateForFairness(queries, SIX_H, () => periods * SIX_H)[0]

    const leads = new Set([lead(0), lead(1), lead(2), lead(3)])
    expect(leads.size).toBe(queries.length)
  })
})

describe('dispatchPendingPlayerNewsNotifications — budget', () => {
  const row = (id: string) => ({
    id,
    sport: 'NFL',
    playerName: 'Ashton Jeanty',
    team: 'LV',
    headline: 'Ashton Jeanty ruled out with an ankle injury',
    body: 'ruled out',
    impact: 'high',
  })

  it('stamps every row it considered when the budget holds', async () => {
    newsRows = [row('r1'), row('r2'), row('r3')]
    clockAt()

    const result = await dispatchPendingPlayerNewsNotifications({
      budget: createRunBudget(240_000),
    })

    expect(result.scanned).toBe(3)
    expect(result.deferred).toBe(0)
    expect(updateManyCalls[0].ids).toEqual(['r1', 'r2', 'r3'])
  })

  it('🛑 NEVER STAMPS A ROW IT DID NOT LOOK AT', async () => {
    /*
     * The silent-corruption case, and the reason the budget check sits ABOVE `stamped.push`
     * rather than below it. `notificationDispatchedAt` means "considered"; a row stamped without
     * being considered is excluded from every future scan, so its notification is not delayed,
     * it is lost — with nothing red anywhere.
     */
    newsRows = [row('r1'), row('r2'), row('r3'), row('r4')]
    const clock = clockAt()
    const budget = createRunBudget(240_000)

    const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
    ;(dispatchNotification as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      dispatchedRows.push('sent')
      clock.advance(130_000)
    })

    const result = await dispatchPendingPlayerNewsNotifications({ budget })

    expect(result.scanned).toBe(2)
    expect(result.deferred).toBe(2)
    expect(updateManyCalls[0].ids).toEqual(['r1', 'r2'])
    expect(updateManyCalls[0].ids).not.toContain('r3')
    expect(updateManyCalls[0].ids).not.toContain('r4')
  })

  it('considers nothing and stamps nothing when the budget is already spent', async () => {
    newsRows = [row('r1'), row('r2')]
    const clock = clockAt()
    const budget = createRunBudget(240_000)
    clock.advance(240_001)

    const result = await dispatchPendingPlayerNewsNotifications({ budget })

    expect(result.scanned).toBe(0)
    expect(result.deferred).toBe(2)
    // No stamp write at all — not an empty one.
    expect(updateManyCalls).toHaveLength(0)
    expect(dispatchedRows).toHaveLength(0)
  })
})
