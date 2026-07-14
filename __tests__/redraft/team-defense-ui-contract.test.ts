/**
 * Team Defense / ST — browser/UI contract (G8 verification), deterministic.
 *
 * Proves the user-facing truths we can assert without a live authenticated
 * browser: DEF/ST scoring categories are present in BOTH the engine config (what
 * actually scores) and the commissioner UI catalog (what displays); synthetic
 * `nfl:def:<ABBR>` ids never leak as display names; and — critically — it LOCKS
 * the discovered residual that the prominent NFL scoring panel writes a different
 * key namespace than the engine reads (so a commissioner DEF override there does
 * not change scored points). See docs/redraft-commissioner-scoring-contract.md
 * §G8 UI residuals + e2e/g8-team-defense-browser.spec.ts (opt-in Playwright).
 */
import { describe, expect, it } from 'vitest'
import { getScoringCategories } from '@/lib/sportConfig'
import { NFL_SCORING_CATEGORIES } from '@/lib/nfl-scoring/NflScoringCategories'
import {
  formatNflTeamDefenseName,
  isRawTeamDefenseId,
  teamDefenseDisplayNameFromId,
  safeTeamDefenseDisplayName,
} from '@/lib/redraft/teamDefenseIdentity'
import { bridgeScoringKey } from '@/lib/nfl-scoring/scoringKeyBridge'
import { resolveDisplayPlayer } from '@/lib/player-data/adapters/redraftDisplayPlayers'

const engineKeys = new Set(getScoringCategories('NFL', []).map((c) => c.key))
const uiKeys = new Set(NFL_SCORING_CATEGORIES.flatMap((c) => c.rows.map((r) => r.key)))

describe('G8 UI — DEF/ST categories exist in the ENGINE config (what scores)', () => {
  it('exposes every team-defense category the editor binds to sportConfig.categoryPoints', () => {
    for (const key of ['def_sack', 'def_int', 'def_fr', 'def_safety', 'def_blk_kick', 'def_td', 'def_st_td', 'def_pa_0', 'def_pa_35_plus', 'def_ya_450_plus']) {
      expect(engineKeys.has(key)).toBe(true)
    }
  })
})

describe('G8 UI — DEF/ST categories DISPLAY in the commissioner panel catalog', () => {
  it('the NFL scoring UI has a Team Defense + Special Teams tab with the key DST stats', () => {
    const ids = new Set(NFL_SCORING_CATEGORIES.map((c) => c.id))
    expect(ids.has('team_defense')).toBe(true)
    expect(ids.has('special_teams')).toBe(true)
    for (const key of ['dst_sack', 'dst_interception', 'dst_fumble_recovery', 'dst_safety', 'dst_blocked_kick', 'dst_td', 'dst_pa_0', 'dst_pa_35_plus']) {
      expect(uiKeys.has(key)).toBe(true)
    }
  })
})

describe('G8/R1 — panel keys are distinct namespaces but now BRIDGED to the engine', () => {
  it('the UI uses dst_*/passing_* keys; the bridge maps them to the engine def_*/pass_* keys it reads', () => {
    // The catalogs are still distinct namespaces (UI dst_*, engine def_*)…
    expect(uiKeys.has('def_sack')).toBe(false)
    expect(engineKeys.has('dst_sack')).toBe(false)
    // …but R1 added a bridge so a panel save writes the engine store. Every UI DEF
    // key now maps to a real engine category key (no longer cosmetic-only).
    for (const [uiKey, engineKey] of [
      ['dst_sack', 'def_sack'],
      ['dst_interception', 'def_int'],
      ['dst_fumble_recovery', 'def_fr'],
      ['dst_safety', 'def_safety'],
      ['dst_blocked_kick', 'def_blk_kick'],
      ['dst_td', 'def_td'],
      ['dst_pa_7_13', 'def_pa_7_13'],
      ['passing_td', 'pass_td'],
    ] as const) {
      expect(bridgeScoringKey(uiKey)).toBe(engineKey)
      expect(engineKeys.has(engineKey)).toBe(true)
    }
  })
})

