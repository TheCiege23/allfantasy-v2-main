import { describe, expect, it } from 'vitest'

import { computeLeagueProjectedPoints } from '@/lib/projections/leagueScoring'

/**
 * A bare defensive key and its `idp_*` twin are two different rules in a Sleeper rulebook.
 *
 * 🛑 THE BUG THIS PINS. In Sleeper, `sack` / `int` / `ff` / `fum_rec` / `safe` score the TEAM
 * defense, and an individual defender is scored by `idp_sack` / `idp_int` / … . `STAT_ALIASES`
 * bridges the bare keys to the `idp_*` stats (for rulebooks that score IDP only through bare
 * keys), so in a league that weights BOTH, one individual sack was paid twice — the D/ST weight
 * through the alias and the IDP weight directly.
 *
 * Measured on staging 2026-09-16: 26 of the 43 leagues `hasIdpScoring` accepts weight both
 * families (25 for sack/int/ff/safe, 26 for fum_rec); a real rulebook (sack 1, idp_sack 3)
 * scored `{ idp_sack: 1 }` as 4. Projected IDP lines never carry the bare keys (0 lines), so the
 * alias is the only path the double count takes.
 */

// The defensive block of a real staging IDP rulebook (both families weighted).
const BOTH = {
  sack: 1, idp_sack: 3,
  int: 2, idp_int: 3,
  ff: 1, idp_ff: 2,
  fum_rec: 2, idp_fum_rec: 2,
  safe: 2, idp_safe: 2,
  idp_tkl_solo: 1.5,
}

const IDP_LINE = { idp_sack: 1, idp_int: 1, idp_ff: 1, idp_fum_rec: 1, idp_safe: 1, idp_tkl_solo: 6 }

describe('a rulebook that weights both the bare key and its idp_* twin', () => {
  it('pays an individual defender each stat ONCE, at the IDP weight', () => {
    const r = computeLeagueProjectedPoints(IDP_LINE, BOTH)!
    // 3 + 3 + 2 + 2 + 2 + 9 — no D/ST weight on top.
    expect(r.points).toBeCloseTo(21, 6)
  })

  it('leaves no D/ST contribution on an individual defender', () => {
    const r = computeLeagueProjectedPoints(IDP_LINE, BOTH)!
    for (const bare of ['sack', 'int', 'ff', 'fum_rec', 'safe']) {
      expect(r.contributions[bare]).toBeUndefined()
    }
  })

  it('reproduces the measured case: one sack under sack 1 / idp_sack 3 is 3, not 4', () => {
    expect(computeLeagueProjectedPoints({ idp_sack: 1 }, { sack: 1, idp_sack: 3 })!.points).toBe(3)
  })

  it('still scores a TEAM defense line through the bare keys it actually carries', () => {
    // A D/ST row carries `sack` / `int` directly — the direct key is untouched by the rule.
    expect(computeLeagueProjectedPoints({ sack: 3, int: 1 }, BOTH)!.points).toBe(5)
  })
})

describe('a rulebook that carries the idp_* twin at ZERO', () => {
  it('does not pay an IDP stat the league explicitly scores at nothing', () => {
    // The league wrote `idp_sack: 0`: individual sacks are worth nothing there. The D/ST `sack`
    // weight must not smuggle them back in.
    expect(computeLeagueProjectedPoints({ idp_sack: 2 }, { sack: 1, idp_sack: 0 })).toBeNull()
  })
})

describe('what the rule must NOT change', () => {
  it('keeps the bridge for a rulebook that scores IDP only through bare keys', () => {
    // No idp_* twin in the rulebook, so the bare key is the only rule there is.
    expect(computeLeagueProjectedPoints({ idp_sack: 2, idp_tkl_solo: 6 }, { sack: 4, tkl_solo: 1 })!.points).toBe(14)
  })

  it('leaves offensive aliases alone in an IDP league', () => {
    expect(computeLeagueProjectedPoints({ receptions: 5, receiving_yards: 50 }, { rec: 1, rec_yd: 0.1, ...BOTH })!.points).toBe(10)
  })

  it('prefers a native bare key over any alias, as before', () => {
    expect(computeLeagueProjectedPoints({ sack: 1, idp_sack: 9 }, { sack: 2 })!.points).toBe(2)
  })
})
