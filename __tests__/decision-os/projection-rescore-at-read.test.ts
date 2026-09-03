import { describe, it, expect } from 'vitest'

import { rescoreProjectionFacts, type ProjectionFact } from '@/lib/decision-os/projection/facts'

/**
 * The property that makes caching projections at APP level safe.
 *
 * `loadProjectionFacts` originally rescored inside itself, so caching its output would have stored
 * ONE league's IDP points for every league in the sport. That is the defect 1.1b spent a whole
 * change unpicking in Waiver OS and Trade OS — sources declaring `level: 'league'` while deriving
 * user-specific facts — and at app level it would have been worse, because the entry is shared by
 * everyone rather than by one league's members.
 *
 * The fix is a split: cache the canonical fact WITH its raw component amounts, and rescore at
 * read. These tests pin the half that makes it work — one stored object, two leagues, two
 * different correct answers.
 */

const base: ProjectionFact = {
  playerId: 'p1',
  playerName: 'Test Linebacker',
  sport: 'NFL',
  position: 'LB',
  season: 2026,
  week: 3,
  points: 9.06,
  storedPoints: 9.06,
  rescored: false,
  storedPreset: null,
  unscoredComponents: [],
  kickerDistanceRulesIgnored: false,
  confidenceLevel: 'medium',
  computedAt: '2026-08-31T07:50:00.000Z',
  validUntil: null,
  factors: { idp: { componentAmounts: { soloTackle: 6, assistTackle: 3, sack: 0.5 } } },
}

describe('rescoreProjectionFacts — one cached fact, many leagues', () => {
  it('🛑 gives two leagues DIFFERENT points from the SAME cached object', () => {
    const balanced = { idp_tkl_solo: 1, idp_tkl_ast: 0.5, idp_sack: 2 }
    const tackleHeavy = { idp_tkl_solo: 2, idp_tkl_ast: 1.5, idp_sack: 2 }

    const a = rescoreProjectionFacts([base], balanced)[0]!
    const b = rescoreProjectionFacts([base], tackleHeavy)[0]!

    expect(a.points).not.toBe(b.points)
    expect(b.points).toBeGreaterThan(a.points)
    // The cached input is untouched — rescoring must never mutate the shared object.
    expect(base.points).toBe(9.06)
    expect(base.rescored).toBe(false)
  })

  it('marks a rescored fact so a surface can tell whose rules produced the number', () => {
    const out = rescoreProjectionFacts([base], { idp_tkl_solo: 2, idp_tkl_ast: 1.5 })[0]!
    expect(out.rescored).toBe(true)
    // "9.1 under YOUR rules" and "9.1 under our default" are different claims.
    expect(out.points).not.toBe(out.storedPoints)
  })

  it('returns facts UNCHANGED when the league has no IDP rules — never zeroed', () => {
    const out = rescoreProjectionFacts([base], null)
    expect(out[0]!.points).toBe(9.06)
    expect(out[0]!.rescored).toBe(false)
  })

  it('leaves a fact with no stored components alone rather than dropping it', () => {
    // Older rows and non-IDP players carry no amounts. A null rescore means the stored value
    // stands, which is `rescoreIdpForLeague`'s own contract.
    const noFactors: ProjectionFact = { ...base, factors: null }
    const out = rescoreProjectionFacts([noFactors], { idp_tkl_solo: 9 })[0]!
    expect(out.points).toBe(9.06)
    expect(out.rescored).toBe(false)
  })

  it('names components the league does not score instead of silently lowering the number', () => {
    // A league that ignores `sack` should be able to see that it ignored it.
    const out = rescoreProjectionFacts([base], { idp_tkl_solo: 1, idp_tkl_ast: 0.5 })[0]!
    expect(out.rescored).toBe(true)
    expect(out.unscoredComponents).toContain('sack')
  })
})

/**
 * Kickers, on the same rescore path — Phase 1.4's real gap.
 *
 * 🛑 WHY THESE EXIST. `rescoreKickerForLeague` had ZERO consumers repo-wide while
 * `writeAfProjectionSnapshots` carried a comment saying kicker rules "are applied at READ time via
 * `rescoreKickerForLeague`, exactly as IDP does". They were not. Every kicker in every league was
 * scored with the canonical 3 / -1 / 1 / -1, so a league paying 5 for a made field goal received a
 * number computed as though it paid 3 — silently, with a comment asserting the opposite.
 */
