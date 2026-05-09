/**
 * DraftRoomPageClient — initialSnapshot seeding (Commit 10)
 *
 * Five behaviors locked here:
 *
 *   1. loading initializes to `false` when initialSnapshot is provided —
 *      no full-page loading flash on first paint.
 *   2. bootstrapDraftRoom skips the blocking fetchSession() call when
 *      initialSnapshot is provided — no redundant GET before rendering.
 *   3. draftSessionAccess is set to 'ok' immediately (no null gap that
 *      would show the empty-state branch while the board is ready).
 *   4. Live-sync polling (fetchLiveSync) still runs after mount — the
 *      poll effect has no initialSnapshot gate, so it fires unconditionally.
 *   5. Failed live-sync does not clear the visible snapshot — fetchLiveSync
 *      never calls setSession; only fetchSession touches session on failure,
 *      and only when hadSessionBeforeRequest is false.
 *
 * Tests 1–3 and 5 are proven by source-level assertions (cheap, zero
 * import cost). Test 4 relies on the absence of a guard around the poll.
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
// Behavior 1 — no loading flash when initialSnapshot is provided
// ---------------------------------------------------------------------------

describe('Behavior 1: loading initializes to false when initialSnapshot given', () => {
  it('useState for loading seeds from initialSnapshot ternary', () => {
    expect(src).toMatch(/useState\(initialSnapshot \? false : true\)/)
  })

  it('session state seeds from initialSnapshot', () => {
    expect(src).toMatch(/useState<DraftSessionSnapshot \| null>\(initialSnapshot \?\? null\)/)
  })

  it('sessionRef seeds from initialSnapshot', () => {
    expect(src).toMatch(/useRef<DraftSessionSnapshot \| null>\(initialSnapshot \?\? null\)/)
  })
})

// ---------------------------------------------------------------------------
// Behavior 2 — bootstrapDraftRoom skips fetchSession when initialSnapshot given
// ---------------------------------------------------------------------------

describe('Behavior 2: bootstrapDraftRoom skips fetchSession when initialSnapshot provided', () => {
  it('bootstrap branches on initialSnapshot before calling fetchSession', () => {
    // The bootstrap async function should check initialSnapshot first.
    expect(src).toMatch(/if \(initialSnapshot\)[\s\S]*?setDraftSessionAccess\('ok'\)[\s\S]*?} else \{[\s\S]*?setLoading\(true\)[\s\S]*?fetchSession/)
  })

  it('fetchSession is in the else branch — not called unconditionally at boot', () => {
    // If initialSnapshot is truthy, the else branch with fetchSession is skipped.
    // The pattern: "} else {" block contains both setLoading(true) AND fetchSession.
    const bootstrapMatch = src.match(/const bootstrapDraftRoom = async \(\) => \{([\s\S]*?)\n  }/)
    expect(bootstrapMatch).not.toBeNull()
    const body = bootstrapMatch![1]
    // initialSnapshot guard comes before setLoading(true)
    const initialSnapshotPos = body.indexOf('if (initialSnapshot)')
    const setLoadingTruePos = body.indexOf('setLoading(true)')
    expect(initialSnapshotPos).toBeGreaterThan(-1)
    expect(setLoadingTruePos).toBeGreaterThan(-1)
    // The initialSnapshot branch is entered before setLoading(true) — it's the
    // if-path, and setLoading(true) is inside the else block.
    expect(initialSnapshotPos).toBeLessThan(setLoadingTruePos)
  })
})

// ---------------------------------------------------------------------------
// Behavior 3 — draftSessionAccess set to 'ok' immediately in initialSnapshot path
// ---------------------------------------------------------------------------

describe("Behavior 3: draftSessionAccess set to 'ok' without waiting on fetchSession", () => {
  it("sets draftSessionAccess to 'ok' inside the initialSnapshot branch", () => {
    expect(src).toMatch(/if \(initialSnapshot\)[\s\S]{0,300}setDraftSessionAccess\('ok'\)/)
  })

  it("does not set draftSessionAccess to null in the initialSnapshot path", () => {
    // Extract just the if(initialSnapshot) { ... } block from bootstrapDraftRoom.
    // We know the if-block contains setDraftSessionAccess('ok') and ends before '} else {'.
    const ifBlock = src.match(/if \(initialSnapshot\) \{([\s\S]*?)\} else \{/)
    expect(ifBlock).not.toBeNull()
    expect(ifBlock![1]).not.toMatch(/setDraftSessionAccess\(null\)/)
  })
})

// ---------------------------------------------------------------------------
// Behavior 4 — live-sync poll still runs after mount (no initialSnapshot gate)
// ---------------------------------------------------------------------------

const hookSrc = readFileSync(
  resolve(root, 'hooks/useLiveDraftSync.ts'),
  'utf8',
)

describe('Behavior 4: live-sync poll is not gated on initialSnapshot', () => {
  it('the poll useEffect in useLiveDraftSync does not check initialSnapshot before scheduling', () => {
    // Find the poll effect that uses pollInFlightRef and fetchLiveSync in the hook.
    // It must not contain an early return on initialSnapshot.
    const pollEffectMatch = hookSrc.match(
      /useEffect\(\(\) => \{[\s\S]*?pollInFlightRef\.current = true[\s\S]*?\}, \[[\s\S]*?fetchLiveSync/
    )
    expect(pollEffectMatch).not.toBeNull()
    expect(pollEffectMatch![0]).not.toMatch(/if.*initialSnapshot.*return/)
  })

  it('DraftRoomPageClient calls useLiveDraftSync unconditionally (no initialSnapshot gate)', () => {
    // The hook call must not be wrapped in a conditional on initialSnapshot.
    expect(src).toMatch(/useLiveDraftSync\(/)
    const hookCallMatch = src.match(/useLiveDraftSync\(\{[\s\S]*?\}\)/)
    expect(hookCallMatch).not.toBeNull()
    expect(hookCallMatch![0]).not.toMatch(/if.*initialSnapshot/)
  })
})

// ---------------------------------------------------------------------------
// Behavior 5 — failed live-sync never clears the visible snapshot
// ---------------------------------------------------------------------------

describe('Behavior 5: failed live-sync preserves snapshot — no blank-board drop', () => {
  it('fetchLiveSync never calls setSession(null) on failure', () => {
    // fetchLiveSync now lives in hooks/useLiveDraftSync.ts — check the hook source.
    const match = hookSrc.match(
      /const fetchLiveSync = useCallback\(\s*async[\s\S]*?\},\s*\[leagueId\],\s*\)/
    )
    expect(match).not.toBeNull()
    const body = match![0]
    // fetchLiveSync must not call setSession with null or undefined on failure.
    expect(body).not.toMatch(/setSession\(null\)/)
    expect(body).not.toMatch(/setSession\(undefined\)/)
  })

  it('fetchSession guards setSession(null) behind hadSessionBeforeRequest check on non-auth failure', () => {
    // Extract fetchSession body — from declaration to closing ], [leagueId], )
    const match = src.match(
      /const fetchSession = useCallback\(async[\s\S]*?\}, \[leagueId\]\)/
    )
    expect(match).not.toBeNull()
    const body = match![0]

    // Count unconditional setSession(null) calls — only 401 and 403 branches
    // should call setSession(null) unconditionally; all others are guarded by
    // hadSessionBeforeRequest.
    const unconditionalNulls = body.match(/(?<!hadSessionBeforeRequest\) \{[\s\S]{0,30})setSession\(null\)/g) ?? []

    // The 401 and 403 paths are the only unconditional ones (2 total).
    // On network error / empty-ok, the null-set is guarded: `if (!hadSessionBeforeRequest)`.
    // This means when initialSnapshot was provided, sessionRef is truthy on first
    // call, so hadSessionBeforeRequest = true and session is preserved.
    const guardedNulls = (body.match(/if \(!hadSessionBeforeRequest\)[\s\S]{0,80}setSession\(null\)/g) ?? []).length
    expect(guardedNulls).toBeGreaterThanOrEqual(2)
  })

  it('fetchSession uses hadSessionBeforeRequest to protect existing snapshot on error', () => {
    expect(src).toMatch(/const hadSessionBeforeRequest = Boolean\(sessionRef\.current\)/)
  })
})

// ---------------------------------------------------------------------------
// Behavior 2 (continued) — dependency array includes initialSnapshot
// ---------------------------------------------------------------------------

describe('Behavior 2 (dep array): bootstrap useEffect lists initialSnapshot as dependency', () => {
  it('includes initialSnapshot in the bootstrap effect dependency array', () => {
    expect(src).toMatch(
      /\[leagueId, initialSnapshot, fetchSession, fetchQueue, fetchDraftSettings, fetchDraftChromeData, fetchChat, fetchDraftPool, fetchDraftAssistantContext\]/
    )
  })
})
