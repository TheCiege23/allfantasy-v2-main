/**
 * The scoring template prices three field-goal buckets. The feed supplied one of them.
 *
 * 🛑 THE BUG THIS PINS. `fg_0_39` (3 pts), `fg_40_49` (4) and `fg_50_plus` (5) are all priced by
 * the NFL template, but the feed reports `fgm` (the TOTAL made), `fgm_40_49`, `fgm_50p` and
 * `fgm_50_59`. `NFL_ALIASES` mapped only `fgm_40_49`, plus an `fgm_50` that NO FEED EMITS —
 * `ScoringKeyAliasResolver` turns Sleeper stat id 74 into `fgm_50p`. Unknown keys pass through
 * untouched, so the two unmapped buckets simply never reached the calculator.
 *
 * Measured on the test database, 313,883 NFL rows:
 *
 *   normalized_stat_map has "fgm":        3,098 rows   -> scored nothing
 *   normalized_stat_map has "fgm_50p":      843 rows   -> scored nothing
 *   normalized_stat_map has "fgm_50_59":    300 rows   -> scored nothing
 *   normalized_stat_map has "fg_0_39":          0 rows
 *   normalized_stat_map has "fg_50_plus":       0 rows
 *
 * Across 3,098 kicker-game rows: 3,496 field goals under forty and 1,000 of fifty or more scored
 * zero. The template produced 13,313 points where the same lines are worth 28,801 — **53.8% of
 * all kicking value discarded** — while the feed's own `kick_pts` for those rows totals 14,810.
 *
 * ⚠ AND THE OBVIOUS FIX IS A DOUBLE-COUNT. `fgm_50_59` is a SUBSET of `fgm_50p`, not a sibling:
 * all 300 rows carrying it also carry `fgm_50p`. `normalizeStatPayload` SUMS into the canonical
 * key, so aliasing both to `fg_50_plus` would count every one of those kicks twice.
 */

import { describe, expect, it } from 'vitest'
import { normalizeStatPayload } from '@/lib/schedule-stats/StatNormalizationService'
import { getDefaultScoringTemplate } from '@/lib/scoring-defaults/ScoringDefaultsRegistry'
import { computeFantasyPoints } from '@/lib/scoring-defaults/FantasyPointCalculator'

const NFL_PPR = getDefaultScoringTemplate('NFL', 'ppr').rules

/** A real shape: four made, one from 40-49, one from 50+, three extra points. */
const KICKER_RAW = { fgm: 4, fga: 5, fgm_40_49: 1, fgm_50p: 1, fgmiss: 1, xpm: 3, xpa: 3, kick_pts: 17 }

describe('field-goal distance buckets', () => {
  it('carries the 50+ bucket the feed actually sends', () => {
    const out = normalizeStatPayload('NFL', KICKER_RAW)
    expect(out.fg_50_plus).toBe(1)
  })

  it('derives the under-40 bucket from the total the feed sends', () => {
    const out = normalizeStatPayload('NFL', KICKER_RAW)
    /* 4 made − 1 from 40-49 − 1 from 50+ = 2 under forty. */
    expect(out.fg_0_39).toBe(2)
  })

  it('scores the whole line instead of a third of it', () => {
    const out = normalizeStatPayload('NFL', KICKER_RAW)
    const points = computeFantasyPoints(out, NFL_PPR)
    /* 2x3 + 1x4 + 1x5 + 3x1 = 18. Before this, only the 40-49 and the PATs scored: 7. */
    expect(points).toBe(18)
    expect(points).toBeGreaterThan(7)
  })

  /*
   * 🛑 THE DOUBLE-COUNT CONTROL, AND THE REASON `fgm_50_59` IS NOT AN ALIAS. Every row that
   * carries it also carries `fgm_50p`; summing both would price one fifty-yard kick twice.
   */
  it('does not count a 50-59 yard kick twice when both buckets are present', () => {
    const out = normalizeStatPayload('NFL', { ...KICKER_RAW, fgm_50_59: 1 })
    expect(out.fg_50_plus).toBe(1)
  })

  /* …but it is still the only source when the wider bucket is absent. */
  it('falls back to the 50-59 bucket when the wider one is missing', () => {
    const out = normalizeStatPayload('NFL', { fgm: 2, fgm_50_59: 1 })
    expect(out.fg_50_plus).toBe(1)
    expect(out.fg_0_39).toBe(1)
  })

  /*
   * ⚠ ONE ROW IN 3,098 HAS PARTS EXCEEDING ITS OWN TOTAL. A negative field-goal count would hand
   * the kicker a penalty he did not earn, so the derivation clamps.
   */
  it('never derives a negative count from an inconsistent line', () => {
    const out = normalizeStatPayload('NFL', { fgm: 1, fgm_40_49: 1, fgm_50p: 1 })
    expect(out.fg_0_39).toBe(0)
    expect(computeFantasyPoints(out, NFL_PPR)).toBeGreaterThanOrEqual(0)
  })

  /*
   * 🛑 IDEMPOTENCY, WHICH IS NOT OPTIONAL HERE. `projectionAccuracy` feeds STORED normalized maps
   * back through this function, and a second pass that re-derived would charge the kicker twice.
   * A stored map states `fg_0_39` and `fg_40_49` rather than the feed's spellings, so both the
   * skip and the canonical-key reads are load-bearing.
   */
  it('is idempotent when a stored normalized map is fed back through it', () => {
    const once = normalizeStatPayload('NFL', KICKER_RAW)
    const twice = normalizeStatPayload('NFL', once)
    expect(twice).toEqual(once)
    expect(computeFantasyPoints(twice, NFL_PPR)).toBe(computeFantasyPoints(once, NFL_PPR))
  })

  it('leaves a line with no kicking stats alone', () => {
    const out = normalizeStatPayload('NFL', { rush_yd: 80, rush_td: 1 })
    expect('fg_0_39' in out).toBe(false)
    expect('fg_50_plus' in out).toBe(false)
  })

  /* College kickers share the NFL alias table, and the same template buckets. */
  it('applies to NCAAF as well', () => {
    const out = normalizeStatPayload('NCAAF', KICKER_RAW)
    expect(out.fg_50_plus).toBe(1)
    expect(out.fg_0_39).toBe(2)
  })
})
