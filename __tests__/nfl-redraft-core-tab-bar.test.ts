/**
 * NFL redraft core dashboard — tab-bar regression lock.
 *
 * The NFL redraft shell leads with the core tabs:
 *   Home / Draft / Roster / Matchups / Schedule / Players / Waivers / Trades /
 *   Standings / League Chat, plus commissioner-only Commissioner + Settings tabs.
 * The exported NFL_REDRAFT_CORE_TAB_IDS pins that visible order.
 *
 * History, AI Coaching, Redraft, Trend, and Finance must NOT appear in the
 * primary tab bar for these leagues. Settings is also reachable via the
 * header gear (data-testid="league-header-settings"), which stays available
 * regardless of the commissioner Settings tab.
 *
 * Three independent guards in LeagueShell.tsx keep the bar clean:
 *   1. The nflRedraftCore branch in tabDefs returns BEFORE the generic
 *      `withSettings` append path runs.
 *   2. The ?view=settings / ?tab=settings deep-link normalizer is blocked
 *      when nflRedraftCore is true.
 *   3. An effect resets activeTab back to a valid tabDefs.id if it drifts.
 *
 * This file is a static-source regression lock — it does not render the
 * shell. JSDOM-rendering LeagueShell would pull in the full league context
 * tree; the source-level invariants are the contract.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { NFL_REDRAFT_CORE_TAB_IDS } from '@/app/league/[leagueId]/LeagueTabs'

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('NFL redraft core — exported tab ID list', () => {
  it('NFL_REDRAFT_CORE_TAB_IDS is exactly the visible redraft tabs in order', () => {
    expect([...NFL_REDRAFT_CORE_TAB_IDS]).toEqual([
      'home',
      'draft',
      'roster',
      'matchups',
      'schedule',
      'players',
      'waivers',
      'trades',
      'standings',
      'league_chat',
      'commissioner',
    ])
  })
})

describe('NFL redraft core — LeagueShell tabDefs branch', () => {
  const src = read('app/league/[leagueId]/LeagueShell.tsx')

  /**
   * Slice the `if (nflRedraftCore)` block. The branch must:
   *   - sit at the top of the tabDefs useMemo
   *   - declare `core` with exactly the visible redraft tabs in order
   *   - return localizeLeagueTabs(core, t) before the generic sport-tabs path
   */
  const branchStart = src.indexOf('if (nflRedraftCore) {')
  const branchEnd = branchStart >= 0 ? src.indexOf('return localizeLeagueTabs(core, t)', branchStart) : -1
  const branch = branchStart >= 0 && branchEnd > branchStart ? src.slice(branchStart, branchEnd + 50) : ''

  it('the nflRedraftCore branch exists in the tabDefs useMemo', () => {
    expect(branchStart).toBeGreaterThan(0)
    expect(branchEnd).toBeGreaterThan(branchStart)
  })

  it('declares the core tabs in the canonical Phase 1 order', () => {
    // Order matters — the tab bar reads left-to-right.
    const orderRegex =
      /\{\s*id:\s*'home'[^}]*\}[\s\S]*?\{\s*id:\s*'draft'[^}]*\}[\s\S]*?\{\s*id:\s*'roster'[^}]*\}[\s\S]*?\{\s*id:\s*'matchups'[^}]*\}[\s\S]*?\{\s*id:\s*'schedule'[^}]*\}[\s\S]*?\{\s*id:\s*'players'[^}]*\}[\s\S]*?\{\s*id:\s*'waivers'[^}]*\}[\s\S]*?\{\s*id:\s*'trades'[^}]*\}[\s\S]*?\{\s*id:\s*'standings'[^}]*\}[\s\S]*?\{\s*id:\s*'league_chat'[^}]*\}/
    expect(branch).toMatch(orderRegex)
  })

  it('returns localizeLeagueTabs(core, t) so the branch exits before the generic path', () => {
    expect(branch).toMatch(/return localizeLeagueTabs\(core, t\)/)
  })

  it('does NOT inject hidden generic tabs into the nflRedraftCore branch', () => {
    // Each forbidden id, when present in the branch, would surface as a
    // primary tab — defeating the compact redraft shell. (War Room / AF Legacy
    // now lives in the draft-room dock, not the league tab bar.)
    const forbidden = ['history', 'ai_coaching', 'redraft', 'trend', 'finance']
    for (const id of forbidden) {
      const re = new RegExp(`id:\\s*'${id}'`)
      expect(branch, `forbidden tab id '${id}' leaked into the nflRedraftCore branch`).not.toMatch(re)
    }
  })

  it('only exposes the Settings tab in the redraft branch behind an isCommissioner gate', () => {
    // Settings is no longer gear-only: commissioners get a Settings tab. But it
    // must stay commissioner-gated — a non-commissioner redraft member must not
    // see it. Lock that the only `id: 'settings'` in the branch is the gated push.
    const settingsCount = (branch.match(/id:\s*'settings'/g) ?? []).length
    expect(settingsCount).toBe(1)
    expect(branch).toMatch(/if \(isCommissioner\) core\.push\(\{ id: 'settings'/)
  })

  it('the generic withSettings append path (non-redraft branch) lives AFTER the redraft return', () => {
    // The generic path adds `{ id: 'settings', label: '⚙ Settings' }` to every
    // non-redraft sport tab list. If this append moves above the redraft
    // branch's return, the redraft bar would inherit it — regression guard.
    // (The redraft branch has its own commissioner-gated settings push, so use
    // the LAST occurrence to locate the generic append.)
    const genericSettingsIdx = src.lastIndexOf("{ id: 'settings', label: 'Settings' }")
    expect(genericSettingsIdx).toBeGreaterThan(branchEnd)
  })
})

