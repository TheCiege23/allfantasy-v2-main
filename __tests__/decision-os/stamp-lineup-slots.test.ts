/**
 * The lineup-slot stamp must be right or absent, never plausible.
 *
 * ── 🛑 WHAT THIS PINS ────────────────────────────────────────────────────────────────────────
 * The grounding packet resolved every starter's NAME (canonical registry, 2026-09-01) and still
 * could not say which of them was in a flex — every player carried `slot: null`. The question
 * the proof surface was asked was literally "should I start my flex".
 *
 * The fix zips the league's `roster_positions` template against the lineup by INDEX. That
 * relationship is real for Sleeper and is enforced by nothing, so the whole value of this module
 * is in its refusals. Each one below is a way the zip can be wrong while still looking fine.
 */
import { describe, expect, it } from 'vitest'

import { stampLineupSlots, starterSlotsFromRules } from '@/lib/decision-os/grounding/stampLineupSlots'

/** The real template from NFL Dynasty (8-team superflex), bench entries still attached. */
const REAL_TEMPLATE = [
  'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'SUPER_FLEX', 'K', 'DEF',
  'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN',
]

/** That league's actual starters, in the order the packet returned them. */
const REAL_STARTERS = [
  { position: 'QB', slot: null }, // Jordan Love
  { position: 'RB', slot: null }, // James Cook
  { position: 'RB', slot: null }, // Derrick Henry
  { position: 'WR', slot: null }, // DeVonta Smith
  { position: 'WR', slot: null }, // Jaxon Smith-Njigba
  { position: 'TE', slot: null }, // Jake Ferguson
  { position: 'RB', slot: null }, // Jonathan Taylor  -> FLEX
  { position: 'WR', slot: null }, // DK Metcalf       -> FLEX
  { position: 'QB', slot: null }, // Matthew Stafford -> SUPER_FLEX
  { position: 'K', slot: null }, // Cam Little
  { position: 'DEF', slot: null }, // Los Angeles Rams
]

describe('starterSlotsFromRules', () => {
  it('drops the bench tail and keeps lineup order', () => {
    expect(starterSlotsFromRules(REAL_TEMPLATE)).toEqual([
      'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'SUPER_FLEX', 'K', 'DEF',
    ])
  })

  it("🛑 refuses ESPN's SLOT:COUNT shape rather than handing out 'BE:7' as a starting slot", () => {
    // `BE:7` is not in BENCH_SLOTS, so a naive bench filter keeps it and the zip then names a
    // real starter after a bench entry. Measured on production in lib/core-app/rosterSlots.ts.
    const espn = ['QB:1', 'RB:2', 'WR:2', 'TE:1', 'D/ST:1', 'K:1', 'BE:7', 'IR:1', 'FLEX:1']
    expect(starterSlotsFromRules(espn)).toBeNull()
  })

  it('returns null for a league with no template at all', () => {
    expect(starterSlotsFromRules(null)).toBeNull()
    expect(starterSlotsFromRules([])).toBeNull()
    expect(starterSlotsFromRules('QB,RB')).toBeNull()
  })

  it('returns null when the template is bench-only', () => {
    expect(starterSlotsFromRules(['BN', 'BN', 'IR'])).toBeNull()
  })
})

