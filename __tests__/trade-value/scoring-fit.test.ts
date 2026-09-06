import { describe, expect, it } from 'vitest'

import {
  describeScoringFit,
  POINTS_GAIN_PER_RECEPTION_POINT,
  receptionWeightForPosition,
  scoringFit,
  SCORING_FIT_EXPONENT,
  SCORING_FIT_MAX,
  SCORING_FIT_MIN,
} from '@/lib/trade-value/scoringFit'

/**
 * The chart takes ONE `ppr` number and applies it to every position. A league paying tight ends
 * 1.0 and everyone else 0.5 is neither `ppr=0.5` nor `ppr=1`, so no choice of chart is right and
 * the difference has to be modelled separately.
 *
 * Measured on production 2025 over the startable band of each position: a +0.5 reception bonus is
 * worth +0.0% to a QB, +15.0% to an RB, +28.0% to a WR and +31.2% to a TE.
 */

/* The EFL Dynasty League: 0.5 PPR with tight ends at 1.0. The league this was built for. */
const EFL = { rec: 0.5, bonus_rec_te: 0.5 }

describe('receptionWeightForPosition', () => {
  it('adds the per-position bonus to the base rate', () => {
    expect(receptionWeightForPosition(EFL, 'TE')).toBe(1.0)
    expect(receptionWeightForPosition(EFL, 'WR')).toBe(0.5)
    expect(receptionWeightForPosition(EFL, 'RB')).toBe(0.5)
  })

  it('⚠ reads any position bonus, not just TE — a WR-premium league is the same gap', () => {
    const wrPrem = { rec: 0.5, bonus_rec_wr: 0.5 }
    expect(receptionWeightForPosition(wrPrem, 'WR')).toBe(1.0)
    expect(receptionWeightForPosition(wrPrem, 'TE')).toBe(0.5)
  })

  it('🛑 NULL when the settings do not say — null is NOT zero', () => {
    /*
     * Treating unreadable settings as "receptions are worth 0" would silently price every PPR
     * league as standard scoring. The caller must decline to adjust, not adjust to a default.
     */
    expect(receptionWeightForPosition(null, 'TE')).toBeNull()
    expect(receptionWeightForPosition({}, 'TE')).toBeNull()
    expect(receptionWeightForPosition({ bonus_rec_te: 0.5 }, 'TE')).toBeNull()
  })

  it('accepts numeric strings, because provider blobs are not curated', () => {
    expect(receptionWeightForPosition({ rec: '0.5', bonus_rec_te: '0.5' }, 'TE')).toBe(1.0)
  })
})

describe('scoringFit — the EFL case it was built for', () => {
  it('🛑 lifts a TE and leaves everyone else EXACTLY alone', () => {
    const te = scoringFit(EFL, 'TE', 0.5)!
    expect(te.leagueWeight).toBe(1.0)
    expect(te.referenceWeight).toBe(0.5)
    // +0.5/catch x 0.624 points-per-unit = +31.2% points, damped by sqrt.
    expect(te.pointsRatio).toBeCloseTo(1.312, 3)
    expect(te.multiplier).toBeCloseTo(Math.sqrt(1.312), 3)
    expect(te.multiplier).toBeGreaterThan(1)

    for (const pos of ['WR', 'RB', 'QB']) {
      const f = scoringFit(EFL, pos, 0.5)!
      expect(f.pointsRatio, `${pos} should be untouched`).toBe(1)
      expect(f.multiplier, `${pos} should be untouched`).toBe(1)
    }
  })

  it('⚠ lands beside the hand-set premium it replaces — two methods, one answer', () => {
    /*
     * `dynasty-tiers.getPositionMultiplier` has carried `1.35 / 1.15 = 1.174x` for a TE-premium
     * league, set by judgement. This model reaches 1.145x from measured production. Agreement
     * between an independent method and a hand-set constant is weak evidence — and still more
     * than either alone, which is why it is asserted rather than mentioned.
     */
    const te = scoringFit(EFL, 'TE', 0.5)!
    expect(te.multiplier).toBeGreaterThan(1.1)
    expect(te.multiplier).toBeLessThan(1.25)
  })

  it('states its working in words a surface can render', () => {
    expect(scoringFit(EFL, 'TE', 0.5)!.reason).toMatch(/worth 1 here vs 0\.5 on the chart/)
    expect(scoringFit(EFL, 'WR', 0.5)!.reason).toMatch(/matching the chart/)
  })
})

