/**
 * Phase 3 — NFL redraft draft-room smoke coverage.
 *
 * Repeatable, DB-free coverage for the draft-room readiness path so it cannot
 * silently break:
 *
 *  A. Pure readiness gate (resolveDraftPoolLoadingState):
 *     - "Preparing player pool..." appears ONLY while data is loading & cold.
 *     - Generic loading copy once a (warm) fetch is in flight.
 *     - Neither message once normalized entries have arrived.
 *     - Start-draft is blocked while the pool is empty/not ready.
 *
 *  B. Clear failure output (diagnoseDraftPoolPayload):
 *     - Missing / malformed / empty / stale pools fail loudly with a reason.
 *     - A normalized NFL pool passes clean.
 *
 *  C. Source-level invariants that lock the wiring into the live draft room:
 *     - /drafts/[draftId] seeds the pool readiness + fires background prewarm.
 *     - DraftRoomPageClient renders the gate via the pure helper.
 *     - Normalized player fields (name/team/position/headshot/projection) are
 *       read from the resolver-provided entry where available.
 *     - Reload persistence: the page is force-dynamic and seeds an initial
 *       snapshot server-side (no client-only state that a refresh would lose).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  diagnoseDraftPoolPayload,
  resolveDraftPoolLoadingState,
  LOADING_POOL_MESSAGE,
  PREPARING_POOL_MESSAGE,
} from '@/lib/draft-room/draftPoolReadinessState'

const root = resolve(__dirname, '..', '..')

// ---------------------------------------------------------------------------
// Fixtures — a realistic normalized NFL redraft pool entry
// ---------------------------------------------------------------------------

function nflEntry(overrides: Record<string, unknown> = {}) {
  return {
    playerId: 'nfl-00-0033873',
    name: 'Patrick Mahomes',
    position: 'QB',
    team: 'KC',
    adp: 12.4,
    byeWeek: 6,
    display: {
      playerId: 'nfl-00-0033873',
      displayName: 'Patrick Mahomes',
      metadata: { position: 'QB', teamAbbreviation: 'KC', byeWeek: 6 },
      media: { headshotUrl: 'https://cdn/mahomes.png', teamLogoUrl: 'https://cdn/kc.png' },
      stats: { adp: 12.4, projectedPoints: 384.2 },
    },
    ...overrides,
  }
}

function nflPool(count = 3) {
  return {
    sport: 'NFL',
    count,
    entries: Array.from({ length: count }, (_, i) =>
      nflEntry({ playerId: `nfl-p${i}`, name: `Player ${i}`, display: { ...nflEntry().display, playerId: `nfl-p${i}`, displayName: `Player ${i}` } }),
    ),
  }
}

// ---------------------------------------------------------------------------
// A. Pure readiness gate
// ---------------------------------------------------------------------------

describe('resolveDraftPoolLoadingState — "Preparing player pool" appears only while loading (req #4)', () => {
  it('shows "Preparing player pool..." when cold (not ready) and nothing has arrived', () => {
    const state = resolveDraftPoolLoadingState({
      draftPool: null,
      poolFetching: true,
      poolReadiness: { ready: false },
      canStart: true,
    })
    expect(state.poolLoading).toBe(true)
    expect(state.showPreparingPool).toBe(true)
    expect(state.poolLoadingMessage).toBe(PREPARING_POOL_MESSAGE)
    expect(state.startDraftBlocked).toBe(true)
  })

  it('shows generic loading copy when fetching but readiness is warm/unknown', () => {
    const warm = resolveDraftPoolLoadingState({
      draftPool: null,
      poolFetching: true,
      poolReadiness: { ready: true },
      canStart: true,
    })
    expect(warm.poolLoadingMessage).toBe(LOADING_POOL_MESSAGE)
    expect(warm.showPreparingPool).toBe(false)

    const unknown = resolveDraftPoolLoadingState({
      draftPool: null,
      poolFetching: true,
      poolReadiness: null,
      canStart: true,
    })
    expect(unknown.poolLoadingMessage).toBe(LOADING_POOL_MESSAGE)
    expect(unknown.showPreparingPool).toBe(false)
  })

  it('stops showing loading copy and unblocks start once normalized entries arrive (req #5)', () => {
    const state = resolveDraftPoolLoadingState({
      draftPool: nflPool(120),
      poolFetching: false,
      poolReadiness: { ready: true },
      canStart: true,
    })
    expect(state.poolLoading).toBe(false)
    expect(state.showPreparingPool).toBe(false)
    expect(state.startDraftBlocked).toBe(false)
  })

  it('keeps start blocked when the arrived pool has zero entries', () => {
    const state = resolveDraftPoolLoadingState({
      draftPool: { entries: [] },
      poolFetching: false,
      poolReadiness: { ready: true },
      canStart: true,
    })
    expect(state.startDraftBlocked).toBe(true)
  })

  it('never blocks start for a non-commissioner viewer regardless of pool state', () => {
    const state = resolveDraftPoolLoadingState({
      draftPool: null,
      poolFetching: true,
      poolReadiness: { ready: false },
      canStart: false,
    })
    expect(state.startDraftBlocked).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// B. Clear failure output for missing / malformed / stale pools (req #10)
// ---------------------------------------------------------------------------

describe('diagnoseDraftPoolPayload — clear failure output (req #10)', () => {
  it('flags a missing pool as blocking', () => {
    const d = diagnoseDraftPoolPayload(null)
    expect(d.ok).toBe(false)
    expect(d.reason).toBe('missing')
    expect(d.severity).toBe('blocking')
    expect(d.message).toMatch(/missing/i)
  })

  it('flags a non-object payload as malformed', () => {
    const d = diagnoseDraftPoolPayload('not-a-pool')
    expect(d.reason).toBe('malformed')
    expect(d.severity).toBe('blocking')
  })

  it('flags a payload whose entries is not an array as malformed', () => {
    const d = diagnoseDraftPoolPayload({ entries: { 0: nflEntry() } })
    expect(d.reason).toBe('malformed')
    expect(d.message).toMatch(/entries/i)
  })

  it('flags an empty pool as blocking with 0 players', () => {
    const d = diagnoseDraftPoolPayload({ entries: [] })
    expect(d.reason).toBe('empty')
    expect(d.entryCount).toBe(0)
    expect(d.message).toMatch(/0 players/i)
  })

  it('flags entries missing both name and id as malformed and counts them', () => {
    const d = diagnoseDraftPoolPayload({ entries: [nflEntry(), { adp: 1 }, { foo: 'bar' }] })
    expect(d.reason).toBe('malformed')
    expect(d.message).toMatch(/2\/3/)
  })

  it('flags a pool synced beyond max age as stale (warning, still usable)', () => {
    const now = Date.parse('2026-06-25T00:00:00Z')
    const syncedAt = '2026-06-23T00:00:00Z' // 48h old
    const d = diagnoseDraftPoolPayload(nflPool(50), {
      readiness: { ready: true, syncedAt },
      maxAgeMs: 24 * 60 * 60 * 1000,
      now,
    })
    expect(d.reason).toBe('stale')
    expect(d.severity).toBe('warning')
    expect(d.message).toMatch(/stale/i)
  })

  it('passes a fresh normalized NFL pool clean', () => {
    const now = Date.parse('2026-06-25T00:00:00Z')
    const d = diagnoseDraftPoolPayload(nflPool(180), {
      readiness: { ready: true, syncedAt: '2026-06-24T22:00:00Z' },
      now,
    })
    expect(d.ok).toBe(true)
    expect(d.reason).toBe('ok')
    expect(d.entryCount).toBe(180)
  })

  it('accepts entries identified only by display.displayName (no top-level name)', () => {
    const entry = { display: { displayName: 'Justin Jefferson', playerId: 'nfl-x' } }
    const d = diagnoseDraftPoolPayload({ entries: [entry] })
    expect(d.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// C. Source-level invariants — lock the wiring into the live draft room
// ---------------------------------------------------------------------------

const pageSrc = readFileSync(resolve(root, 'app/drafts/[draftId]/page.tsx'), 'utf8')
const clientSrc = readFileSync(
  resolve(root, 'components/app/draft-room/DraftRoomPageClient.tsx'),
  'utf8',
)

describe('/drafts/[draftId] — pool readiness seeding + prewarm (reqs #3, #4, #9)', () => {
  it('checks the pool cache fast and seeds initialPoolReadiness into the board', () => {
    expect(pageSrc).toMatch(/checkDraftPoolCacheFast\(/)
    expect(pageSrc).toMatch(/initialPoolReadiness=\{\{/)
    expect(pageSrc).toMatch(/ready:\s*poolCacheResult\.warm/)
  })

  it('fires a background prewarm when the pool cache is cold', () => {
    expect(pageSrc).toMatch(/if \(!poolCacheResult\.warm\)/)
    expect(pageSrc).toMatch(/triggerDraftPoolPrewarmBackground\(context\.leagueId\)/)
  })

  it('is force-dynamic and seeds a server-built snapshot so reload keeps draft state (req #9)', () => {
    expect(pageSrc).toMatch(/export const dynamic = 'force-dynamic'/)
    expect(pageSrc).toMatch(/buildSessionSnapshot\(/)
    expect(pageSrc).toMatch(/initialSnapshot=\{initialSnapshot\}/)
  })
})

describe('DraftRoomPageClient — loading gate rendered via the pure helper (req #4)', () => {
  it('imports and uses resolveDraftPoolLoadingState instead of inline gating', () => {
    expect(clientSrc).toMatch(/from '@\/lib\/draft-room\/draftPoolReadinessState'/)
    expect(clientSrc).toMatch(/resolveDraftPoolLoadingState\(\{/)
  })

  it('does not keep a duplicate inline "Preparing player pool" ternary', () => {
    const inline = clientSrc.match(/poolReadiness\?\.ready === false\s*\n\s*\?\s*'Preparing player pool/)
    expect(inline).toBeNull()
  })

  it('renders the resolved poolLoadingMessage', () => {
    expect(clientSrc).toMatch(/poolLoadingMessage/)
  })
})

describe('DraftRoomPageClient — normalized player fields preferred (reqs #6)', () => {
  it('reads name/position/team from resolver entry with display fallbacks', () => {
    expect(clientSrc).toMatch(/e\.name \?\? e\.display\?\.displayName/)
    expect(clientSrc).toMatch(/e\.position \?\? e\.display\?\.metadata\?\.position/)
    expect(clientSrc).toMatch(/e\.team \?\? e\.display\?\.metadata\?\.teamAbbreviation/)
  })

  it('prefers the normalized pool when entries are present', () => {
    expect(clientSrc).toMatch(/Array\.isArray\(draftPool\?\.entries\) && draftPool\.entries\.length > 0/)
  })
})