describe('G8 UI — synthetic nfl:def ids never leak as display names', () => {
  it('formats a readable team-defense name', () => {
    expect(formatNflTeamDefenseName('KC')).toBe('KC Defense')
    expect(formatNflTeamDefenseName('jac')).toBe('JAX Defense') // alias-normalized
    expect(formatNflTeamDefenseName(null)).toBe('Team Defense')
  })
  it('detects and converts a raw nfl:def id', () => {
    expect(isRawTeamDefenseId('nfl:def:KC')).toBe(true)
    expect(isRawTeamDefenseId('Patrick Mahomes')).toBe(false)
    expect(teamDefenseDisplayNameFromId('nfl:def:GB')).toBe('GB Defense')
    expect(teamDefenseDisplayNameFromId('12345')).toBeNull()
  })
  it('safeTeamDefenseDisplayName never returns the raw id', () => {
    expect(safeTeamDefenseDisplayName('nfl:def:KC', 'KC Defense')).toBe('KC Defense')
    // Stored name accidentally IS the raw id → fall back to a readable name.
    expect(safeTeamDefenseDisplayName('nfl:def:KC', 'nfl:def:KC')).toBe('KC Defense')
    expect(isRawTeamDefenseId(safeTeamDefenseDisplayName('nfl:def:BUF', null))).toBe(false)
    expect(safeTeamDefenseDisplayName('nfl:def:BUF', null)).toBe('BUF Defense')
  })

  it('roster serialization fallback: a DEF id wins over a placeholder/blank fullName', () => {
    // The normalized-player foundation has no entry for a synthetic team defense,
    // so it returns a placeholder fullName — the canonical id name must still win.
    expect(safeTeamDefenseDisplayName('nfl:def:KC', 'Player KC')).toBe('KC Defense')
    expect(safeTeamDefenseDisplayName('nfl:def:GB', '')).toBe('GB Defense')
    expect(safeTeamDefenseDisplayName('nfl:def:jac', 'Player jac')).toBe('JAX Defense') // alias-normalized
  })

  it('roster serialization fallback: offensive players are never renamed/fabricated', () => {
    expect(safeTeamDefenseDisplayName('12345', 'Patrick Mahomes')).toBe('Patrick Mahomes')
    expect(safeTeamDefenseDisplayName('e2e-xyz', 'Player abc')).toBe('Player abc') // unknown stays placeholder
    expect(safeTeamDefenseDisplayName('12345', '')).toBe('') // blank stays blank (no "Team Defense")
  })
})

describe('G8 UI — resolveDisplayPlayer renders a team defense from the id when the foundation has no row', () => {
  it('a synthetic nfl:def id resolves to a readable name + DEF position with no normalized entry', () => {
    // The normalized-player foundation returns no row for synthetic team
    // defenses, so the display map is empty for them. The id alone must still
    // produce a readable name — reusable across every league concept/surface.
    const r = resolveDisplayPlayer('nfl:def:KC', {})
    expect(r.name).toBe('KC Defense')
    expect(r.position).toBe('DEF')
    expect(r.name.startsWith('nfl:def:')).toBe(false)
  })

  it('alias-normalizes the team abbreviation (jac → JAX)', () => {
    expect(resolveDisplayPlayer('nfl:def:jac', {}).name).toBe('JAX Defense')
  })

  it('an unknown offensive id stays a neutral placeholder (never fabricated)', () => {
    const r = resolveDisplayPlayer('1234567', {})
    expect(r.name).toBe('Player 4567')
    expect(r.position).toBe('')
  })

  it('a present normalized entry always wins over the id-derived fallback', () => {
    const r = resolveDisplayPlayer('nfl:def:KC', {
      'nfl:def:KC': { id: 'nfl:def:KC', name: 'Kansas City Chiefs DST', position: 'DEF', team: 'KC' },
    })
    expect(r.name).toBe('Kansas City Chiefs DST')
  })
})