describe('NFL redraft core — deep-link blocker', () => {
  const src = read('app/league/[leagueId]/LeagueShell.tsx')

  it('blocks ?view=settings / ?tab=settings when nflRedraftCore is true', () => {
    // The normalizer maps `?view=...` and `?tab=...` to a tab id. For the
    // redraft shell, settings has no tab — the early return below stops
    // setActiveTab('settings') from ever firing.
    expect(src).toMatch(/if \(target === 'settings' && nflRedraftCore\) return/)
  })

  it('only fires setActiveTab when the resolved target id is in tabDefs', () => {
    // Belt-and-suspenders: even if a non-settings deep link mapped to an id
    // not in the redraft tabDefs, the gate below skips the setActiveTab call.
    // Without this, history/ai_coaching/etc. could render.
    expect(src).toMatch(/if \(ids\.has\(target\)\) setActiveTab\(target\)/)
  })

  it('resets activeTab back to a valid tabDefs.id if it drifts', () => {
    // After tabDefs recomputes (e.g. variant change, in-season toggle), any
    // stale `activeTab` like 'settings' is forced back to tabDefs[0]. This
    // is what guarantees a fresh load can never land on a hidden tab.
    expect(src).toMatch(/setActiveTab\(\(prev\) => \(ids\.has\(prev\) \? prev : tabDefs\[0\]\?\.id \?\? 'draft'\)\)/)
  })
})

describe('NFL redraft core — settings gear stays available', () => {
  const src = read('app/league/[leagueId]/LeagueShell.tsx')

  it('header settings gear renders unconditionally with the canonical testid', () => {
    // Phase 1 hides the Settings tab but keeps the gear — the gear is the
    // only entry point to settings/commissioner/history/audit-log content
    // for NFL redraft. If this testid ever moves or becomes conditional on
    // nflRedraftCore, both the dashboard test harness and this regression
    // lock break loudly.
    expect(src).toMatch(/data-testid="league-header-settings"/)
  })

  it('the gear button has no nflRedraftCore visibility gate', () => {
    // Find the gear button block (around the settings testid) and assert it
    // is not wrapped in a `{!nflRedraftCore && (...)}` or similar guard.
    const gearIdx = src.indexOf('data-testid="league-header-settings"')
    expect(gearIdx).toBeGreaterThan(0)
    // Look back ~600 chars for any conditional render the gear sits under.
    const window = src.slice(Math.max(0, gearIdx - 600), gearIdx)
    expect(window).not.toMatch(/!nflRedraftCore\s*&&/)
    expect(window).not.toMatch(/nflRedraftCore\s*\?\s*null/)
  })
})
