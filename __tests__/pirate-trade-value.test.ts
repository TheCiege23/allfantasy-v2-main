import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  acquisitionSafety,
  attritionNote,
  concentrationCorrectionNote,
  PROTECTION_SLOTS,
  stealExposure,
  tradeLockNote,
} from '@/lib/trade-intel/pirate'

/**
 * Winning a matchup takes a player off the loser. You may protect THREE; anyone
 * unprotected — starter, bench or IR — can be stolen. Protections freeze from
 * TNF until Wednesday midnight, and protected players cannot be traded in that
 * window while everyone else can.
 */

describe('stealExposure: what losing actually costs', () => {
  it('⚠ the winner takes your best UNPROTECTED player, not an average one', () => {
    /*
     * They choose. Modelling this as a typical or expected loss would understate
     * every single week.
     */
    const e = stealExposure({ rosterValues: [9000, 8000, 7000, 6500, 3000], protectedCount: 3 })!
    expect(e.atRiskValue).toBe(6500)
    expect(e.exposedCount).toBe(2)
    expect(e.basis).toContain('most valuable thing you left uncovered')
  })

  it('reports nothing at risk when the whole priced roster fits the cap', () => {
    const e = stealExposure({ rosterValues: [9000, 8000, 7000], protectedCount: 3 })!
    expect(e.atRiskValue).toBeNull()
    expect(e.exposedCount).toBe(0)
  })

  it('⚠ skips unpriced players rather than treating them as worthless', () => {
    // A null is "we hold no price", not "worth zero" — counting it as zero would
    // report a defender-heavy roster as having nothing to lose.
    const e = stealExposure({ rosterValues: [9000, null, 8000, null, 7000, 6000] })!
    expect(e.atRiskValue).toBe(6000)
  })

  it('withholds entirely when nothing is priced', () => {
    expect(stealExposure({ rosterValues: [null, null] })).toBeNull()
  })
})

describe('acquisitionSafety: the question nobody asks before trading here', () => {
  it('⚠ a fourth stud cannot be protected, so you may only be renting him', () => {
    /*
     * Three slots is the whole shield. Acquiring a fourth stud gives you three
     * studs and a stud the league takes the first week you lose. His market
     * price assumes you get to keep him.
     */
    const a = acquisitionSafety({ incomingValue: 5000, protectedValues: [9000, 8000, 7000] })!
    expect(a.protectable).toBe(false)
    expect(a.basis).toContain('only be renting him')
  })

  it('⚠ counts the player he displaces as part of the price', () => {
    /*
     * If he DOES fit, someone drops out of the cap and becomes stealable. That
     * player is a real cost of the trade and no value chart includes him.
     */
    const a = acquisitionSafety({ incomingValue: 9500, protectedValues: [9000, 8000, 7000] })!
    expect(a.protectable).toBe(true)
    expect(a.displaces).toBe(7000)
    expect(a.basis).toContain('part of the price of this deal')
  })

  it('says a free slot is the version of the trade worth making', () => {
    const a = acquisitionSafety({ incomingValue: 5000, protectedValues: [9000] })!
    expect(a.protectable).toBe(true)
    expect(a.displaces).toBeNull()
  })

  it('withholds when the incoming player is unpriced', () => {
    expect(acquisitionSafety({ incomingValue: null, protectedValues: [1, 2, 3] })).toBeNull()
  })
})

describe('tradeLockNote: only the SAFE players move once games start', () => {
  it('⚠ you cannot trade your way out of this week’s exposure', () => {
    /*
     * THE RULE READS BACKWARDS UNTIL YOU SEE ITS PURPOSE. Unprotected players are
     * the steal pool. If a losing manager could ship them out mid-week the
     * winner would arrive to find nothing worth taking and the whole mechanic
     * would be dodgeable — so the takeable players are exactly the frozen ones.
     */
    const n = tradeLockNote({ inLockWindow: true, playerProtected: false })!
    expect(n).toContain('cannot be traded until Wednesday midnight')
    expect(n).toContain('stops a losing manager shipping them out')
  })

  it('⚠ a protected player CAN move, and lands unprotected on the other side', () => {
    /*
     * The trap on the receiving end: protections are frozen in the same window,
     * so an incoming player cannot be covered until Wednesday. Trade for a star
     * on Friday, lose on Sunday, and he is the first thing the winner takes.
     */
    const n = tradeLockNote({ inLockWindow: true, playerProtected: true })!
    expect(n).toContain('the only ones tradeable once the games start')
    expect(n).toContain('can lose him this week')
  })

  it('says which way the rule runs when the status is unknown', () => {
    const n = tradeLockNote({ inLockWindow: true, playerProtected: null })!
    expect(n).toContain('only PROTECTED players can be traded')
    expect(n).toContain('winner still has something to take')
  })

  it('says nothing outside the window', () => {
    expect(tradeLockNote({ inLockWindow: false, playerProtected: true })).toBeNull()
  })
})

describe('attritionNote: the pool never refills', () => {
  it('⚠ warns that "later" is a worse market, not a safer one', () => {
    const n = attritionNote({ currentWeek: 11, seasonWeeks: 17 })!
    expect(n).toContain('never refills')
    expect(n).toContain('worse market, not a safer one')
  })

  it('stays quiet early, when depth is still plentiful', () => {
    expect(attritionNote({ currentWeek: 3, seasonWeeks: 17 })).toBeNull()
  })
})

describe('⚠ the concentration correction', () => {
  const CONTEXT = readFileSync(
    resolve(process.cwd(), 'lib/league-context/leagueContextService.ts'),
    'utf8',
  )

  it('the existing strategy line says to SPREAD value', () => {
    // Documenting what is actually shipped, so the correction below is anchored
    // to a real line rather than a remembered one.
    expect(CONTEXT).toContain('Spread value across the lineup')
  })

  it('⚠ which is backwards once there is a protection cap', () => {
    /*
     * That advice is right for a pirate league with NO protection cap. With
     * three protected slots, value inside the cap is untouchable — concentrating
     * into it is the safest thing available, and spreading across nine
     * unprotected players means every loss costs someone useful.
     */
    const n = concentrationCorrectionNote({})
    expect(n).toContain('SAFEST thing you can do')
    expect(n).toContain('spreading value across an unprotected lineup')
  })

  it('is stated as a note rather than silently rewriting the other file', () => {
    // We do not know which rule set every name-detected pirate league runs, so
    // the other file's advice is left intact and this one says when it inverts.
    const SRC = readFileSync(resolve(process.cwd(), 'lib/trade-intel/pirate.ts'), 'utf8')
    expect(SRC).toContain('not know which rule set')
  })

  it('uses three slots by default, matching the pinned rules', () => {
    expect(PROTECTION_SLOTS).toBe(3)
  })
})
