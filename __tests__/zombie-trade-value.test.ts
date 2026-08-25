import { describe, expect, it } from 'vitest'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { assessLeagueScale } from '@/lib/trade-intel/leagueScale'
import { readFormatRules } from '@/lib/trade-intel/leagueFormatRules'
import {
  BOMB_POINTS,
  bombValue,
  serumValue,
  tradeWindow,
  vetoRiskNote,
  serumStackingNote,
  weaponAcquisitionValue,
  weaponSurplus,
  WEAPON_POINTS,
} from '@/lib/trade-intel/zombie'

/**
 * Rules from the Beta Level 2025 document. Twenty teams — one Whisperer and
 * nineteen Survivors — on EIGHT-man rosters. No waivers, only free agents,
 * addable during games. Zombies cannot trade.
 */

/** 1 superflex, 4 flex, 3 bench. */
const ZOMBIE_ROSTER = ['SUPER_FLEX', 'FLEX', 'FLEX', 'FLEX', 'FLEX', 'BN', 'BN', 'BN']

describe('⚠ depth is rostered players, not team count', () => {
  it('20 teams on 8-man rosters is SHALLOWER than 12 teams on 25', () => {
    /*
     * THE BUG THIS DOCUMENT CAUGHT. The model branched on team count, so a
     * Zombie league read as "very deep" — and would have told a manager that
     * starters are irreplaceable in the one format where you can add a free
     * agent mid-game. 20 x 8 = 160 rostered, against 12 x 25 = 300.
     */
    const zombie = assessLeagueScale({ teamCount: 20, starters: ZOMBIE_ROSTER })!
    expect(zombie.scrutiny).toBe('shallow')

    const normal = assessLeagueScale({
      teamCount: 12,
      starters: [...Array(25)].map((_, i) => (i < 9 ? 'FLEX' : 'BN')),
    })!
    expect(normal.scrutiny).toBe('standard')
  })

  it('a genuinely deep league is still deep', () => {
    const deep = assessLeagueScale({
      teamCount: 32,
      starters: [...Array(30)].map((_, i) => (i < 18 ? 'FLEX' : 'BN')),
    })!
    expect(deep.scrutiny).toBe('very-deep')
  })

  it('names the real number rather than the team count', () => {
    const z = assessLeagueScale({ teamCount: 20, starters: ZOMBIE_ROSTER })!
    expect(z.notes.join(' ')).toContain('160 players are rostered')
  })
})

describe('weaponAcquisitionValue: the top-two rule IS the valuation', () => {
  it('⚠ the same weapon is worth its face value to one manager and zero to another', () => {
    /*
     * Only your best two count. A knife is 4 a week to someone holding nothing
     * and exactly nothing to someone already holding a gun and a bow. A model
     * that priced weapons by tier would be wrong in the most common case.
     */
    const toEmpty = weaponAcquisitionValue({
      held: [],
      incoming: WEAPON_POINTS.knife,
      weeksRemaining: 6,
    })
    expect(toEmpty.pointsPerWeek).toBe(4)
    expect(toEmpty.totalPoints).toBe(24)

    const toStacked = weaponAcquisitionValue({
      held: [WEAPON_POINTS.gun, WEAPON_POINTS.bow],
      incoming: WEAPON_POINTS.knife,
      weeksRemaining: 6,
    })
    expect(toStacked.pointsPerWeek).toBe(0)
    expect(toStacked.basis).toContain('worth nothing to you')
  })

  it('prices an upgrade as the improvement to the pair, not the face value', () => {
    // Holding knife+axe (4,6). A gun (10) replaces the knife: top two goes from
    // 10 to 16, so the gain is 6, not 10.
    const v = weaponAcquisitionValue({
      held: [WEAPON_POINTS.knife, WEAPON_POINTS.axe],
      incoming: WEAPON_POINTS.gun,
      weeksRemaining: 4,
    })
    expect(v.pointsPerWeek).toBe(6)
    expect(v.totalPoints).toBe(24)
  })

  it('is worth nothing with no season left', () => {
    expect(
      weaponAcquisitionValue({ held: [], incoming: WEAPON_POINTS.gun, weeksRemaining: 0 })
        .totalPoints,
    ).toBe(0)
  })
})

