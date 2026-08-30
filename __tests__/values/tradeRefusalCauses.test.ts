import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The trade evaluator's refusals must each name their OWN cause.
 *
 * 🛑 THE FAILURE THIS FILE EXISTS FOR, TWICE OVER. This route refuses any trade containing an
 * unpriced asset — correct, because grading a 0-for-something produces a confident A+/D with no
 * data behind it. But for a long time every refusal used the SAME message: "check the spelling,
 * or the player may not be on the dynasty board."
 *
 * That message is wrong for two real cases, and wrong in the same way — it blames the manager
 * for our own limitation:
 *
 *   DEVY_SCALE       the player is a correctly-spelled college player nobody prices
 *   AMBIGUOUS_PLAYER two players in the league share the name, so we refuse to guess
 *
 * ⚠ ORDER IS THE LOAD-BEARING PART. The generic UNPRICED_ASSETS branch matches ANY unpriced
 * name, so a specific cause that runs after it never fires. These assertions pin the specific
 * refusals ahead of the generic one; that is exactly the regression that would restore the
 * unhelpful message while every test still passed.
 */
const SRC = readFileSync(resolve(process.cwd(), 'app/api/trade-evaluator/route.ts'), 'utf8')

const at = (needle: string) => SRC.indexOf(needle)

describe('trade refusals name their own cause', () => {
  it('has a distinct refusal for an ambiguous name', () => {
    expect(SRC).toContain("error: 'AMBIGUOUS_PLAYER'")
    expect(SRC).toContain('ambiguousPlayers')
  })

  it('has a distinct refusal for college assets', () => {
    expect(SRC).toContain("error: 'DEVY_SCALE'")
  })

  /** 🛑 Both specific causes must precede the catch-all, or they are unreachable. */
  it('checks the specific causes before the generic unpriced message', () => {
    const ambiguous = at("error: 'AMBIGUOUS_PLAYER'")
    const devy = at("error: 'DEVY_SCALE'")
    const generic = at("error: 'UNPRICED_ASSETS'")

    expect(ambiguous).toBeGreaterThan(-1)
    expect(devy).toBeGreaterThan(-1)
    expect(generic).toBeGreaterThan(-1)
    expect(ambiguous).toBeLessThan(generic)
    expect(devy).toBeLessThan(generic)
  })

  /**
   * ⚠ THE OUTAGE BRANCH MUST ALSO STAY BEHIND THEM. "Values are unavailable, try again shortly"
   * is true when the whole board failed to load and false for a college player or a duplicate
   * name — retrying never resolves either.
   */
  it('checks the specific causes before the board-outage message', () => {
    expect(at("error: 'AMBIGUOUS_PLAYER'")).toBeLessThan(at("error: 'VALUATION_UNAVAILABLE'"))
    expect(at("error: 'DEVY_SCALE'")).toBeLessThan(at("error: 'VALUATION_UNAVAILABLE'"))
  })

  /**
   * The ambiguity message must say the limitation is OURS. The manager typed a correct name;
   * sending him to hunt a typo is the specific harm being corrected.
   */
  it('tells the manager the ambiguity is not their mistake', () => {
    expect(SRC).toMatch(/limitation on our side, not a mistake in what you entered/)
    expect(SRC).not.toMatch(/AMBIGUOUS_PLAYER[\s\S]{0,400}Check the spelling/)
  })

  it('reads the refused names from the league board rather than a local list', () => {
    expect(SRC).toContain('leagueValues?.idp.ambiguousNames')
  })
})