describe('scoringFit — the general rule', () => {
  it('🛑 A QB IS NEVER MOVED BY A RECEPTION RULE, whatever the bonus', () => {
    // Measured at 0 median receptions across the startable band. Not a special case — a zero.
    expect(POINTS_GAIN_PER_RECEPTION_POINT.QB).toBe(0)
    for (const rec of [0, 0.5, 1, 2]) {
      expect(scoringFit({ rec, bonus_rec_qb: 1 }, 'QB', 0.5)!.multiplier).toBe(1)
    }
  })

  it('a full PPR league against a half-PPR chart lifts every receiving position', () => {
    const full = { rec: 1 }
    const te = scoringFit(full, 'TE', 0.5)!
    const wr = scoringFit(full, 'WR', 0.5)!
    const rb = scoringFit(full, 'RB', 0.5)!
    expect(te.multiplier).toBeGreaterThan(wr.multiplier)
    expect(wr.multiplier).toBeGreaterThan(rb.multiplier)
    expect(rb.multiplier).toBeGreaterThan(1)
  })

  it('⚠ and a STANDARD league against a PPR chart moves them DOWN — the rule is symmetric', () => {
    const standard = { rec: 0 }
    for (const pos of ['TE', 'WR', 'RB']) {
      expect(scoringFit(standard, pos, 1)!.multiplier, pos).toBeLessThan(1)
    }
    // Ordering is preserved downward too: the most reception-dependent position falls furthest.
    expect(scoringFit(standard, 'TE', 1)!.multiplier).toBeLessThan(scoringFit(standard, 'RB', 1)!.multiplier)
  })

  it('is exactly 1.0 when the league matches the chart — no drift on the common case', () => {
    /* Most leagues are ordinary. If this moved them at all, it would be re-pricing the entire
     * product to no purpose, which is how a "small adjustment" becomes a silent regression. */
    for (const ppr of [0, 0.5, 1]) {
      for (const pos of ['QB', 'RB', 'WR', 'TE']) {
        expect(scoringFit({ rec: ppr }, pos, ppr)!.multiplier, `${pos} @ ${ppr}`).toBe(1)
      }
    }
  })

  it('🛑 returns NULL, not 1.0, when it cannot tell', () => {
    /* 1.0 asserts "this league matches the chart". Null says "no opinion", which is the honest
     * answer — and the same refusal `applyFormatFit` makes when it has no LeagueShape. */
    expect(scoringFit(null, 'TE', 0.5)).toBeNull()
    expect(scoringFit({}, 'TE', 0.5)).toBeNull()
    expect(scoringFit(EFL, 'K', 0.5)).toBeNull()
    expect(scoringFit(EFL, 'DEF', 0.5)).toBeNull()
    expect(scoringFit(EFL, 'TE', Number.NaN)).toBeNull()
  })

  it('refuses a rule that would zero or invert production rather than clamping it', () => {
    // rec = -5 against a 0.5 chart drives pointsRatio negative for a TE. Not a tilt; a refusal.
    expect(scoringFit({ rec: -5 }, 'TE', 0.5)).toBeNull()
  })

  it('[control] bounds are real and the exponent damps rather than passes through', () => {
    expect(SCORING_FIT_EXPONENT).toBe(0.5)
    const extreme = scoringFit({ rec: 20 }, 'TE', 0.5)!
    expect(extreme.pointsRatio).toBeGreaterThan(SCORING_FIT_MAX) // undamped would blow the bound
    expect(extreme.multiplier).toBe(SCORING_FIT_MAX)
    expect(SCORING_FIT_MIN).toBeLessThan(1)
    expect(SCORING_FIT_MAX).toBeGreaterThan(1)
  })
})

describe('describeScoringFit — the line a surface owes the reader', () => {
  it('🛑 names every position that moved, because an adjusted price shown alone is a hidden one', () => {
    /*
     * Measured against the live 0.5 chart (`market-values:v1:dynasty:1qb:16t:0.5ppr`, 397 rows):
     * this rule repriced 65 rows — every tight end, nobody else — for a median gain of 8 ranks.
     */
    expect(describeScoringFit(EFL, 0.5)).toBe(
      'Adjusted for this league’s own reception rules, which the 0.5 PPR chart cannot express: TE +14.5%.',
    )
  })

  it('⚠ and the SAME league against a 1.0 chart names the losers instead — the chart is the reference', () => {
    /* An EFL-shaped league routed to a full-PPR chart pays RB and WR half what that chart assumed.
     * Nothing about the league changed; the number it is being measured against did. */
    const s = describeScoringFit(EFL, 1)!
    expect(s).toMatch(/RB -7\.8%/)
    expect(s).toMatch(/WR -15\.1%/)
    expect(s).not.toMatch(/TE/)
  })

  it('is NULL for an ordinary league and for settings it cannot read', () => {
    expect(describeScoringFit({ rec: 0.5 }, 0.5)).toBeNull()
    expect(describeScoringFit({ rec: 1 }, 1)).toBeNull()
    expect(describeScoringFit(null, 0.5)).toBeNull()
    expect(describeScoringFit({}, 0.5)).toBeNull()
  })

  it('⚠ omits a move too small to show rather than printing "+0%"', () => {
    /* A 0.001/catch bonus moves a TE by 0.03%, which rounds to nothing on every price on screen.
     * Naming it would assert a difference the reader cannot see. */
    expect(describeScoringFit({ rec: 0.5, bonus_rec_te: 0.001 }, 0.5)).toBeNull()
  })
})