describe('bombValue: a bomb is not worth 35', () => {
  it('⚠ using it suppresses your own weapons that week', () => {
    /*
     * Quoting the face value overstates it by nearly double for exactly the
     * managers most likely to be offered one — the ones already holding weapons.
     */
    const armed = bombValue({ held: [WEAPON_POINTS.gun, WEAPON_POINTS.bow] })
    expect(armed.netPoints).toBe(BOMB_POINTS - 18)
    expect(armed.basis).toContain('cancels your weapons')
  })

  it('is worth the full amount to someone holding none', () => {
    expect(bombValue({ held: [] }).netPoints).toBe(BOMB_POINTS)
  })

  it('only counts the top two as suppressed', () => {
    const v = bombValue({ held: [10, 8, 6, 4] })
    expect(v.netPoints).toBe(BOMB_POINTS - 18)
  })
})

describe('serumValue: an asset that APPRECIATES as the season runs', () => {
  it('⚠ the opposite of every other format here', () => {
    /*
     * A serum is +10 only against a Zombie. Dead weight in week one, close to a
     * guaranteed +10 once the Horde has most of the league. Guillotine decays;
     * this appreciates.
     */
    const early = serumValue({ zombieCount: 1, teamCount: 20 })!
    const late = serumValue({ zombieCount: 16, teamCount: 20 })!
    expect(late.expectedPoints).toBeGreaterThan(early.expectedPoints)
    expect(late.basis).toContain('rising every week')
  })

  it('is worth nothing before anyone is infected, and says so', () => {
    const s = serumValue({ zombieCount: 0, teamCount: 20 })!
    expect(s.expectedPoints).toBe(0)
    expect(s.basis).toContain('worth nothing this week')
  })

  it('caps at the full ten once the Horde is everyone else', () => {
    const s = serumValue({ zombieCount: 19, teamCount: 20 })!
    expect(s.expectedPoints).toBe(10)
  })

  it('withholds on impossible inputs', () => {
    expect(serumValue({ zombieCount: 25, teamCount: 20 })).toBeNull()
  })
})

describe('tradeWindow: the option to deal is a wasting asset', () => {
  it('⚠ counts only teams that can legally trade', () => {
    // Zombies cannot make deals. 6 survivors plus an active Whisperer, minus
    // yourself, is 6 legal partners.
    const w = tradeWindow({ survivors: 6, whispererActive: true, teamCount: 20 })!
    expect(w.partners).toBe(6)
    expect(w.basis).toContain('only ever falls')
  })

  it('⚠ says a deal considered for "later" may not have a later', () => {
    /*
     * Infection is permanent and removes YOUR ability to trade too. Both sides
     * of every deal hold a wasting option, which is not true in any other
     * format.
     */
    const w = tradeWindow({ survivors: 3, whispererActive: false, teamCount: 20 })!
    expect(w.basis).toContain('may not have a later')
  })

  it('reports honestly when the Horde has everyone', () => {
    const w = tradeWindow({ survivors: 1, whispererActive: false, teamCount: 20 })!
    expect(w.partners).toBe(0)
    expect(w.basis).toContain('nobody left')
  })
})

describe('vetoRiskNote: procedural, not a fairness opinion', () => {
  it('⚠ warns that a lopsided deal may simply not stand', () => {
    /*
     * Two thirds of an eight-hour poll reverses a trade here. "You may not get
     * to keep this" is different information from "you are winning this", and
     * more actionable.
     */
    const n = vetoRiskNote({ percentDiff: 45 })!
    expect(n).toContain('two thirds can reverse it')
  })

  it('stays quiet on a close deal', () => {
    expect(vetoRiskNote({ percentDiff: 8 })).toBeNull()
  })

  it('fires in both directions, because either side can be the one flagged', () => {
    expect(vetoRiskNote({ percentDiff: -45 })).not.toBeNull()
  })

  it('says nothing when the console could not price the deal', () => {
    expect(vetoRiskNote({ percentDiff: null })).toBeNull()
  })
})

