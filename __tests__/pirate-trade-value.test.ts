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

describe('tradeLockNote: the window differs per player', () => {
  it('⚠ during the lock, the only tradeable players are the stealable ones', () => {
    /*
     * Protected players are frozen; everyone else trades freely. So the market
     * inside that window is made entirely of assets at risk — which is a reason
     * to deal, not a reason to wait.
     */
    const n = tradeLockNote({ inLockWindow: true, playerProtected: false })!
    expect(n).toContain('bank him before that happens')
  })

  it('says a protected player is frozen and cannot be unprotected around it', () => {
    const n = tradeLockNote({ inLockWindow: true, playerProtected: true })!
    expect(n).toContain('cannot unprotect him to get around it')
  })

  it('⚠ names the rule conflict instead of silently picking one', () => {
    /*
     * One version freezes only protected players; another closes trading
     * entirely from Thursday to Monday. Those are different rules and a manager
     * should be told to confirm rather than handed a confident answer.
     */
    const n = tradeLockNote({ inLockWindow: true, playerProtected: null })!
    expect(n).toContain('Two versions of this rule are in circulation')
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
