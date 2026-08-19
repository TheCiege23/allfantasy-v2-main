import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { shouldApplyIncomingView } from '@/lib/league/leagueTabSync'

/**
 * Regression for the Draft/League flicker.
 *
 * Root cause: LeagueShell holds `activeTab` in state AND mirrors it to `?view=` (tab->URL effect),
 * while a second effect reads `?view=` back into `activeTab` (URL->tab effect). A landing effect
 * changing `activeTab` out-of-band leaves `activeTab` and `?view=` holding each other's values;
 * the two effects then swap them on every render forever.
 *
 * The model below reproduces that with the real stale-closure semantics: within one React commit,
 * the URL->tab effect's `setActiveTab` does NOT change what the tab->URL effect sees this commit
 * (both read the start-of-commit snapshot). The fix (`shouldApplyIncomingView` echo guard) is the
 * only difference between the oscillating and converging runs.
 */

type SyncState = { activeTab: string; urlView: string | null; lastSynced: string | null }

const IDS = new Set(['draft', 'matchups', 'league', 'roster', 'players'])
const MAP: Record<string, string> = { draft: 'draft', matchups: 'matchups', league: 'league', roster: 'roster', players: 'players' }

/** One React commit: URL->tab effect and tab->URL effect both read the SAME start-of-commit snapshot. */
function commit(s: SyncState, useGuard: boolean): SyncState {
  let activeTab = s.activeTab
  let urlView = s.urlView
  let lastSynced = s.lastSynced

  // URL -> tab effect (reads s.urlView, s.lastSynced)
  if (s.urlView) {
    const key = s.urlView.trim().toLowerCase()
    const apply = useGuard ? shouldApplyIncomingView(key, s.lastSynced) : Boolean(key)
    if (apply) {
      const target = MAP[key]
      if (target && IDS.has(target)) activeTab = target
    }
  }
  // tab -> URL effect (reads s.activeTab — STALE relative to the line above, like React batching)
  if (IDS.has(s.activeTab)) {
    lastSynced = s.activeTab
    if (s.urlView !== s.activeTab) urlView = s.activeTab
  }
  return { activeTab, urlView, lastSynced }
}

/** Run commits until a fixed point, or report oscillation if a state repeats without settling. */
function settle(start: SyncState, useGuard: boolean, max = 30): { final: SyncState; oscillated: boolean } {
  const seen = new Set<string>()
  let s = start
  for (let i = 0; i < max; i++) {
    const next = commit(s, useGuard)
    if (next.activeTab === s.activeTab && next.urlView === s.urlView && next.lastSynced === s.lastSynced) {
      return { final: next, oscillated: false }
    }
    const sig = `${next.activeTab}|${next.urlView}|${next.lastSynced}`
    if (seen.has(sig)) return { final: next, oscillated: true } // revisited a prior state → cycle
    seen.add(sig)
    s = next
  }
  return { final: s, oscillated: true }
}

describe('shouldApplyIncomingView (echo guard)', () => {
  it('ignores the shell’s own echo, applies external navigations', () => {
    expect(shouldApplyIncomingView('matchups', 'matchups')).toBe(false) // our own echo
    expect(shouldApplyIncomingView('roster', 'matchups')).toBe(true) // external deep-link
    expect(shouldApplyIncomingView('MATCHUPS', 'matchups')).toBe(false) // case-insensitive echo
    expect(shouldApplyIncomingView(null, 'matchups')).toBe(false)
    expect(shouldApplyIncomingView('roster', null)).toBe(true) // fresh load deep-link
  })
})

describe('Draft/League flicker — tab/URL sync state machine', () => {
  // The "crossed" seed a landing effect produces: activeTab moved to matchups, but ?view= still
  // holds the stale 'draft' the tab->URL effect wrote that same commit, and lastSynced='draft'.
  const crossedSeed: SyncState = { activeTab: 'matchups', urlView: 'draft', lastSynced: 'draft' }

  it('reproduces the oscillation WITHOUT the guard (regression proof)', () => {
    const { oscillated } = settle(crossedSeed, /* useGuard */ false)
    expect(oscillated).toBe(true)
  })

  it('draft complete / season active → League (matchups) view stays stable WITH the guard', () => {
    const { final, oscillated } = settle(crossedSeed, true)
    expect(oscillated).toBe(false)
    expect(final.activeTab).toBe('matchups')
    expect(final.urlView).toBe('matchups')
  })

  it('draft incomplete → Draft view remains stable (no oscillation)', () => {
    const { final, oscillated } = settle({ activeTab: 'draft', urlView: null, lastSynced: null }, true)
    expect(oscillated).toBe(false)
    expect(final.activeTab).toBe('draft')
    expect(final.urlView).toBe('draft')
  })

  it('user changes tab → the effect does not force it back', () => {
    // User clicked Draft while the URL still says matchups from the prior auto-landing.
    const afterUserPick: SyncState = { activeTab: 'draft', urlView: 'matchups', lastSynced: 'matchups' }
    const { final, oscillated } = settle(afterUserPick, true)
    expect(oscillated).toBe(false)
    expect(final.activeTab).toBe('draft')
  })

  it('async refresh (re-running the effects) does not oscillate a settled tab', () => {
    const settled = settle({ activeTab: 'matchups', urlView: null, lastSynced: null }, true).final
    // Simulate a searchParams identity change re-firing the effects on the settled state.
    const again = commit(settled, true)
    expect(again).toEqual(settled)
  })

  it('external deep-link/?view= is still respected on load', () => {
    const { final, oscillated } = settle({ activeTab: 'draft', urlView: 'roster', lastSynced: null }, true)
    expect(oscillated).toBe(false)
    expect(final.activeTab).toBe('roster')
  })
})

describe('LeagueShell wiring (source contract)', () => {
  const shell = readFileSync(resolve(__dirname, '..', 'app/league/[leagueId]/LeagueShell.tsx'), 'utf8')

  it('imports and uses the echo guard, and records the synced view', () => {
    expect(shell).toContain("import { shouldApplyIncomingView } from '@/lib/league/leagueTabSync'")
    expect(shell).toContain('lastSyncedViewRef')
    expect(shell).toContain('lastSyncedViewRef.current = activeTab')
    expect(shell).toMatch(/if \(!shouldApplyIncomingView\(key, lastSyncedViewRef\.current\)\) return/)
  })

  it('resets the synced-view ref on league change', () => {
    expect(shell).toContain('lastSyncedViewRef.current = null')
  })
})
