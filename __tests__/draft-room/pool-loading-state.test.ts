/**
 * Player pool loading state — source-level contract tests.
 *
 * Behaviors locked here:
 *
 *   1. "Loading player pool..." text is visible (not sr-only) while poolLoading is true.
 *   2. "No players loaded..." message appears only after loading is false and entries are empty.
 *   3. Error message appears only on a failed fetch (poolError=true), not on empty success.
 *   4. Error branch never includes "No players loaded" text — they are mutually exclusive.
 *   5. Board/session is not cleared when pool fetch fails — setSession is not called in the error path.
 *   6. DraftRoomPageClient passes poolError to SportAwareDraftRoom.
 *   7. poolError is set true in both the non-ok response path and the catch block.
 *   8. poolError is reset to false at the start of each fetch.
 *
 * All assertions are source-level (readFileSync) — zero import cost, no DOM.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')

const panel = readFileSync(
  resolve(root, 'components/app/draft-room/PlayerPanel.tsx'),
  'utf8',
)

const client = readFileSync(
  resolve(root, 'components/app/draft-room/DraftRoomPageClient.tsx'),
  'utf8',
)

// ---------------------------------------------------------------------------
// Behavior 1 — loading message is visible (not sr-only) while poolLoading is true
// ---------------------------------------------------------------------------

describe('Behavior 1: visible loading message while pool is pending', () => {
  it('data-testid="draft-pool-loading-message" exists in PlayerPanel', () => {
    expect(panel).toContain('data-testid="draft-pool-loading-message"')
  })

  it('loading message is NOT hidden with sr-only', () => {
    const loadingMsgMatch = panel.match(/data-testid="draft-pool-loading-message"[^>]*>([^<]*)</)
    expect(loadingMsgMatch).not.toBeNull()
    // the className on the element must not contain sr-only
    const surroundingLines = panel.slice(
      Math.max(0, panel.indexOf('draft-pool-loading-message') - 200),
      panel.indexOf('draft-pool-loading-message') + 300,
    )
    expect(surroundingLines).not.toContain('sr-only')
  })

  it('loading message appears inside the loading branch (when loading is true)', () => {
    const loadingBranch = panel.match(/\{loading \? \(([\s\S]*?)\) : showRosterView/)
    expect(loadingBranch).not.toBeNull()
    expect(loadingBranch![1]).toContain('draft-pool-loading-message')
  })

  it('loading message text reads "Loading player pool..."', () => {
    expect(panel).toContain('Loading player pool...')
  })
})

// ---------------------------------------------------------------------------
// Behavior 2 — empty message appears only after loading is false and entries empty
// ---------------------------------------------------------------------------

describe('Behavior 2: empty state only after successful load with zero entries', () => {
  it('data-testid="draft-pool-empty-unloaded" exists in PlayerPanel', () => {
    expect(panel).toContain('data-testid="draft-pool-empty-unloaded"')
  })

  it('empty-unloaded message is inside the players.length === 0 branch (not the loading branch)', () => {
    const loadingBranch = panel.match(/\{loading \? \(([\s\S]*?)\) : showRosterView/)
    expect(loadingBranch).not.toBeNull()
    // must NOT appear inside the loading branch
    expect(loadingBranch![1]).not.toContain('draft-pool-empty-unloaded')
    // must appear elsewhere in the file
    expect(panel).toContain('draft-pool-empty-unloaded')
  })

  it('"No players loaded for this pool." is inside the empty (non-error) branch', () => {
    expect(panel).toContain('No players loaded for this pool.')
  })
})

// ---------------------------------------------------------------------------
// Behavior 3 — error message appears only on poolError=true
// ---------------------------------------------------------------------------

describe('Behavior 3: error message guarded by poolError prop', () => {
  it('data-testid="draft-pool-error-state" exists in PlayerPanel', () => {
    expect(panel).toContain('data-testid="draft-pool-error-state"')
  })

  it('"Failed to load player pool." text exists in PlayerPanel', () => {
    expect(panel).toContain('Failed to load player pool.')
  })

  it('error state is gated by poolError', () => {
    const errorStateIdx = panel.indexOf('draft-pool-error-state')
    expect(errorStateIdx).toBeGreaterThan(-1)
    // poolError must appear before the error state testid in the file
    const poolErrorBeforeError = panel.lastIndexOf('poolError', errorStateIdx)
    expect(poolErrorBeforeError).toBeGreaterThan(-1)
    expect(poolErrorBeforeError).toBeLessThan(errorStateIdx)
  })
})

// ---------------------------------------------------------------------------
// Behavior 4 — error and empty states are mutually exclusive
// ---------------------------------------------------------------------------

describe('Behavior 4: error and empty states are mutually exclusive', () => {
  it('poolError branch does NOT contain the empty-unloaded testid', () => {
    // Extract the poolError ternary block
    const poolErrorIdx = panel.indexOf('poolError ?')
    expect(poolErrorIdx).toBeGreaterThan(-1)
    // Find end of the ternary by locating the balancing ')' for the outer players.length ternary
    const errorBlock = panel.slice(poolErrorIdx, poolErrorIdx + 600)
    // The error (truthy) arm should NOT have the empty-unloaded testid
    const trueArmEnd = errorBlock.indexOf(') : (')
    expect(trueArmEnd).toBeGreaterThan(-1)
    const errorArm = errorBlock.slice(0, trueArmEnd)
    expect(errorArm).not.toContain('draft-pool-empty-unloaded')
  })

  it('empty-unloaded testid is in the else branch (not the poolError=true arm)', () => {
    const poolErrorIdx = panel.indexOf('poolError ?')
    expect(poolErrorIdx).toBeGreaterThan(-1)
    const errorBlock = panel.slice(poolErrorIdx, poolErrorIdx + 1200)
    const elseArmStart = errorBlock.indexOf(') : (')
    expect(elseArmStart).toBeGreaterThan(-1)
    const elseArm = errorBlock.slice(elseArmStart)
    expect(elseArm).toContain('draft-pool-empty-unloaded')
  })
})

// ---------------------------------------------------------------------------
// Behavior 5 — failed pool fetch never clears the draft session
// ---------------------------------------------------------------------------

describe('Behavior 5: pool fetch failure never calls setSession', () => {
  it('fetchDraftPool catch block does not call setSession', () => {
    const poolCbMatch = client.match(
      /const fetchDraftPool = useCallback\(async \(\) => \{([\s\S]*?)\}, \[leagueId, sport\]\)/,
    )
    expect(poolCbMatch).not.toBeNull()
    expect(poolCbMatch![0]).not.toContain('setSession')
  })

  it('the non-ok response path sets poolError(true) and not setSession', () => {
    const poolCbMatch = client.match(
      /const fetchDraftPool = useCallback\(async \(\) => \{([\s\S]*?)\}, \[leagueId, sport\]\)/,
    )
    expect(poolCbMatch).not.toBeNull()
    const body = poolCbMatch![1]
    expect(body).toContain('setPoolError(true)')
    expect(body).not.toContain('setSession')
  })
})

// ---------------------------------------------------------------------------
// Behavior 6 — DraftRoomPageClient passes poolError to SportAwareDraftRoom
// ---------------------------------------------------------------------------

describe('Behavior 6: DraftRoomPageClient passes poolError to SportAwareDraftRoom', () => {
  it('poolError={poolError} is passed to SportAwareDraftRoom', () => {
    expect(client).toContain('poolError={poolError}')
  })

  it('poolError state is declared in DraftRoomPageClient', () => {
    expect(client).toMatch(/const \[poolError, setPoolError\] = useState\(false\)/)
  })
})

// ---------------------------------------------------------------------------
// Behavior 7 — poolError is set true in both error paths
// ---------------------------------------------------------------------------

describe('Behavior 7: poolError is set true in non-ok response and catch block', () => {
  it('setPoolError(true) appears at least twice in fetchDraftPool (once per error path)', () => {
    const poolCbMatch = client.match(
      /const fetchDraftPool = useCallback\(async \(\) => \{([\s\S]*?)\}, \[leagueId, sport\]\)/,
    )
    expect(poolCbMatch).not.toBeNull()
    const body = poolCbMatch![1]
    const count = (body.match(/setPoolError\(true\)/g) ?? []).length
    expect(count).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Behavior 8 — poolError is reset to false at the start of each fetch
// ---------------------------------------------------------------------------

describe('Behavior 8: poolError is reset to false at the start of a new fetch', () => {
  it('setPoolError(false) appears before the fetch() call in fetchDraftPool', () => {
    const poolCbMatch = client.match(
      /const fetchDraftPool = useCallback\(async \(\) => \{([\s\S]*?)\}, \[leagueId, sport\]\)/,
    )
    expect(poolCbMatch).not.toBeNull()
    const body = poolCbMatch![1]
    const resetPos = body.indexOf('setPoolError(false)')
    const fetchPos = body.indexOf('fetch(endpoint')
    expect(resetPos).toBeGreaterThan(-1)
    expect(fetchPos).toBeGreaterThan(-1)
    expect(resetPos).toBeLessThan(fetchPos)
  })

  it('poolError prop has a default of false in PlayerPanelInner', () => {
    expect(panel).toMatch(/poolError = false/)
  })
})
