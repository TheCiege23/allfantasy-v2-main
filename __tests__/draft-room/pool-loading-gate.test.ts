/**
 * DraftRoomPageClient — pool loading gate decoupling.
 *
 * Behaviors locked here:
 *
 *   1. fetchDraftPool is NOT in the blocking Promise.allSettled group —
 *      cold pool builds (60–90 s) no longer hold the loading spinner.
 *   2. fetchDraftPool still runs after mount via fire-and-forget void call
 *      inside bootstrapDraftRoom, after setLoading(false).
 *   3. poolLoading derives from poolFetching state, not the global loading flag —
 *      the player panel shows its own skeleton independently of the room spinner.
 *   4. poolFetching is initialized to true so the player panel shows a skeleton
 *      immediately on first paint (not an empty state that pops to data).
 *   5. fetchDraftPool sets poolFetching=false in a finally block — failed fetches
 *      clear the skeleton even when setDraftPool(null) is called.
 *   6. A failed pool fetch calls setDraftPool(null) but does not touch setSession —
 *      a valid draft session is never cleared by a pool error.
 *   7. A successful cached pool response calls setDraftPool with the entries.
 *
 * All assertions are source-level (readFileSync) — zero import cost, no DOM.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
const src = readFileSync(
  resolve(root, 'components/app/draft-room/DraftRoomPageClient.tsx'),
  'utf8',
)

// ---------------------------------------------------------------------------
// Behavior 1 — fetchDraftPool is NOT in the blocking Promise.allSettled group
// ---------------------------------------------------------------------------

describe('Behavior 1: fetchDraftPool is not in the blocking Promise.allSettled', () => {
  it('the Promise.allSettled call does not include fetchDraftPool()', () => {
    // Extract the Promise.allSettled block in bootstrapDraftRoom.
    const allSettledMatch = src.match(/Promise\.allSettled\(\[([\s\S]*?)\]\)/)
    expect(allSettledMatch).not.toBeNull()
    const groupBody = allSettledMatch![1]
    expect(groupBody).not.toContain('fetchDraftPool()')
  })

  it('Promise.allSettled still contains the four critical fetches', () => {
    const allSettledMatch = src.match(/Promise\.allSettled\(\[([\s\S]*?)\]\)/)
    expect(allSettledMatch).not.toBeNull()
    const groupBody = allSettledMatch![1]
    expect(groupBody).toContain('fetchQueue()')
    expect(groupBody).toContain('fetchDraftSettings()')
    expect(groupBody).toContain('fetchDraftChromeData()')
    expect(groupBody).toContain('fetchChat()')
  })
})

// ---------------------------------------------------------------------------
// Behavior 2 — fetchDraftPool still runs after mount (fire-and-forget)
// ---------------------------------------------------------------------------

describe('Behavior 2: fetchDraftPool still fires after mount via void call', () => {
  it('void fetchDraftPool() appears in bootstrapDraftRoom after setLoading(false)', () => {
    const bootstrapMatch = src.match(/const bootstrapDraftRoom = async \(\) => \{([\s\S]*?)\n    }/)
    expect(bootstrapMatch).not.toBeNull()
    const body = bootstrapMatch![1]
    expect(body).toContain('void fetchDraftPool()')
  })

  it('void fetchDraftPool() comes after setLoading(false) in the bootstrap body', () => {
    const bootstrapMatch = src.match(/const bootstrapDraftRoom = async \(\) => \{([\s\S]*?)\n    }/)
    expect(bootstrapMatch).not.toBeNull()
    const body = bootstrapMatch![1]
    const setLoadingPos = body.indexOf('setLoading(false)')
    const voidPoolPos = body.indexOf('void fetchDraftPool()')
    expect(setLoadingPos).toBeGreaterThan(-1)
    expect(voidPoolPos).toBeGreaterThan(-1)
    expect(voidPoolPos).toBeGreaterThan(setLoadingPos)
  })

  it('fetchDraftPool remains in the bootstrap useEffect dependency array', () => {
    expect(src).toMatch(
      /\[leagueId, initialSnapshot, fetchSession, fetchQueue, fetchDraftSettings, fetchDraftChromeData, fetchChat, fetchDraftPool, fetchDraftAssistantContext\]/,
    )
  })
})

// ---------------------------------------------------------------------------
// Behavior 3 — poolLoading derives from poolFetching, not the global loading flag
// ---------------------------------------------------------------------------

describe('Behavior 3: poolLoading uses poolFetching, not loading', () => {
  it('poolLoading is defined as poolFetching && draftPool === null', () => {
    expect(src).toMatch(/const poolLoading = poolFetching && draftPool === null/)
  })

  it('poolLoading does NOT use the global loading flag', () => {
    const poolLoadingLine = src.match(/const poolLoading = .*/)
    expect(poolLoadingLine).not.toBeNull()
    expect(poolLoadingLine![0]).not.toContain('loading &&')
    expect(poolLoadingLine![0]).not.toMatch(/^const poolLoading = loading/)
  })
})

// ---------------------------------------------------------------------------
// Behavior 4 — poolFetching initializes to true (skeleton shows immediately)
// ---------------------------------------------------------------------------

