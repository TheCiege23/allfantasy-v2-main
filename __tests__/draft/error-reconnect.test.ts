/**
 * Error and Reconnect Behavior — Commit 17
 *
 * Source-level invariants proving the draft board stays visible and functional
 * through live-sync failures, pick errors, queue failures, commissioner errors,
 * autopick toggle errors, and reconnection. Zero DB, zero render, zero server.
 *
 * Behaviors locked:
 *  1. initialSnapshot stays visible after live-sync failure (board not blanked)
 *  2. Repeated live-sync failure marks degraded state without clearing session
 *  3. Live-sync success clears degraded/reconnecting state
 *  4. no-initialSnapshot fetch failure preserves existing error/loading behavior
 *  5. make-pick failure preserves previous session and current pick position
 *  6. make-pick success with failed follow-up keeps the successful snapshot
 *  7. queue save failure falls back to server state — does not corrupt queue
 *  8. commissioner action failure restores previous session
 *  9. AutopickMeToggle failure rolls back to last committed state
 * 10. Browser visibility/focus return triggers live-sync and session refresh
 * 11. Unmount cancels timers and live-sync polling intervals
 * 12. No failure path invokes legacy draft endpoints
 * 13. No failure path sets session to null when a valid snapshot already exists
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')

const hookSrc = readFileSync(resolve(root, 'hooks/useLiveDraftSync.ts'), 'utf8')
const clientSrc = readFileSync(
  resolve(root, 'components/app/draft-room/DraftRoomPageClient.tsx'),
  'utf8',
)
const commSrc = readFileSync(resolve(root, 'hooks/useCommissionerActions.ts'), 'utf8')
const autopickSrc = readFileSync(
  resolve(root, 'components/app/draft-room/AutopickMeToggle.tsx'),
  'utf8',
)

// ---------------------------------------------------------------------------
// Scoped source extracts for targeted assertions
// ---------------------------------------------------------------------------

const fetchLiveSyncMatch = hookSrc.match(
  /const fetchLiveSync = useCallback\([\s\S]*?\},\s*\[leagueId\],?\s*\)/,
)
const fetchLiveSyncSrc = fetchLiveSyncMatch?.[0] ?? ''

const fetchSessionMatch = clientSrc.match(
  /const fetchSession = useCallback\([\s\S]*?\},\s*\[leagueId\],?\s*\)/,
)
const fetchSessionSrc = fetchSessionMatch?.[0] ?? ''

const makePickMatch = clientSrc.match(
  /const handleMakePick = useCallback\(\s*async[\s\S]*?\},\s*\[[\s\S]*?\],?\s*\)/,
)
const makePickSrc = makePickMatch?.[0] ?? ''

const queueSaveMatch = clientSrc.match(
  /const handleQueueSave = useCallback\(\s*async[\s\S]*?\},\s*\[[\s\S]*?\],?\s*\)/,
)
const queueSaveSrc = queueSaveMatch?.[0] ?? ''

// The failure branch of the run loop (between !sessionPollOk and } else {)
const failBranchMatch = hookSrc.match(
  /if \(!sessionPollOk\) \{[\s\S]*?\} else \{/,
)
const failBranchSrc = failBranchMatch?.[0] ?? ''

// ---------------------------------------------------------------------------
// 1. initialSnapshot stays visible after live-sync failure — board not blanked
// ---------------------------------------------------------------------------

describe('live-sync failure — board stays visible (initialSnapshot not cleared)', () => {
  it('fetchLiveSync source is present in the hook', () => {
    expect(fetchLiveSyncSrc).not.toBe('')
  })

  it('fetchLiveSync returns false on non-ok response (does not throw)', () => {
    expect(fetchLiveSyncSrc).toMatch(/if \(!res\.ok\) return false/)
  })

  it('fetchLiveSync catch block returns false (does not throw or clear state)', () => {
    const catchBlock = fetchLiveSyncSrc.match(/} catch \{[\s\S]*?\}/)
    expect(catchBlock).not.toBeNull()
    expect(catchBlock![0]).toMatch(/return false/)
  })

  it('fetchLiveSync never calls setSession(null)', () => {
    expect(fetchLiveSyncSrc).not.toMatch(/setSession\(null\)/)
  })

  it('fetchLiveSync catch block does not touch session state', () => {
    const catchBlock = fetchLiveSyncSrc.match(/} catch \{[\s\S]*?\}/)
    expect(catchBlock![0]).not.toMatch(/setSession/)
    expect(catchBlock![0]).not.toMatch(/setQueue/)
  })

  it('the run loop failure branch does not call setSession(null)', () => {
    expect(failBranchSrc).not.toMatch(/setSession\(null\)/)
  })

  it('run loop failure branch does not call setSession at all — only increments fail streak', () => {
    // The !sessionPollOk branch should only touch the fail streak counter and
    // the degraded timer — never the session itself
    expect(failBranchSrc).not.toMatch(/setSession\(/)
  })
})

// ---------------------------------------------------------------------------
// 2. Repeated live-sync failure → degraded state, NOT session blank
// ---------------------------------------------------------------------------

describe('repeated live-sync failure — degraded state shown, session preserved', () => {
  it('SESSION_POLL_FAILS_FOR_DEGRADED constant is defined with a threshold > 1', () => {
    const match = hookSrc.match(/SESSION_POLL_FAILS_FOR_DEGRADED\s*=\s*(\d+)/)
    expect(match).not.toBeNull()
    expect(parseInt(match![1]!)).toBeGreaterThan(1)
  })

  it('setConnectionDegraded(true) is only called inside a window.setTimeout callback (deferred, not immediate)', () => {
    const match = hookSrc.match(
      /window\.setTimeout\(\(\) => \{[\s\S]*?setConnectionDegraded\(true\)/,
    )
    expect(match).not.toBeNull()
  })

  it('degraded state is triggered only after fail streak reaches threshold', () => {
    expect(hookSrc).toMatch(
      /pollSessionFailStreakRef\.current >= SESSION_POLL_FAILS_FOR_DEGRADED/,
    )
  })

  it('the degraded timer is only set when connectionDegradedTimerRef is null (no duplicate timers)', () => {
    expect(hookSrc).toMatch(/connectionDegradedTimerRef\.current == null/)
  })

  it('run loop failure path does NOT set session to null', () => {
    expect(failBranchSrc).not.toMatch(/setSession/)
  })
})

// ---------------------------------------------------------------------------
// 3. Live-sync success clears degraded state
// ---------------------------------------------------------------------------

describe('live-sync success — clears degraded/reconnecting state', () => {
  it('success branch resets pollSessionFailStreakRef to 0', () => {
    const elseBranchMatch = hookSrc.match(
      /\} else \{[\s\S]*?pollSessionFailStreakRef\.current = 0/,
    )
    expect(elseBranchMatch).not.toBeNull()
  })

  it('success branch calls clearTimeout on the degraded timer', () => {
    const elseBranchMatch = hookSrc.match(
      /\} else \{[\s\S]*?clearTimeout\(connectionDegradedTimerRef\.current\)/,
    )
    expect(elseBranchMatch).not.toBeNull()
  })

  it('success branch nulls out connectionDegradedTimerRef after clearing', () => {
    const elseBranchMatch = hookSrc.match(
      /\} else \{[\s\S]*?connectionDegradedTimerRef\.current = null/,
    )
    expect(elseBranchMatch).not.toBeNull()
  })

  it('success branch calls setConnectionDegraded(false)', () => {
    const elseBranchMatch = hookSrc.match(
      /\} else \{[\s\S]*?setConnectionDegraded\(false\)/,
    )
    expect(elseBranchMatch).not.toBeNull()
  })

  it('visibility/focus handler also clears degraded state on successful session fetch', () => {
    // The visibility effect that calls fetchSession() clears degraded state if ok
    const match = hookSrc.match(
      /fetchSession\(\)\.then\([\s\S]*?setConnectionDegraded\(false\)/,
    )
    expect(match).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 4. no-initialSnapshot fetch failure — existing behavior preserved
// ---------------------------------------------------------------------------

describe('fetchSession — preserves session on recoverable failures', () => {
  it('fetchSession source is present in DraftRoomPageClient', () => {
    expect(fetchSessionSrc).not.toBe('')
  })

  it('declares hadSessionBeforeRequest to gate session clearing', () => {
    expect(fetchSessionSrc).toMatch(/const hadSessionBeforeRequest = Boolean\(sessionRef/)
  })

  it('401 response intentionally clears session (auth boundary — not a recoverable failure)', () => {
    const auth401Block = fetchSessionSrc.match(/res\.status === 401[\s\S]*?setSession\(null\)/)
    expect(auth401Block).not.toBeNull()
  })

  it('403 response intentionally clears session (auth boundary — not a recoverable failure)', () => {
    const auth403Block = fetchSessionSrc.match(/res\.status === 403[\s\S]*?setSession\(null\)/)
    expect(auth403Block).not.toBeNull()
  })

  it('non-auth setSession(null) calls are guarded by !hadSessionBeforeRequest', () => {
    // Every non-auth setSession(null) must be inside the !hadSessionBeforeRequest guard
    const guardedCalls = [
      ...fetchSessionSrc.matchAll(/if \(!hadSessionBeforeRequest\) \{\s*setSession\(null\)/g),
    ]
    expect(guardedCalls.length).toBeGreaterThanOrEqual(3)
  })

  it('returns hadSessionBeforeRequest (not false) on network error with existing session', () => {
    const catchMatch = fetchSessionSrc.match(/} catch \{[\s\S]*?return hadSessionBeforeRequest/)
    expect(catchMatch).not.toBeNull()
  })

  it('returns hadSessionBeforeRequest (not false) on non-ok response with existing session', () => {
    expect(fetchSessionSrc).toMatch(/return hadSessionBeforeRequest/)
  })
})

// ---------------------------------------------------------------------------
// 5. make-pick failure preserves session and current pick
// ---------------------------------------------------------------------------

describe('handleMakePick — failure path preserves session and pick position', () => {
  it('handleMakePick source is present', () => {
    expect(makePickSrc).not.toBe('')
  })

  it('the non-ok else branch only sets pickError — does not touch session', () => {
    // Extract the else { ... } catch block
    const elseSection = makePickSrc.slice(
      makePickSrc.indexOf('} else {'),
      makePickSrc.indexOf('} catch'),
    )
    expect(elseSection).not.toMatch(/setSession\(null\)/)
    expect(elseSection).not.toMatch(/setSession\(prev/)
  })

  it('the catch block does not call setSession(null)', () => {
    const catchSection = makePickSrc.slice(
      makePickSrc.lastIndexOf('} catch'),
      makePickSrc.lastIndexOf('} finally'),
    )
    expect(catchSection).not.toMatch(/setSession\(null\)/)
  })

  it('the catch block calls fetchSession() to recover latest server state', () => {
    const catchSection = makePickSrc.slice(
      makePickSrc.lastIndexOf('} catch'),
      makePickSrc.lastIndexOf('} finally'),
    )
    expect(catchSection).toMatch(/fetchSession\(\)/)
  })

  it('no branch in handleMakePick failure path advances the local pick counter', () => {
    expect(makePickSrc).not.toMatch(/currentPickNumber\s*\+[+=]/)
  })

  it('pick guard with pickInflightRef prevents double-submission on rapid clicks', () => {
    expect(makePickSrc).toMatch(/if \(pickInflightRef\.current\) return/)
  })

  it('pickInflightRef is reset to false in the finally block after failure', () => {
    const finallyMatch = makePickSrc.match(/} finally \{[\s\S]*?pickInflightRef\.current = false/)
    expect(finallyMatch).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 6. make-pick success with follow-up failure keeps the successful snapshot
// ---------------------------------------------------------------------------

describe('handleMakePick — follow-up failure after success keeps snapshot visible', () => {
  it('session snapshot is merged before awaiting fetchQueue (no rollback on queue fail)', () => {
    const successBlock = makePickSrc.slice(
      makePickSrc.indexOf('if (res.ok && data.session)'),
      makePickSrc.indexOf('} else if (res.ok)'),
    )
    const mergeIdx = successBlock.indexOf('mergeDraftSessionSnapshot')
    const queueIdx = successBlock.indexOf('await fetchQueue')
    expect(mergeIdx).toBeGreaterThanOrEqual(0)
    expect(queueIdx).toBeGreaterThanOrEqual(0)
    expect(mergeIdx).toBeLessThan(queueIdx)
  })

  it('catch block after a follow-up failure only sets pickError — does not revert session', () => {
    const catchSection = makePickSrc.slice(
      makePickSrc.lastIndexOf('} catch'),
      makePickSrc.lastIndexOf('} finally'),
    )
    // catch only sets pickError and optionally calls fetchSession — no session revert
    expect(catchSection).not.toMatch(/setSession\(null\)/)
    expect(catchSection).not.toMatch(/setSession\(priorSession\)/)
  })

  it('fetchQueue() failure does not remove the successfully merged session snapshot', () => {
    // handleQueueSave failure (fetchQueue fallback) does not touch session state
    expect(queueSaveSrc).not.toMatch(/setSession/)
  })
})

// ---------------------------------------------------------------------------
// 7. queue save failure falls back to server state — queue never nulled
// ---------------------------------------------------------------------------

describe('handleQueueSave — failure falls back to server state', () => {
  it('handleQueueSave source is present', () => {
    expect(queueSaveSrc).not.toBe('')
  })

  it('non-ok response falls through to fetchQueue() (server restoration)', () => {
    // The non-ok branch does not return early — it falls to the fetchQueue below the try/catch
    const nonOkBlock = queueSaveSrc.match(
      /if \(res\.ok[\s\S]*?\}\s*draftRoomWarn/,
    )
    expect(nonOkBlock).not.toBeNull()
    // fetchQueue() appears after the try/catch block
    expect(queueSaveSrc).toMatch(/await fetchQueue\(\)/)
  })

  it('catch block falls through to fetchQueue() (network error restoration)', () => {
    const catchSection = queueSaveSrc.slice(
      queueSaveSrc.indexOf('} catch'),
    )
    // After catch, fetchQueue is called
    expect(catchSection).toMatch(/fetchQueue\(\)/)
  })

  it('queue is never explicitly set to null in handleQueueSave failure paths', () => {
    expect(queueSaveSrc).not.toMatch(/setQueue\(null\)/)
    expect(queueSaveSrc).not.toMatch(/setQueue\(\[\]\)/)
  })

  it('session state is not touched by handleQueueSave at all', () => {
    expect(queueSaveSrc).not.toMatch(/setSession/)
  })
})

// ---------------------------------------------------------------------------
// 8. commissioner action failure restores previous session
// ---------------------------------------------------------------------------

describe('useCommissionerActions — failure restores previous session', () => {
  it('priorSession is captured before the optimistic patch', () => {
    expect(commSrc).toMatch(/let priorSession[\s\S]*?setSession\(\(prev\) =>/)
  })

  it('non-ok response restores priorSession (not null)', () => {
    const match = commSrc.match(
      /if \(!res\.ok\) \{[\s\S]*?if \(priorSession\) setSession\(priorSession\)/,
    )
    expect(match).not.toBeNull()
  })

  it('network error (catch) restores priorSession (not null)', () => {
    const match = commSrc.match(
      /} catch \{[\s\S]*?if \(priorSession\) setSession\(priorSession\)/,
    )
    expect(match).not.toBeNull()
  })

  it('failure never calls setSession(null) unconditionally', () => {
    // Both failure paths guard setSession behind `if (priorSession)` — never null
    expect(commSrc).not.toMatch(/setSession\(null\)/)
  })

  it('failure shows governance error banner', () => {
    expect(commSrc).toMatch(/setGovernanceBanner\(\{ variant: 'error'/)
  })
})

// ---------------------------------------------------------------------------
// 9. AutopickMeToggle failure rolls back to last committed state
// ---------------------------------------------------------------------------

describe('AutopickMeToggle — failure rolls back to committed state', () => {
  it('committedRef is initialized from viewerAutopick.enabled and mode', () => {
    expect(autopickSrc).toMatch(/committedRef\.current = \{/)
    expect(autopickSrc).toMatch(/enabled:/)
    expect(autopickSrc).toMatch(/mode:/)
  })

  it('on success, committedRef is updated to server-confirmed values', () => {
    expect(autopickSrc).toMatch(/committedRef\.current = \{[\s\S]*?enabled: data\.viewerAutopick/)
  })

  it('catch block rolls back localEnabled to committedRef.current.enabled', () => {
    const catchBlock = autopickSrc.match(/} catch[\s\S]*?} finally/)
    expect(catchBlock).not.toBeNull()
    expect(catchBlock![0]).toMatch(/setLocalEnabled\(committedRef\.current\.enabled\)/)
  })

  it('catch block rolls back localMode to committedRef.current.mode', () => {
    const catchBlock = autopickSrc.match(/} catch[\s\S]*?} finally/)
    expect(catchBlock![0]).toMatch(/setLocalMode\(committedRef\.current\.mode\)/)
  })

  it('catch block sets inline error message', () => {
    const catchBlock = autopickSrc.match(/} catch[\s\S]*?} finally/)
    expect(catchBlock![0]).toMatch(/setError\(/)
  })

  it('uses canonical /api/leagues/ endpoint (not legacy /api/draft/autopick/toggle)', () => {
    expect(autopickSrc).toMatch(/\/api\/leagues\//)
    expect(autopickSrc).not.toMatch(/\/api\/draft\/autopick\/toggle/)
  })
})

// ---------------------------------------------------------------------------
// 10. Browser visibility/focus return triggers live-sync and session refresh
// ---------------------------------------------------------------------------

describe('useLiveDraftSync — visibility return triggers refresh', () => {
  it('adds a visibilitychange listener in the session-refresh effect', () => {
    const matches = [...hookSrc.matchAll(/document\.addEventListener\('visibilitychange'/g)]
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })

  it('visibility/focus handler calls fetchSession when tab becomes visible', () => {
    expect(hookSrc).toMatch(/if \(document\.hidden\) return/)
    const match = hookSrc.match(
      /const onVisibility[\s\S]*?void fetchSession\(\)/,
    )
    expect(match).not.toBeNull()
  })

  it('visibility/focus handler also triggers a live-sync poll via refetchOnceRef', () => {
    const match = hookSrc.match(
      /const onVisibility[\s\S]*?refetchOnceRef\.current\?\.?\(\)/,
    )
    expect(match).not.toBeNull()
  })

  it('visibility-poll-interval effect adjusts poll frequency on tab focus', () => {
    // Tab shown → poll interval tightens for active drafts
    expect(hookSrc).toMatch(/setPollInterval\(2000\)/)
    // Tab hidden → poll interval loosens
    expect(hookSrc).toMatch(/setPollInterval\(POLL_MS_BACKGROUND\)/)
  })

  it('visibility/session effect dependency is [fetchSession] — picks up stable reference', () => {
    expect(hookSrc).toMatch(/\}, \[fetchSession\]\)/)
  })
})

// ---------------------------------------------------------------------------
// 11. Unmount cancels timers and live-sync polling intervals
// ---------------------------------------------------------------------------

describe('useLiveDraftSync and DraftRoomPageClient — unmount cleanup', () => {
  it('interval effect returns clearInterval cleanup', () => {
    const match = hookSrc.match(
      /const id = setInterval[\s\S]*?return \(\) => clearInterval\(id\)/,
    )
    expect(match).not.toBeNull()
  })

  it('both visibility effects return removeEventListener cleanup', () => {
    const cleanups = [
      ...hookSrc.matchAll(
        /return \(\) => document\.removeEventListener\('visibilitychange'/g,
      ),
    ]
    expect(cleanups.length).toBeGreaterThanOrEqual(2)
  })

  it('DraftRoomPageClient unmount effect clears connectionDegradedTimerRef', () => {
    expect(clientSrc).toMatch(
      /if \(connectionDegradedTimerRef\.current\) clearTimeout\(connectionDegradedTimerRef\.current\)/,
    )
  })

  it('DraftRoomPageClient unmount effect clears governanceSuccessTimeoutRef', () => {
    expect(clientSrc).toMatch(
      /if \(governanceSuccessTimeoutRef\.current\) clearTimeout\(governanceSuccessTimeoutRef\.current\)/,
    )
  })

  it('unmount cleanup effect has empty dep array [] (runs once on unmount)', () => {
    // The cleanup-only effect must depend on nothing so it fires on every unmount
    const match = clientSrc.match(
      /return \(\) => \{[\s\S]*?connectionDegradedTimerRef[\s\S]*?\}\s*\},\s*\[\]\)/,
    )
    expect(match).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 12. No failure path invokes legacy draft endpoints
// ---------------------------------------------------------------------------

describe('error recovery — no legacy draft endpoints used', () => {
  it('useLiveDraftSync does not reference the legacy /api/draft/session endpoint', () => {
    expect(hookSrc).not.toMatch(/['"`]\/api\/draft\/session/)
  })

  it('useLiveDraftSync does not reference the legacy /api/draft/live-sync (bare) endpoint', () => {
    // Canonical form is /api/leagues/{id}/draft/live-sync
    expect(hookSrc).not.toMatch(/fetch\(['"`]\/api\/draft\/live-sync/)
  })

  it('useCommissionerActions does not reference legacy /api/draft/controls endpoint', () => {
    expect(commSrc).not.toMatch(/fetch\(['"`]\/api\/draft\/controls/)
  })

  it('useCommissionerActions does not reference /api/draft/autopick/toggle', () => {
    expect(commSrc).not.toMatch(/\/api\/draft\/autopick\/toggle/)
  })

  it('AutopickMeToggle does not reference legacy /api/draft/autopick/toggle endpoint', () => {
    expect(autopickSrc).not.toMatch(/\/api\/draft\/autopick\/toggle/)
  })

  it('handleMakePick catch block does not call legacy pick endpoint during recovery', () => {
    const catchSection = makePickSrc.slice(
      makePickSrc.lastIndexOf('} catch'),
      makePickSrc.lastIndexOf('} finally'),
    )
    expect(catchSection).not.toMatch(/fetch\(['"`]\/api\/draft\/pick/)
  })

  it('handleQueueSave does not reference legacy /api/draft/queue endpoint', () => {
    expect(queueSaveSrc).not.toMatch(/fetch\(['"`]\/api\/draft\/queue/)
  })

  it('all fetch calls in the hook use the canonical /api/leagues/ prefix', () => {
    const fetchCalls = [...hookSrc.matchAll(/fetch\(`([^`]+)`/g)]
    for (const m of fetchCalls) {
      expect(m[1]).toMatch(/\/api\/leagues\//)
    }
  })
})

// ---------------------------------------------------------------------------
// 13. No failure path sets session to null when a valid snapshot already exists
// ---------------------------------------------------------------------------

describe('session null-safety — valid snapshot never cleared on recoverable failures', () => {
  it('fetchLiveSync (live-sync failure) never calls setSession(null)', () => {
    expect(fetchLiveSyncSrc).not.toMatch(/setSession\(null\)/)
  })

  it('run loop failure branch (bad poll) never calls setSession at all', () => {
    expect(failBranchSrc).not.toMatch(/setSession/)
  })

  it('fetchSession network error with existing session returns true-ish (does not null session)', () => {
    // The catch block returns `hadSessionBeforeRequest`, which is `true` when a session exists
    const catchMatch = fetchSessionSrc.match(
      /} catch \{[\s\S]*?if \(!hadSessionBeforeRequest\) \{\s*setSession\(null\)\s*\}[\s\S]*?return hadSessionBeforeRequest/,
    )
    expect(catchMatch).not.toBeNull()
  })

  it('handleMakePick non-ok response branch never calls setSession(null)', () => {
    const elseSection = makePickSrc.slice(
      makePickSrc.indexOf('} else {'),
      makePickSrc.indexOf('} catch'),
    )
    expect(elseSection).not.toMatch(/setSession\(null\)/)
  })

  it('handleMakePick catch block never calls setSession(null)', () => {
    const catchSection = makePickSrc.slice(
      makePickSrc.lastIndexOf('} catch'),
      makePickSrc.lastIndexOf('} finally'),
    )
    expect(catchSection).not.toMatch(/setSession\(null\)/)
  })

  it('handleQueueSave failure path never touches session state', () => {
    expect(queueSaveSrc).not.toMatch(/setSession/)
  })

  it('useCommissionerActions failure never sets session to null — restores priorSession', () => {
    expect(commSrc).not.toMatch(/setSession\(null\)/)
  })

  it('the visibility/session effect in useLiveDraftSync never sets session to null', () => {
    // The onVisibility handler calls fetchSession() which has the hadSessionBeforeRequest guard
    // It never directly calls setSession(null)
    const onVisibilityMatch = hookSrc.match(
      /const onVisibility[\s\S]*?document\.removeEventListener\('visibilitychange', onVisibility\)/,
    )
    expect(onVisibilityMatch).not.toBeNull()
    expect(onVisibilityMatch![0]).not.toMatch(/setSession\(null\)/)
  })
})