const kickerBase: ProjectionFact = {
  ...base,
  playerId: 'k1',
  playerName: 'Test Kicker',
  position: 'K',
  points: 8,
  storedPoints: 8,
  factors: {
    kicker: { componentAmounts: { fieldGoalMade: 2, fieldGoalMissed: 1, extraPointMade: 3 } },
  } as unknown as ProjectionFact['factors'],
}

describe('rescoreProjectionFacts — kickers', () => {
  it('🛑 gives two leagues DIFFERENT kicker points from the SAME cached object', () => {
    // 2 made, 1 missed, 3 XP.  A: 2*3 + 1*-1 + 3*1 = 8.   B: 2*5 + 1*-2 + 3*2 = 14.
    const leagueA = { fgm: 3, fgmiss: -1, xpm: 1 }
    const leagueB = { fgm: 5, fgmiss: -2, xpm: 2 }

    const a = rescoreProjectionFacts([kickerBase], leagueA)[0]
    const b = rescoreProjectionFacts([kickerBase], leagueB)[0]

    expect(a.points).toBe(8)
    expect(b.points).toBe(14)
    expect(a.rescored).toBe(true)
    expect(b.rescored).toBe(true)
    // The cached object is untouched by either read.
    expect(kickerBase.points).toBe(8)
  })

  it('accepts the alternate rule spellings an importer may produce', () => {
    /*
     * `COMPONENT_RULE_KEYS` carries aliases precisely because leagues arrive from different
     * importers. Passing the league's full active-rules map is only safe if the lookup finds
     * whichever spelling that importer used.
     */
    const underscored = { kick_fgm: 5, kick_fgmiss: -2, kick_xpm: 2 }
    expect(rescoreProjectionFacts([kickerBase], underscored)[0].points).toBe(14)

    const longform = { field_goal_made: 5, field_goal_missed: -2, extra_point_made: 2 }
    expect(rescoreProjectionFacts([kickerBase], longform)[0].points).toBe(14)
  })

  it('🛑 the SAME map rescores an IDP row and a kicker row, each on its own components', () => {
    /*
     * `deriveIdpRules` returns ALL of a league's active rules, not an IDP subset — so one map
     * legitimately carries both. Each rescorer keys on its own stored blob, so a row is never
     * scored twice and neither steals the other's rules.
     */
    const combined = { idp_tkl_solo: 2, idp_tkl_ast: 1.5, idp_sack: 2, fgm: 5, fgmiss: -2, xpm: 2 }
    const [idpFact, kickerFact] = rescoreProjectionFacts([base, kickerBase], combined)

    expect(idpFact.points).toBe(2 * 6 + 1.5 * 3 + 2 * 0.5) // 17.5
    expect(kickerFact.points).toBe(14)
  })

  it('leaves a kicker alone when the league sets no kicker rules', () => {
    // IDP-only rules: nothing here scores a field goal, so the stored value must stand.
    const idpOnly = { idp_tkl_solo: 2, idp_tkl_ast: 1.5 }
    const out = rescoreProjectionFacts([kickerBase], idpOnly)[0]
    expect(out.points).toBe(8)
    expect(out.rescored).toBe(false)
  })

  it('🛑 flags a distance rule it cannot honour rather than silently approximating', () => {
    /*
     * The projection stores makes and misses, not the yardage of each kick, so a distance bucket
     * cannot be honoured exactly. Scoring at the flat rate and saying nothing would present an
     * approximation as exact.
     */
    const withDistance = { fgm: 3, fgmiss: -1, xpm: 1, fgm_50p: 5 }
    const out = rescoreProjectionFacts([kickerBase], withDistance)[0]
    expect(out.rescored).toBe(true)
    expect(out.kickerDistanceRulesIgnored).toBe(true)
  })

  it('does not flag distance rules when the league sets none', () => {
    const out = rescoreProjectionFacts([kickerBase], { fgm: 3, fgmiss: -1, xpm: 1 })[0]
    expect(out.kickerDistanceRulesIgnored).toBe(false)
  })
})