describe('Behavior 4: poolFetching initializes to true', () => {
  it('useState(true) is used for poolFetching', () => {
    expect(src).toMatch(/const \[poolFetching, setPoolFetching\] = useState\(true\)/)
  })

  it('poolFetching state is declared before it is used in poolLoading', () => {
    const fetchingPos = src.indexOf('const [poolFetching, setPoolFetching]')
    const poolLoadingPos = src.indexOf('const poolLoading = poolFetching')
    expect(fetchingPos).toBeGreaterThan(-1)
    expect(poolLoadingPos).toBeGreaterThan(-1)
    expect(fetchingPos).toBeLessThan(poolLoadingPos)
  })
})

// ---------------------------------------------------------------------------
// Behavior 5 — setPoolFetching(false) is in a finally block
// ---------------------------------------------------------------------------

describe('Behavior 5: poolFetching clears in finally — failed fetches do not leave skeleton stuck', () => {
  it('fetchDraftPool has a finally block that calls setPoolFetching(false)', () => {
    // Find the fetchDraftPool useCallback body.
    const poolCbMatch = src.match(
      /const fetchDraftPool = useCallback\(async \(\) => \{([\s\S]*?)\}, \[leagueId, sport\]\)/,
    )
    expect(poolCbMatch).not.toBeNull()
    const body = poolCbMatch![1]
    expect(body).toContain('} finally {')
    expect(body).toMatch(/finally \{[\s\S]*?setPoolFetching\(false\)/)
  })

  it('fetchDraftPool sets poolFetching(true) at the start of a live fetch', () => {
    const poolCbMatch = src.match(
      /const fetchDraftPool = useCallback\(async \(\) => \{([\s\S]*?)\}, \[leagueId, sport\]\)/,
    )
    expect(poolCbMatch).not.toBeNull()
    const body = poolCbMatch![1]
    // setPoolFetching(true) comes before the fetch() call
    const truePos = body.indexOf('setPoolFetching(true)')
    const fetchPos = body.indexOf('fetch(endpoint')
    expect(truePos).toBeGreaterThan(-1)
    expect(fetchPos).toBeGreaterThan(-1)
    expect(truePos).toBeLessThan(fetchPos)
  })
})

// ---------------------------------------------------------------------------
// Behavior 6 — failed pool fetch never calls setSession
// ---------------------------------------------------------------------------

describe('Behavior 6: failed pool fetch does not clear a valid draft session', () => {
  it('fetchDraftPool never calls setSession', () => {
    const poolCbMatch = src.match(
      /const fetchDraftPool = useCallback\(async \(\) => \{([\s\S]*?)\}, \[leagueId, sport\]\)/,
    )
    expect(poolCbMatch).not.toBeNull()
    expect(poolCbMatch![0]).not.toContain('setSession')
  })

  it('fetchDraftPool body calls setDraftPool(null) on error path and never setSession', () => {
    const poolCbMatch = src.match(
      /const fetchDraftPool = useCallback\(async \(\) => \{([\s\S]*?)\}, \[leagueId, sport\]\)/,
    )
    expect(poolCbMatch).not.toBeNull()
    const body = poolCbMatch![1]
    /*
     * ⚠ THE GUARANTEE GOT STRONGER AND THIS ASSERTION WENT RED FOR IT. The test
     * demanded `setDraftPool(null)` on the failure paths. Both of them — the
     * non-ok branch and the catch — now call `setPoolError(true)` and do not
     * touch the pool at all, so a failed refetch leaves a good pool on screen
     * instead of blanking it.
     *
     * That is exactly what this describe block is named for ("failed pool fetch
     * does not clear a valid draft session"), so the old assertion had come to
     * require the weaker of the two behaviours. Asserted as the invariant now:
     * the failure paths flag the error and clear NOTHING.
     */
    expect(body).toContain('setPoolError(true)')
    expect(body).not.toContain('setDraftPool(null)')
    // The catch/error path must never clear the session.
    expect(body).not.toContain('setSession')
  })
})

// ---------------------------------------------------------------------------
// Behavior 7 — successful pool response populates draftPool with entries
// ---------------------------------------------------------------------------

describe('Behavior 7: successful cached pool response populates player pool', () => {
  it('fetchDraftPool calls setDraftPool with entries when res.ok and entries is an array', () => {
    const poolCbMatch = src.match(
      /const fetchDraftPool = useCallback\(async \(\) => \{([\s\S]*?)\}, \[leagueId, sport\]\)/,
    )
    expect(poolCbMatch).not.toBeNull()
    const body = poolCbMatch![1]
    expect(body).toMatch(/if \(res\.ok && Array\.isArray\(data\.entries\)\)/)
    /*
     * The payload moved out of the call into a `nextPool` const, and the setter
     * became a functional update that keeps a non-empty previous pool rather than
     * replacing it with an empty response. `setDraftPool({` therefore no longer
     * appears; the population it stood for still does.
     */
    expect(body).toMatch(/const nextPool: DraftPoolClientPayload = \{/)
    expect(body).toMatch(/setDraftPool\(\(prev\) =>/)
    expect(body).toContain('entries: data.entries')
  })

  it('setDraftPool includes sport, devyConfig, c2cConfig, isIdp fields', () => {
    const poolCbMatch = src.match(
      /const fetchDraftPool = useCallback\(async \(\) => \{([\s\S]*?)\}, \[leagueId, sport\]\)/,
    )
    expect(poolCbMatch).not.toBeNull()
    const body = poolCbMatch![1]
    expect(body).toContain('sport: data.sport ?? sport')
    expect(body).toContain('devyConfig: data.devyConfig')
    expect(body).toContain('c2cConfig: data.c2cConfig')
    expect(body).toContain('isIdp: data.isIdp')
  })
})
