/**
 * Pick + Queue — canonical endpoint invariants (Commit 15)
 *
 * Locks make-pick and queue add/remove/reorder behavior against the canonical
 * /api/leagues/[leagueId]/draft/pick and /draft/queue endpoints.
 *
 * All tests are source-level assertions — fast, zero DB, zero render cost.
 * They verify that:
 *   - only canonical endpoints are called (never legacy routes)
 *   - pick payload includes the expected fields
 *   - success path merges the returned snapshot and updates queue
 *   - failure path preserves session without advancing state
 *   - queue mutations (add/remove/reorder) all funnel through handleQueueSave
 *     which PUTs to the canonical queue endpoint
 *   - initialSnapshot seeding is not disturbed by pick/queue handlers
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
const src = readFileSync(
  resolve(root, 'components/app/draft-room/DraftRoomPageClient.tsx'),
  'utf8',
)

// Grab just the handleMakePick callback body for scoped assertions
const makePickMatch = src.match(
  /const handleMakePick = useCallback\(\s*async[\s\S]*?\},\s*\[[\s\S]*?\],?\s*\)/
)
const makePickSrc = makePickMatch?.[0] ?? ''

// Grab just the handleQueueSave callback body
const queueSaveMatch = src.match(
  /const handleQueueSave = useCallback\(\s*async[\s\S]*?\},\s*\[[\s\S]*?\],?\s*\)/
)
const queueSaveSrc = queueSaveMatch?.[0] ?? ''

// ---------------------------------------------------------------------------
// 1. make-pick — canonical endpoint
// ---------------------------------------------------------------------------

describe('make-pick — uses canonical /draft/pick endpoint', () => {
  it('handleMakePick is present in DraftRoomPageClient', () => {
    expect(makePickSrc).not.toBe('')
  })

  it('posts to /api/leagues/[leagueId]/draft/pick', () => {
    expect(makePickSrc).toMatch(/\/api\/leagues\/.*\/draft\/pick/)
  })

  it('uses encodeURIComponent on leagueId', () => {
    expect(makePickSrc).toMatch(/encodeURIComponent\(leagueId\)/)
  })

  it('uses POST method', () => {
    expect(makePickSrc).toMatch(/method: 'POST'/)
  })
})

// ---------------------------------------------------------------------------
// 2. make-pick — no legacy routes
// ---------------------------------------------------------------------------

describe('make-pick — never calls legacy pick endpoints', () => {
  it('does not reference /api/draft/pick (legacy)', () => {
    expect(makePickSrc).not.toMatch(/['"`]\/api\/draft\/pick['"`]/)
  })

  it('does not reference /api/draft/room', () => {
    expect(makePickSrc).not.toMatch(/\/api\/draft\/room/)
  })

  it('does not reference /api/draft/autopick/toggle', () => {
    expect(makePickSrc).not.toMatch(/\/api\/draft\/autopick\/toggle/)
  })

  it('does not reference DraftRoomStateRow or DraftRoomPickRecord', () => {
    expect(makePickSrc).not.toMatch(/DraftRoomStateRow|DraftRoomPickRecord/)
  })
})

// ---------------------------------------------------------------------------
// 3. make-pick payload — expected fields
// ---------------------------------------------------------------------------

describe('make-pick payload — canonical fields', () => {
  it('sends playerId in the request body', () => {
    expect(makePickSrc).toMatch(/playerId/)
  })

  it('sends playerName in the request body', () => {
    expect(makePickSrc).toMatch(/playerName: player\.name/)
  })

  it('sends position in the request body', () => {
    expect(makePickSrc).toMatch(/position: player\.position/)
  })

  it('sends rosterId in the request body', () => {
    expect(makePickSrc).toMatch(/rosterId:/)
  })

  it('includes pickMetadata in the payload', () => {
    expect(makePickSrc).toMatch(/pickMetadata/)
  })

  it('includes source field (user | commissioner | college | devy | promoted_devy)', () => {
    expect(makePickSrc).toMatch(/source:/)
    expect(makePickSrc).toMatch(/'commissioner'/)
    expect(makePickSrc).toMatch(/'user'/)
  })
})

// ---------------------------------------------------------------------------
// 4. make-pick — success path merges snapshot and clears queue entry
// ---------------------------------------------------------------------------

describe('make-pick — success path', () => {
  it('merges returned session snapshot via mergeDraftSessionSnapshot', () => {
    expect(makePickSrc).toMatch(/mergeDraftSessionSnapshot\(prev, data\.session/)
  })

  it('removes drafted player from queue by name after successful pick', () => {
    expect(makePickSrc).toMatch(/normalizeDraftedPlayerName\(e\.playerName\).*normalizeDraftedPlayerName\(player\.name\)/)
  })

  it('calls fetchQueue after successful pick', () => {
    expect(makePickSrc).toMatch(/await fetchQueue\(\)/)
  })

  it('calls fetchDraftPool after successful pick', () => {
    expect(makePickSrc).toMatch(/await fetchDraftPool\(\)/)
  })

  it('resets pollSessionFailStreakRef to 0 after successful pick', () => {
    expect(makePickSrc).toMatch(/pollSessionFailStreakRef\.current = 0/)
  })

  it('clears connectionDegradedTimerRef after successful pick', () => {
    expect(makePickSrc).toMatch(/connectionDegradedTimerRef\.current != null/)
  })
})

// ---------------------------------------------------------------------------
// 5. make-pick — failure path does not advance state
// ---------------------------------------------------------------------------

describe('make-pick — failure path preserves state', () => {
  it('sets pickError on non-ok response', () => {
    expect(makePickSrc).toMatch(/setPickError\(/)
  })

  it('does not call setSession with null on pick failure', () => {
    const afterElse = makePickSrc.slice(makePickSrc.indexOf('} else {'))
    // The else branch (non-ok response) must NOT call setSession(null)
    const elseSection = afterElse.slice(0, afterElse.indexOf('} catch {'))
    expect(elseSection).not.toMatch(/setSession\(null\)/)
  })

  it('does not advance current pick locally on failure', () => {
    // No local pick number increment in the failure branches
    expect(makePickSrc).not.toMatch(/currentPickNumber\s*\+[+=]/)
  })

  it('guards pick submission with pickInflightRef to prevent double-posting', () => {
    expect(makePickSrc).toMatch(/pickInflightRef\.current/)
    expect(makePickSrc).toMatch(/if \(pickInflightRef\.current\) return/)
  })

  it('resets pickInflightRef in the finally block', () => {
    const match = makePickSrc.match(/} finally \{[\s\S]*?pickInflightRef\.current = false/)
    expect(match).not.toBeNull()
  })

  it('fetches fresh session on network error', () => {
    const match = makePickSrc.match(/} catch \(err\) \{[\s\S]*?fetchSession\(\)/)
    expect(match).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 6–8. Queue handlers — canonical endpoint
// ---------------------------------------------------------------------------

describe('handleQueueSave — canonical /draft/queue endpoint', () => {
  it('handleQueueSave is present in DraftRoomPageClient', () => {
    expect(queueSaveSrc).not.toBe('')
  })

  it('PUTs to /api/leagues/[leagueId]/draft/queue', () => {
    expect(queueSaveSrc).toMatch(/\/api\/leagues\/.*\/draft\/queue/)
    expect(queueSaveSrc).toMatch(/method: 'PUT'/)
  })

  it('uses encodeURIComponent on leagueId', () => {
    expect(queueSaveSrc).toMatch(/encodeURIComponent\(leagueId\)/)
  })

  it('sends the queue array in the request body', () => {
    expect(queueSaveSrc).toMatch(/JSON\.stringify\(\{ queue:/)
  })

  it('falls back to fetchQueue on save failure', () => {
    expect(queueSaveSrc).toMatch(/await fetchQueue\(\)/)
  })
})

describe('queue add — funnels through handleQueueSave', () => {
  it('handleAddToQueue calls handleQueueSave with the new queue', () => {
    const match = src.match(
      /const handleAddToQueue = useCallback\([\s\S]*?handleQueueSave\(/
    )
    expect(match).not.toBeNull()
  })

  it('handleAddToQueue updates local queue state optimistically', () => {
    const match = src.match(
      /const handleAddToQueue = useCallback\([\s\S]*?setQueue\(next\)/
    )
    expect(match).not.toBeNull()
  })

  it('handleAddToQueue respects draftQueueSizeLimit via trimDraftQueue', () => {
    const match = src.match(
      /const handleAddToQueue = useCallback\([\s\S]*?trimDraftQueue\(/
    )
    expect(match).not.toBeNull()
  })
})

describe('queue remove — funnels through handleQueueSave', () => {
  it('handleRemoveFromQueue calls handleQueueSave with the filtered queue', () => {
    const match = src.match(
      /const handleRemoveFromQueue = useCallback\([\s\S]*?handleQueueSave\(/
    )
    expect(match).not.toBeNull()
  })

  it('handleRemoveFromQueue updates local queue state optimistically', () => {
    const match = src.match(
      /const handleRemoveFromQueue = useCallback\([\s\S]*?setQueue\(next\)/
    )
    expect(match).not.toBeNull()
  })
})

describe('queue reorder — funnels through handleQueueSave', () => {
  it('handleReorderQueue calls handleQueueSave with the reordered queue', () => {
    const match = src.match(
      /const handleReorderQueue = useCallback\([\s\S]*?handleQueueSave\(/
    )
    expect(match).not.toBeNull()
  })

  it('handleReorderQueue updates local queue state optimistically', () => {
    const match = src.match(
      /const handleReorderQueue = useCallback\([\s\S]*?setQueue\(next\)/
    )
    expect(match).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 8. Queue handlers — no legacy routes
// ---------------------------------------------------------------------------

describe('queue handlers — never call legacy queue endpoints', () => {
  it('does not reference /api/draft/queue (legacy form)', () => {
    // The only queue fetch must be under /api/leagues/
    const legacyQueueRe = /fetch\(['"`]\/api\/draft\/queue['"`]/
    expect(src).not.toMatch(legacyQueueRe)
  })

  it('does not reference DraftRoomUserQueue', () => {
    expect(src).not.toMatch(/DraftRoomUserQueue/)
  })

  it('all queue fetch calls are under /api/leagues/', () => {
    // Every fetch to .../draft/queue should be /api/leagues/{id}/draft/queue
    const matches = [...src.matchAll(/fetch\(`[^`]*\/draft\/queue/g)]
    for (const m of matches) {
      expect(m[0]).toMatch(/\/api\/leagues\//)
    }
  })
})

// ---------------------------------------------------------------------------
// 9. initialSnapshot — pick/queue handlers do not gate on it
// ---------------------------------------------------------------------------

describe('pick and queue handlers — no initialSnapshot gate', () => {
  it('handleMakePick does not check initialSnapshot before running', () => {
    expect(makePickSrc).not.toMatch(/if.*initialSnapshot.*return/)
  })

  it('handleQueueSave does not check initialSnapshot before running', () => {
    expect(queueSaveSrc).not.toMatch(/if.*initialSnapshot.*return/)
  })
})

// ---------------------------------------------------------------------------
// Regression locks: hook imports survive this commit
// ---------------------------------------------------------------------------

describe('DraftRoomPageClient — hook regression locks', () => {
  it('still imports and calls useLiveDraftSync', () => {
    expect(src).toMatch(/from '@\/hooks\/useLiveDraftSync'/)
    expect(src).toMatch(/useLiveDraftSync\(/)
  })

  it('still imports and calls useCommissionerActions', () => {
    expect(src).toMatch(/from '@\/hooks\/useCommissionerActions'/)
    expect(src).toMatch(/useCommissionerActions\(/)
  })

  it('still imports and mounts AutopickMeToggle', () => {
    expect(src).toMatch(/AutopickMeToggle/)
    expect(src).toMatch(/viewerAutopick=\{session\.viewerAutopick\}/)
  })
})