describe('stampLineupSlots', () => {
  it('names both flexes and the superflex on the real roster', () => {
    const result = stampLineupSlots({
      starters: REAL_STARTERS,
      starterSlots: starterSlotsFromRules(REAL_TEMPLATE),
    })
    expect(result.stamped).toBe(true)
    if (!result.stamped) return
    expect(result.slots[6]).toBe('FLEX')
    expect(result.slots[7]).toBe('FLEX')
    expect(result.slots[8]).toBe('SUPER_FLEX')
    // Every starter corroborated its own slot — this is the check that makes the zip evidence.
    expect(result.corroborated).toBe(11)
    expect(result.unverifiable).toBe(0)
  })

  it('🛑 a QB in the superflex is ACCEPTED — the case a naive position check would reject', () => {
    // SUPER_FLEX accepts QB. A "does the player's position equal the slot name" check would call
    // Matthew Stafford ineligible and refuse to stamp the whole lineup.
    const result = stampLineupSlots({
      starters: REAL_STARTERS,
      starterSlots: starterSlotsFromRules(REAL_TEMPLATE),
    })
    expect(result.stamped).toBe(true)
  })

  it('refuses on a length mismatch instead of shifting every label after it', () => {
    const result = stampLineupSlots({
      starters: REAL_STARTERS.slice(0, 10),
      starterSlots: starterSlotsFromRules(REAL_TEMPLATE),
    })
    expect(result.stamped).toBe(false)
    if (result.stamped) return
    expect(result.reason).toContain('not in correspondence')
  })

  it('🛑 ONE bad fit voids the WHOLE stamp, not just that row', () => {
    /*
     * The point of the module. A kicker sitting in the QB index is not one odd row to skip — it
     * is proof the two arrays are not in the same order, which makes every OTHER label from the
     * same zip unreliable too. Per-row skipping would leave ten confident labels and one gap,
     * reading as "we know this lineup, one guy is weird" — the opposite of what was learned.
     */
    const shuffled = [...REAL_STARTERS]
    shuffled[0] = { position: 'K', slot: null }
    const result = stampLineupSlots({
      starters: shuffled,
      starterSlots: starterSlotsFromRules(REAL_TEMPLATE),
    })
    expect(result.stamped).toBe(false)
    if (result.stamped) return
    expect(result.reason).toContain('QB slot but holds a K')
  })

  it('an unresolved position cannot refute, so a registry miss does not suppress a good zip', () => {
    const withMiss = [...REAL_STARTERS]
    withMiss[3] = { position: null, slot: null }
    const result = stampLineupSlots({
      starters: withMiss,
      starterSlots: starterSlotsFromRules(REAL_TEMPLATE),
    })
    expect(result.stamped).toBe(true)
    if (!result.stamped) return
    expect(result.slots[3]).toBe('WR') // stamped on the strength of the other ten
    expect(result.corroborated).toBe(10)
    expect(result.unverifiable).toBe(1)
  })

  it('🛑 but ZERO corroboration is a refusal — a check that never ran is not a pass', () => {
    // Every position null: the eligibility loop completes without executing a single check.
    // Returning `stamped: true` here would be the exact green-check-that-measured-nothing shape
    // this repo keeps re-learning.
    const allNull = REAL_STARTERS.map(() => ({ position: null, slot: null }))
    const result = stampLineupSlots({
      starters: allNull,
      starterSlots: starterSlotsFromRules(REAL_TEMPLATE),
    })
    expect(result.stamped).toBe(false)
    if (result.stamped) return
    expect(result.reason).toContain('could not be corroborated')
  })

  it('refuses when the league stores no template', () => {
    const result = stampLineupSlots({ starters: REAL_STARTERS, starterSlots: null })
    expect(result.stamped).toBe(false)
    if (result.stamped) return
    expect(result.reason).toContain('no starting-slot template')
  })

  it('handles an empty lineup without claiming anything', () => {
    const result = stampLineupSlots({ starters: [], starterSlots: ['QB'] })
    expect(result.stamped).toBe(false)
  })
})

describe('the control: these assertions can actually fail', () => {
  it('a WRONG expectation is rejected, so the passes above are not vacuous', () => {
    const result = stampLineupSlots({
      starters: REAL_STARTERS,
      starterSlots: starterSlotsFromRules(REAL_TEMPLATE),
    })
    expect(result.stamped).toBe(true)
    if (!result.stamped) return
    // Index 6 is a FLEX. If the module ever returned the PLAYER's position instead of the SLOT
    // it would read 'RB' here and every other test would still pass.
    expect(result.slots[6]).not.toBe('RB')
    expect(() => expect(result.slots[6]).toBe('RB')).toThrow()
  })
})
