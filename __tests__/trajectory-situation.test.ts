import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { futureLean } from '@/lib/trade-intel/trajectory'

const TRAJ = readFileSync(resolve(process.cwd(), 'lib/trade-intel/trajectory.ts'), 'utf8')
const SIT = readFileSync(resolve(process.cwd(), 'lib/trade-intel/situation.ts'), 'utf8')

/**
 * Layer 2 and layer 3 of the value ledger. Age was blocked on double-counting;
 * the fix is to read it OUT of the market rather than apply it to the market.
 */

describe('futureLean: age read out of the market, not applied to it', () => {
  it('⚠ a dynasty premium means the market is paying for his future', () => {
    /*
     * FantasyCalc publishes both prices for the same player. The spread IS the
     * market's opinion of his future — no ageing curve has to be assumed,
     * because the number already contains one.
     */
    const f = futureLean({ dynastyValue: 9000, redraftValue: 6000, playerName: 'A Rookie' })!
    expect(f.direction).toBe('rising')
    expect(f.basis).toContain('paying for his future')
  })

  it('⚠ and a dynasty discount means it expects this year to be near the peak', () => {
    const f = futureLean({ dynastyValue: 3000, redraftValue: 5000, playerName: 'A Veteran' })!
    expect(f.direction).toBe('declining')
    expect(f.basis).toContain('near the top of what is left')
  })

  it('reports agreement as agreement rather than as a tiny signal', () => {
    expect(futureLean({ dynastyValue: 5000, redraftValue: 5100 })!.direction).toBe('flat')
  })

  it('withholds when either price is missing', () => {
    expect(futureLean({ dynastyValue: null, redraftValue: 5000 })).toBeNull()
    expect(futureLean({ dynastyValue: 5000, redraftValue: 0 })).toBeNull()
  })

  it('⚠ cannot double-count, and the file says why', () => {
    /*
     * An age curve applied on top of a dynasty price re-charges a player for
     * something the price already reflects. A RATIO between two prices from the
     * same source is a comparison, not an adjustment.
     */
    expect(TRAJ).toContain('AGE IS READ OUT OF THE MARKET RATHER THAN APPLIED TO IT')
    expect(TRAJ).toContain('double-count, because it is a comparison')
  })

  it('⚠ admits the spread is not purely age', () => {
    // It carries age, situation, contract and injury history mixed together.
    // Better than age alone, worse than a clean age number, and the manager
    // deserves to know which they are reading.
    expect(TRAJ).toContain('IT IS NOT PURELY AGE')
  })
})

describe('⚠ loadFutureLeans matches format, or the signal is an artefact', () => {
  it('compares like with like on QB format', () => {
    /*
     * Comparing a dynasty superflex price to a redraft one-QB price would report
     * every quarterback as a rising asset — a format artefact wearing a
     * trajectory's clothes.
     */
    expect(TRAJ).toContain('MATCHED, NOT MERELY BOTH-FETCHED')
    expect(TRAJ).toContain('qbFormat: args.qbFormat')
  })
})

describe('usage: absence is a coverage gap, never a zero', () => {
  it('⚠ names what it could not see', () => {
    // Snap counts cover ~77-89% of rows and targets ~58%, so a missing stat is
    // usually a gap rather than a man who did not play.
    expect(TRAJ).toContain('MOST LIKELY TO BE ABSENT')
    expect(TRAJ).toContain('coverage gap, not a zero')
  })

  it('averages over games that HAVE the stat, not over all games', () => {
    expect(TRAJ).toContain('Mean over the games that actually carried the stat')
  })

  it('⚠ refuses to invent a third-down role', () => {
    /*
     * Box scores carry totals, not down-and-distance splits. A "third-down back"
     * signal built from a target count would be a guess dressed as a role, and
     * exactly the kind of number a manager would trade on.
     */
    expect(TRAJ).toContain('THIRD-DOWN ROLE IS NOT DERIVABLE')
  })

  /**
   * ⚠ WAS PINNED TO THE PROSE OF A COMMENT, and the comment was reworded, so a
   * guard against the most confident possible wrong answer went red over a
   * sentence. The guarantee lives in the code: `rookie` is true only when
   * yearsExp is genuinely 0, never when it is null.
   *
   * 0 and null are different and the difference is the whole factor — 0 means he
   * has not played a snap, null means we do not know, and reading null as 0
   * would label every unmatched player a rookie.
   */
  it('does not infer rookie status from a missing prior season', () => {
    /* Not `!yearsExp`, which is true for null and would collapse the two. */
    expect(TRAJ).toMatch(/rookie:\s*yearsExp === 0/)
    expect(TRAJ).not.toMatch(/rookie:\s*!yearsExp/)
    /* And an unknown says so rather than defaulting to a claim. */
    expect(TRAJ).toContain('rookie status cannot be confirmed here')
    /* The reasoning stays written down next to it, in whatever words. */
    expect(TRAJ).toMatch(/0 AND NULL ARE DIFFERENT/)
  })
})

describe('situation: scoped to avoid double-counting the projection', () => {
  it('⚠ reports what CHANGED rather than re-applying team quality', () => {
    /*
     * A vendor projecting a receiver on a pass-heavy team has already priced the
     * pass-heaviness. Change is the part a stale projection cannot contain.
     */
    expect(SIT).toContain('EVERY SIGNAL HERE RISKS DOUBLE-COUNTING')
    expect(SIT).toContain('They report what CHANGED')
  })

  it('honours the per-field sample size on tendencies', () => {
    // A rate over a handful of neutral plays is noise; reporting it like one
    // built on five hundred gives false precision.
    expect(SIT).toContain('SAMPLE SIZE IS STORED PER FIELD AND MUST BE HONOURED')
    expect(SIT).toContain('MIN_NEUTRAL_PLAYS')
  })

  it('flags stale tendency data rather than presenting it as current', () => {
    expect(SIT).toContain('describes last season')
  })

  it('⚠ never reads isPlayCaller null as false', () => {
    /*
     * No dataset reliably records who calls plays. Treating null as "not the
     * play-caller" asserts something nobody knows.
     */
    expect(SIT).toContain('NULLABLE ON PURPOSE AND MUST NOT BE READ AS false')
  })

  it('⚠ a missing prior season is not evidence of a coordinator change', () => {
    // Otherwise it fires on every team in a season we failed to ingest.
    expect(SIT).toContain('A missing prior year is not evidence of a')
  })

  it('⚠ SOS is the real schedule, not the fantasy-opponent proxy already here', () => {
    /*
     * The existing "SOS" measures the managers you play. This measures the
     * defences your players face. Different quantities; only one affects points.
     */
    expect(SIT).toContain('NOT THE EXISTING "SOS" IN THIS REPO')
    expect(SIT).toContain('not the defences your players')
  })

  it('reports SOS as a coarse band, matching the confidence of the input', () => {
    expect(SIT).toContain('coarse proxy for defensive quality')
    expect(SIT).toContain('lean rather than a number')
  })

  it('⚠ does not approximate NFL free agency from league cap contracts', () => {
    /*
     * PlayerContract models salary-cap LEAGUE deals. Using it would report a
     * fantasy cap sheet as though it were an NFL one.
     */
    expect(SIT).toContain('NAMED RATHER THAN APPROXIMATED')
    expect(SIT).toContain('not real NFL deals')
  })
})