describe('the zombie model is actually reachable', () => {
  const SRC = readFileSync(resolve(process.cwd(), 'lib/trade-intel/tradeContextNotes.ts'), 'utf8')
  const RULES = readFileSync(resolve(process.cwd(), 'lib/trade-intel/leagueFormatRules.ts'), 'utf8')

  it('⚠ zombie is its own concept, not "other"', () => {
    expect(readFormatRules({ leagueType: 'zombie' }).concept).toBe('zombie')
  })

  it('⚠ picks ARE tradeable here — the restriction is on WHO, not what', () => {
    /*
     * The rules document calls pick trading "allowed, awesome, and encouraged".
     * The real constraint is that Zombie teams cannot trade at all, which is a
     * counterparty limit rather than an asset limit — treating it as the latter
     * would suppress an asset class the commissioner actively wants moving.
     */
    const r = readFormatRules({ leagueType: 'zombie' })
    expect(r.futurePicksTradeable).toBe(true)
    expect(r.notes.join(' ')).toContain('only ever shrinks')
  })

  it('says replacement is close to free, because there are no waivers', () => {
    expect(readFormatRules({ leagueType: 'zombie' }).notes.join(' ')).toContain('even during games')
  })

  it('the trade console routes zombie leagues to the zombie model', () => {
    expect(SRC).toContain("rules.concept === 'zombie'")
    expect(SRC).toContain('zombieNotesFor(')
  })

  it('reads survivor and horde counts from team status rather than assuming', () => {
    expect(SRC).toContain('prisma.zombieLeagueTeam')
    expect(SRC).toContain("norm(t) === 'survivor'")
    expect(SRC).toContain("norm(t) === 'whisperer'")
  })

  it('returns early rather than falling through to guillotine or keeper logic', () => {
    const block = SRC.slice(SRC.indexOf("rules.concept === 'zombie'"))
    expect(block.slice(0, 260)).toContain('return notes')
  })

  it('survivor still resolves to "other", because we have no rules for it', () => {
    expect(readFormatRules({ leagueType: 'survivor' }).concept).toBe('other')
  })
})

describe('weaponSurplus: the trade asset nobody can see', () => {
  it('⚠ a third weapon pays its holder exactly zero', () => {
    /*
     * The observed case from the 2025 Universe stats sheet: a manager holding a
     * bow, three axes and a knife. Top two count 14; the other 16 points are
     * dead. Those weapons are worth nothing to him and 6 a week to somebody
     * holding none — an asset both sides gain real points from.
     */
    const s = weaponSurplus({
      held: [WEAPON_POINTS.bow, WEAPON_POINTS.axe, WEAPON_POINTS.axe, WEAPON_POINTS.axe, WEAPON_POINTS.knife],
      weeksRemaining: 5,
    })
    expect(s.counting).toEqual([8, 6])
    expect(s.deadPointsPerWeek).toBe(16)
    expect(s.basis).toContain('cheapest real thing')
  })

  it('says nothing when nothing is going to waste', () => {
    expect(
      weaponSurplus({ held: [WEAPON_POINTS.gun, WEAPON_POINTS.bow], weeksRemaining: 5 }).basis,
    ).toBeNull()
    expect(weaponSurplus({ held: [], weeksRemaining: 5 }).basis).toBeNull()
  })

  it('keeps the BEST two, not the first two it was handed', () => {
    const s = weaponSurplus({
      held: [WEAPON_POINTS.knife, WEAPON_POINTS.gun, WEAPON_POINTS.bow],
      weeksRemaining: 3,
    })
    expect(s.counting).toEqual([10, 8])
    expect(s.surplus).toEqual([4])
  })
})

describe('serumStackingNote: serums do NOT behave like weapons', () => {
  it('⚠ a third serum is worth what the first was', () => {
    /*
     * The rules allow several serums in the same week for multiple +10s. The
     * natural assumption from the weapon cap is that items generally cap, and
     * acting on that would leave a manager refusing serums he should take.
     */
    const n = serumStackingNote({ held: 3 })!
    expect(n).toContain('do not cap')
    expect(n).toContain('third weapon')
  })

  it('stays quiet below two, where there is nothing to explain', () => {
    expect(serumStackingNote({ held: 1 })).toBeNull()
  })
})

describe('the surplus note reaches the screen', () => {
  const SRC = readFileSync(resolve(process.cwd(), 'lib/trade-intel/tradeContextNotes.ts'), 'utf8')

  it('reads the viewer’s own unused inventory', () => {
    expect(SRC).toContain('prisma.zombieTeamItem')
    expect(SRC).toContain('isUsed: false')
    expect(SRC).toContain('weaponSurplus(')
  })

  it('⚠ classifies serums and weapons separately, because they cap differently', () => {
    /*
     * A weapon we fail to recognise must not be silently counted as a serum or
     * the reverse: weapons cap at two and serums stack without limit, so getting
     * the class wrong inverts the advice.
     */
    expect(SRC).toContain("tag.includes('serum')")
    expect(SRC).toContain('serumStackingNote(')
  })
})
