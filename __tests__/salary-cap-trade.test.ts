import { describe, expect, it } from 'vitest'

import {
  capLegality,
  capSpaceNote,
  contractLengthNote,
  contractSurplus,
  deadMoneyNote,
} from '@/lib/trade-intel/salaryCap'

/**
 * League Tycoon shape. Contracts carry a salary and a length, teams carry a cap
 * hit and a space figure, cutting leaves dead money, and there is a FLOOR as
 * well as a ceiling.
 */

describe('capLegality: a hard constraint, and it leads', () => {
  it('⚠ blocks a deal both managers want, because the platform will', () => {
    /*
     * Grading an over-cap trade on value alone produces a verdict about a
     * transaction that cannot happen — the same failure as pricing a pick in a
     * redraft league.
     */
    const c = capLegality({ capSpace: 5_000, salaryIn: 12_000, salaryOut: 3_000 })!
    expect(c.legal).toBe(false)
    expect(c.basis).toContain('over the cap')
  })

  it('⚠ blocks the OTHER direction too — the floor', () => {
    /*
     * capFloorEnabled means salary dumping is also illegal past a point. Nobody
     * expects that direction, which is why it is worth a sentence of its own.
     */
    const c = capLegality({
      capSpace: 40_000,
      salaryIn: 1_000,
      salaryOut: 20_000,
      capFloor: 90_000,
      totalCapHit: 100_000,
    })!
    expect(c.legal).toBe(false)
    expect(c.blockedByFloor).toBe(true)
    expect(c.basis).toContain('cap FLOOR')
  })

  it('allows a deal that fits, and says what is left', () => {
    const c = capLegality({ capSpace: 20_000, salaryIn: 8_000, salaryOut: 3_000 })!
    expect(c.legal).toBe(true)
    expect(c.spaceAfter).toBe(15_000)
  })

  it('⚠ an unknown ledger is neither legal nor illegal', () => {
    // Reporting "legal" for a cap position we never read would be the worst
    // possible default: it invites a manager to agree to a rejected trade.
    expect(capLegality({ capSpace: null, salaryIn: 1, salaryOut: 0 })).toBeNull()
  })
})

describe('contractSurplus: the best player is often the worst asset', () => {
  it('⚠ a negative surplus is a real answer, not a failure', () => {
    /*
     * An elite player at a punishing salary can be worth less than a
     * replacement body on a minimum deal, because the difference is spendable
     * elsewhere. Every value chart prices the first man higher.
     */
    const s = contractSurplus({
      playerValueInCapUnits: 30_000,
      salary: 20_000,
      yearsRemaining: 3,
    })!
    expect(s.surplus).toBe(-30_000)
    expect(s.basis).toContain('worst asset in it')
  })

  it('prices a cheap long contract as the prize it is', () => {
    const s = contractSurplus({
      playerValueInCapUnits: 40_000,
      salary: 4_000,
      yearsRemaining: 4,
    })!
    expect(s.surplus).toBe(24_000)
    expect(s.basis).toContain('most valuable thing in a cap league')
  })

  it('⚠ withholds rather than inventing a currency conversion', () => {
    // Market value is in FantasyCalc points and salary is in cap dollars. This
    // does the arithmetic it is given; a made-up exchange rate would make every
    // surplus figure confidently wrong.
    expect(
      contractSurplus({ playerValueInCapUnits: null, salary: 5_000, yearsRemaining: 2 }),
    ).toBeNull()
  })
})

describe('deadMoneyNote: a bad contract is sticky', () => {
  it('⚠ names the exit cost you are also acquiring', () => {
    /*
     * A manager who assumes they can cut a disappointment next season has not
     * priced deadMoneyPercentPerYear — and it is usually why the salary dump was
     * available in the first place.
     */
    const n = deadMoneyNote({
      salary: 10_000,
      yearsRemaining: 3,
      deadMoneyPercentPerYear: 50,
      enabled: true,
    })!
    expect(n).toContain('15,000')
    expect(n).toContain('why a salary dump was available')
  })

  it('says nothing when the league does not use dead money', () => {
    expect(
      deadMoneyNote({ salary: 10_000, yearsRemaining: 3, deadMoneyPercentPerYear: 50, enabled: false }),
    ).toBeNull()
  })

  it('says nothing on an expiring deal', () => {
    expect(
      deadMoneyNote({ salary: 10_000, yearsRemaining: 0, deadMoneyPercentPerYear: 50, enabled: true }),
    ).toBeNull()
  })
})

describe('contractLengthNote: years matter more than dollars', () => {
  it('calls an expiring deal a rental', () => {
    expect(contractLengthNote({ yearsRemaining: 1, surplusPositive: true })).toContain('renting him')
  })

  it('⚠ length is a prize on a good deal and a trap on a bad one', () => {
    expect(contractLengthNote({ yearsRemaining: 4, surplusPositive: true })).toContain(
      'most valuable shape of asset',
    )
    expect(contractLengthNote({ yearsRemaining: 4, surplusPositive: false })).toContain(
      'not a player you can wait out',
    )
  })

  it('stays quiet on a two-year deal, which is not worth a sentence', () => {
    expect(contractLengthNote({ yearsRemaining: 2, surplusPositive: true })).toBeNull()
  })
})

describe('capSpaceNote: hoarding without rollover ends in nothing', () => {
  it('⚠ names the use-it-or-lose-it case', () => {
    const n = capSpaceNote({ capSpace: 25_000, rolloverEnabled: false, rolloverMax: null })!
    expect(n).toContain('does NOT roll it over')
    expect(n).toContain('saving an idol past its expiry')
  })

  it('calls space a real asset when rollover is on', () => {
    expect(capSpaceNote({ capSpace: 25_000, rolloverEnabled: true, rolloverMax: 10_000 })).toContain(
      'real asset here',
    )
  })

  it('says nothing when there is no space to speak of', () => {
    expect(capSpaceNote({ capSpace: 0, rolloverEnabled: true, rolloverMax: null })).toBeNull()
  })
})
