import { describe, expect, it } from 'vitest'

import { readFormatRules } from '@/lib/trade-intel/leagueFormatRules'
import {
  bracketHorizon,
  byeCostInWindow,
  faabResetNote,
  rosterHorizon,
  tradingPolicy,
} from '@/lib/trade-intel/tournament'

/**
 * King Buffalo Invitational shape. Weeks 1–9 qualify for 64 spots, then a
 * REDRAFT into 16-team leagues and single elimination over weeks 11–17, with a
 * second redraft before the Elite Eight. Rule 3: no trades — but the platform
 * spec makes trading a setting, so the valuation is built for the variant that
 * turns it on.
 */

describe('tradingPolicy: the first and sometimes only answer', () => {
  it('⚠ refuses to grade a trade the tournament forbids', () => {
    /*
     * A confident verdict about a transaction that cannot happen is worse than
     * no verdict, because it implies the deal is available.
     */
    const p = tradingPolicy({ tradesEnabled: false })
    expect(p.permitted).toBe(false)
    expect(p.basis).toContain('Nothing below is a deal you can actually make')
  })

  it('⚠ treats unknown as not-permitted, because most tournaments are not', () => {
    // Assuming yes would have a manager building around a deal the commissioner
    // may simply reject.
    const p = tradingPolicy({ tradesEnabled: null })
    expect(p.permitted).toBe(false)
    expect(p.basis).toContain('confirm with the commissioner')
  })

  it('flags an enabled tournament as the unusual case it is', () => {
    const p = tradingPolicy({ tradesEnabled: true })
    expect(p.permitted).toBe(true)
    expect(p.basis).toContain('unusual')
  })
})

describe('rosterHorizon: the redraft is the expiry', () => {
  it('⚠ a week-8 acquisition is worth ONE game, not the rest of the season', () => {
    /*
     * "This roster only lasts to WEEK 9." A manager pricing against the rest of
     * the season is out by a factor of ten.
     */
    const h = rosterHorizon({ currentWeek: 8, nextRedraftWeek: 9 })!
    expect(h.weeksOfUse).toBe(1)
    expect(h.basis).toContain('exactly ONE game')
  })

  it('says there is no carry-forward value at all', () => {
    expect(rosterHorizon({ currentWeek: 3, nextRedraftWeek: 9 })!.basis).toContain(
      'no carry-forward value',
    )
  })

  it('reports zero when the redraft is already here', () => {
    expect(rosterHorizon({ currentWeek: 9, nextRedraftWeek: 9 })!.weeksOfUse).toBe(0)
  })

  it('withholds when no redraft week is known', () => {
    expect(rosterHorizon({ currentWeek: 4, nextRedraftWeek: null })).toBeNull()
  })
})

describe('bracketHorizon: about two games, however deep the bracket', () => {
  it('⚠ seven rounds of bracket is NOT seven weeks of value', () => {
    /*
     * 2 − 2^−(R−1). You are guaranteed this round and each further one at half
     * the previous chance, so the expectation converges on two and never reaches
     * it. This is the most expensive misreading available in the format.
     */
    const deep = bracketHorizon({ roundsRemaining: 7 })!
    expect(deep.expectedGames).toBeCloseTo(1.98, 2)
    expect(deep.basis).toContain('not seven weeks of value')
  })

  it('is 1.75 with three rounds left', () => {
    expect(bracketHorizon({ roundsRemaining: 3 })!.expectedGames).toBe(1.75)
  })

  it('⚠ never reaches two, in the REPORTED number as well as the real one', () => {
    /*
     * Rounding to nearest would print 2.00 at twenty rounds and contradict the
     * one claim this function exists to make, so it rounds down. A reported
     * figure must not overstate the games you expect to play.
     */
    for (const r of [1, 2, 5, 10, 20, 40]) {
      expect(bracketHorizon({ roundsRemaining: r })!.expectedGames).toBeLessThan(2)
    }
  })

  it('the final round is exactly one game', () => {
    const last = bracketHorizon({ roundsRemaining: 1 })!
    expect(last.expectedGames).toBe(1)
    expect(last.basis).toContain('win or the season ends')
  })

  it('withholds rather than reporting a bracket that is over', () => {
    expect(bracketHorizon({ roundsRemaining: 0 })).toBeNull()
  })
})

describe('faabResetNote: budget with a death date', () => {
  it('⚠ unspent FAAB is simply lost at the reset', () => {
    /*
     * "New FAAB for Tournament Weeks 12–17." Saving it is the same instinct that
     * makes managers hold idols past the merge in Survivor, and it ends the same
     * way.
     */
    const n = faabResetNote({ currentWeek: 10, resetWeek: 12, remaining: 64 })!
    expect(n).toContain('$64')
    expect(n).toContain('costs nothing to use it now')
  })

  it('says nothing once the reset has passed', () => {
    expect(faabResetNote({ currentWeek: 13, resetWeek: 12 })).toBeNull()
  })

  it('works without knowing the balance', () => {
    expect(faabResetNote({ currentWeek: 10, resetWeek: 12 })).toContain('Any unspent FAAB')
  })
})

describe('byeCostInWindow: a rounding error over a season, a disaster over nine weeks', () => {
  it('⚠ prices the bye against the games actually remaining', () => {
    const n = byeCostInWindow({
      byeWeek: 7,
      currentWeek: 6,
      windowEndWeek: 9,
      singleElimination: false,
    })!
    expect(n).toContain('1 of your 4 remaining games')
  })

  it('⚠ in the bracket a bye is elimination, not a cost you absorb', () => {
    /*
     * You cannot field him and there is no next week to make it up in. That is a
     * categorically different statement from "you lose one of four games".
     */
    const n = byeCostInWindow({
      byeWeek: 13,
      currentWeek: 12,
      windowEndWeek: 17,
      singleElimination: true,
    })!
    expect(n).toContain('field a hole and go home')
  })

  it('says nothing for a bye already past or outside the window', () => {
    expect(
      byeCostInWindow({ byeWeek: 3, currentWeek: 6, windowEndWeek: 9, singleElimination: false }),
    ).toBeNull()
    expect(
      byeCostInWindow({ byeWeek: 14, currentWeek: 6, windowEndWeek: 9, singleElimination: false }),
    ).toBeNull()
  })
})

describe('tournament is its own concept', () => {
  it('⚠ resolves to tournament, and reports trading as barred by default', () => {
    const r = readFormatRules({ leagueType: 'tournament' })
    expect(r.concept).toBe('tournament')
    expect(r.futurePicksTradeable).toBe(false)
    expect(r.notes.join(' ')).toContain('redraft')
  })
})
