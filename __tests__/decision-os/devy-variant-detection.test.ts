/**
 * R1.5 — a C2C / devy-slot NFL dynasty league gets the devy board.
 *
 * 🛑 THE GAP. `want.devy` was `sport === 'NCAAF'`. The board is college-football only, so that
 * test is right for every ordinary league and WRONG for a league that rosters college players
 * inside an NFL league — it wants the board and fails the sport test. Recorded as a known
 * limitation when the sport scoping shipped, and closed here.
 *
 * ⚠ MEASURED FIRST: zero such leagues exist in production today (`devy_league_configs` 0 rows,
 * `leagueVariant` like devy 0), while the board itself holds 1,721 players. So this fixes a
 * LATENT defect — the first devy league created would silently have got nothing. Built on that
 * basis deliberately, not because anyone is waiting for it.
 */
import { describe, it, expect } from 'vitest'

import { deriveWantsDevyBoard } from '@/lib/decision-os/grounding/leagueValueFormat'
import { DEVY_DYNASTY_VARIANT } from '@/lib/devy/types'

const rules = (variant: unknown) => ({ general: { variant } })

describe('R1.5 · deriveWantsDevyBoard', () => {
  it('🛑 a devy_dynasty variant wants the board', () => {
    expect(deriveWantsDevyBoard(rules(DEVY_DYNASTY_VARIANT))).toBe(true)
  })

  it("tolerates an importer's casing and surrounding whitespace", () => {
    expect(deriveWantsDevyBoard(rules('  Devy_Dynasty  '))).toBe(true)
  })

  /**
   * ⚠ THE GUARD THAT KEEPS THIS FROM BECOMING A SECOND DEFINITION. `isDevyLeague` compares
   * against the exact constant; a loose /devy/i test here would drift from it the first time
   * someone names a variant "devy_best_ball". Two implementations of one rule is the bug.
   */
  it('🛑 does NOT match a variant that merely contains "devy"', () => {
    expect(deriveWantsDevyBoard(rules('devy_best_ball'))).toBe(false)
    expect(deriveWantsDevyBoard(rules('super_devy'))).toBe(false)
  })

  it('an ordinary league does not want it', () => {
    expect(deriveWantsDevyBoard(rules('dynasty'))).toBe(false)
    expect(deriveWantsDevyBoard(rules('redraft'))).toBe(false)
    expect(deriveWantsDevyBoard(rules(null))).toBe(false)
  })

  it('never throws on a shape it has not seen', () => {
    expect(deriveWantsDevyBoard(null)).toBe(false)
    expect(deriveWantsDevyBoard(undefined)).toBe(false)
    expect(deriveWantsDevyBoard('nonsense')).toBe(false)
    expect(deriveWantsDevyBoard({})).toBe(false)
    expect(deriveWantsDevyBoard({ general: {} })).toBe(false)
    expect(deriveWantsDevyBoard({ general: { variant: 42 } })).toBe(false)
  })
})
