/**
 * useLiveDraftSync — source invariants
 *
 * Locks the 8 behavioral contracts of the live-sync polling hook:
 *   1. Polls the correct /api/leagues/[leagueId]/draft/live-sync endpoint.
 *   2. Passes `since` from sessionRef.current.updatedAt.
 *   3. Skips session merge when controlActionInflightRef.current > 0.
 *   4. Increments pollSessionFailStreakRef on consecutive poll failures.
 *   5. Resets streak and clears the degraded timer on a successful poll.
 *   6. chatSyncActive forces includeChat regardless of tick modulus.
 *   7. pollInFlightRef gate prevents re-entrant fetches.
 *   8. Calls setConnectionDegraded(false) on successful poll.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
const src = readFileSync(resolve(root, 'hooks/useLiveDraftSync.ts'), 'utf8')

// ---------------------------------------------------------------------------
// 1. Correct endpoint URL
// ---------------------------------------------------------------------------

describe('useLiveDraftSync — polls the canonical live-sync endpoint', () => {
  it('fetches /api/leagues/[leagueId]/draft/live-sync', () => {
    expect(src).toMatch(/\/api\/leagues\/.*\/draft\/live-sync/)
  })

  it('uses encodeURIComponent on leagueId', () => {
    expect(src).toMatch(/encodeURIComponent\(leagueId\)/)
  })

  it('never references the legacy /api/draft/autopick/toggle or /api/draft/room endpoints', () => {
    expect(src).not.toMatch(/\/api\/draft\/autopick\/toggle/)
    expect(src).not.toMatch(/\/api\/draft\/room/)
  })
})

// ---------------------------------------------------------------------------
// 2. `since` param forwarded from sessionRef
// ---------------------------------------------------------------------------

describe('useLiveDraftSync — passes since from sessionRef.current.updatedAt', () => {
  it('reads updatedAt from sessionRef.current', () => {
    expect(src).toMatch(/sessionRef\.current\?\.updatedAt/)
  })

  it('sets the since URLSearchParam when opts.since is truthy', () => {
    expect(src).toMatch(/if \(opts\.since\) sp\.set\('since', opts\.since\)/)
  })
})

// ---------------------------------------------------------------------------
// 3. controlActionInflightRef guards session merge
// ---------------------------------------------------------------------------

describe('useLiveDraftSync — skips session merge when controlActionInflightRef > 0', () => {
  it('checks controlActionInflightRef.current === 0 before calling setSession', () => {
    expect(src).toMatch(/controlActionInflightRef\.current === 0/)
  })

  it('setSession call is inside the controlActionInflightRef guard', () => {
    const match = src.match(
      /if \(data\.session && controlActionInflightRef\.current === 0\) \{[\s\S]*?setSession/
    )
    expect(match).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 4. Failure streak increments pollSessionFailStreakRef
// ---------------------------------------------------------------------------

describe('useLiveDraftSync — increments pollSessionFailStreakRef on poll failure', () => {
  it('increments the streak counter when sessionPollOk is false', () => {
    expect(src).toMatch(/pollSessionFailStreakRef\.current \+= 1/)
  })

  it('only increments inside the !sessionPollOk branch', () => {
    const match = src.match(
      /if \(!sessionPollOk\) \{[\s\S]*?pollSessionFailStreakRef\.current \+= 1/
    )
    expect(match).not.toBeNull()
  })

  it('triggers setConnectionDegraded after SESSION_POLL_FAILS_FOR_DEGRADED consecutive failures', () => {
    expect(src).toMatch(/pollSessionFailStreakRef\.current >= SESSION_POLL_FAILS_FOR_DEGRADED/)
    expect(src).toMatch(/setConnectionDegraded\(true\)/)
  })
})

// ---------------------------------------------------------------------------
// 5. Success resets streak and clears degraded timer
// ---------------------------------------------------------------------------

describe('useLiveDraftSync — resets streak and clears timer on successful poll', () => {
  it('resets pollSessionFailStreakRef to 0 on success', () => {
    expect(src).toMatch(/pollSessionFailStreakRef\.current = 0/)
  })

  it('calls clearTimeout on connectionDegradedTimerRef when it is set', () => {
    expect(src).toMatch(/clearTimeout\(connectionDegradedTimerRef\.current\)/)
  })

  it('nulls out connectionDegradedTimerRef after clearing', () => {
    expect(src).toMatch(/connectionDegradedTimerRef\.current = null/)
  })
})

// ---------------------------------------------------------------------------
// 6. chatSyncActive forces includeChat
// ---------------------------------------------------------------------------

describe('useLiveDraftSync — chatSyncActive forces chat refresh on every tick', () => {
  it('shouldRefreshChat is true when chatSyncActive is true, regardless of tick', () => {
    expect(src).toMatch(/chatSyncActive \|\| \(tick % CHAT_POLL_EVERY_N_TICKS\)/)
  })
})

// ---------------------------------------------------------------------------
// 7. pollInFlightRef prevents re-entrant fetches
// ---------------------------------------------------------------------------

describe('useLiveDraftSync — pollInFlightRef gate prevents concurrent polls', () => {
  it('returns early when pollInFlightRef.current is already true', () => {
    expect(src).toMatch(/if \(pollInFlightRef\.current\) return/)
  })

  it('sets pollInFlightRef.current = true before the fetch', () => {
    expect(src).toMatch(/pollInFlightRef\.current = true/)
  })

  it('resets pollInFlightRef.current = false in the finally block', () => {
    const match = src.match(/} finally \{[\s\S]*?pollInFlightRef\.current = false/)
    expect(match).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 8. setConnectionDegraded(false) on successful poll
// ---------------------------------------------------------------------------

describe('useLiveDraftSync — calls setConnectionDegraded(false) after successful poll', () => {
  it('calls setConnectionDegraded(false) in the success branch', () => {
    const match = src.match(
      /} else \{[\s\S]*?pollSessionFailStreakRef\.current = 0[\s\S]*?setConnectionDegraded\(false\)/
    )
    expect(match).not.toBeNull()
  })

  it('setConnectionDegraded(false) is never called outside a conditional branch', () => {
    // Every call to setConnectionDegraded(false) in the hook must be preceded
    // by a guard (either inside the success else block or a visibility handler).
    // Verify by checking it never appears at the outermost run() scope — i.e.
    // never directly after `pollInFlightRef.current = true` with no surrounding if.
    expect(src).not.toMatch(/pollInFlightRef\.current = true\s*\n\s*setConnectionDegraded\(false\)/)
  })
})
