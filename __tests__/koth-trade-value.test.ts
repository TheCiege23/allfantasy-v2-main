import { describe, expect, it } from 'vitest'

import { readFormatRules } from '@/lib/trade-intel/leagueFormatRules'
import {
  CROWN_BONUS,
  CROWN_PENALTY_PLAYERS,
  crownConcentrationNote,
  crownRisk,
  crownValue,
  dethroneNote,
} from '@/lib/trade-intel/kingOfTheHill'

/**
 * Week 1's top scorer takes the crown and scores +10 every week until he loses.
 * When he loses he forfeits that week's top THREE scorers to waivers, and that
 * week's top scorer takes the crown. It stops at the playoffs.
 */

describe('crownValue: expected, not maximum', () => {
  it('⚠ quoting the ceiling would overstate the crown fourfold in mid-season', () => {
    /*
     * Holding to the playoffs is the maximum and almost nobody does. You keep it
     * until you lose, so the honest figure is the bonus times the weeks you
     * expect to survive — the same geometric result as a single-elimination
     * bracket.
     */
    const v = crownValue({ currentWeek: 6, playoffStartWeek: 15 })!
    expect(v.weeksRemaining).toBe(9)
    expect(v.maxPoints).toBe(90)
    expect(v.expectedPoints).toBeLessThan(25)
    expect(v.basis).toContain('You will lose')
  })

  it('never expects more than about twice the weekly bonus at even odds', () => {
    for (const wk of [1, 4, 8, 12]) {
      const v = crownValue({ currentWeek: wk, playoffStartWeek: 15 })!
      expect(v.expectedPoints).toBeLessThanOrEqual(CROWN_BONUS * 2)
    }
  })

  it('respects a stronger hold rate when one is supplied', () => {
    const even = crownValue({ currentWeek: 6, playoffStartWeek: 15 })!
    const strong = crownValue({ currentWeek: 6, playoffStartWeek: 15, holdRate: 0.8 })!
    expect(strong.expectedPoints).toBeGreaterThan(even.expectedPoints)
  })

  it('⚠ withholds once the playoffs have started, because the crown is over', () => {
    expect(crownValue({ currentWeek: 15, playoffStartWeek: 15 })).toBeNull()
    expect(crownValue({ currentWeek: 6, playoffStartWeek: null })).toBeNull()
  })
})

describe('crownRisk: the biggest single-week loss in any format here', () => {
  it('prices the three players the penalty takes', () => {
    const r = crownRisk({ rosterValues: [9000, 8000, 7000, 6000, 1000] })!
    expect(r.exposedValue).toBe(24000)
  })

  it('⚠ says the rule is that WEEK’S scorers, not your three best', () => {
    /*
     * The two come apart exactly when a manager most wants to know. Lose in a
     * week your studs busted and you shed bench pieces; lose in a week
     * everything fired and you shed your roster. A big week that still ends in a
     * loss is the worst possible outcome and nobody plans for it.
     */
    const r = crownRisk({ rosterValues: [9000, 8000, 7000] })!
    expect(r.basis).toContain("that WEEK'S top three scorers")
    expect(r.basis).toContain('worst possible outcome')
  })

  it('says the league bids for them, not that they are simply gone', () => {
    expect(crownRisk({ rosterValues: [5000, 4000, 3000] })!.basis).toContain('bid against the whole league')
  })

  it('skips unpriced players rather than counting them as zero', () => {
    const r = crownRisk({ rosterValues: [9000, null, 8000, null, 7000] })!
    expect(r.exposedValue).toBe(24000)
  })

  it('withholds when nothing is priced', () => {
    expect(crownRisk({ rosterValues: [null, null] })).toBeNull()
  })
})

describe('dethroneNote: the crown is only half the prize', () => {
  it('⚠ tells challengers to HOLD FAAB for the week the King looks beatable', () => {
    /*
     * Dethroning dumps three of his players onto waivers for everyone to bid on.
     * The best players of the season hit the wire in bursts, and only when
     * somebody topples him.
     */
    const n = dethroneNote({ viewerIsKing: false, kingName: 'Ridgeback FC' })
    expect(n).toContain('hold FAAB')
    expect(n).toContain('in bursts')
  })

  it('tells the King to trade for consistency while he holds it', () => {
    expect(dethroneNote({ viewerIsKing: true })).toContain('consistency over upside')
  })
})

describe('⚠ concentration runs OPPOSITE to Pirate here', () => {
  it('the King should spread value, because the penalty takes exactly three', () => {
    /*
     * This repo now contains both rules and applying the wrong one is worse than
     * applying neither: Pirate's protection cap rewards stacking value into
     * three men, and this format's penalty takes exactly three.
     */
    const n = crownConcentrationNote({ viewerIsKing: true })!
    expect(n).toContain('Spread value')
    expect(n).toContain('reverse of a Pirate league')
  })

  it('says nothing to a manager who is not the King', () => {
    expect(crownConcentrationNote({ viewerIsKing: false })).toBeNull()
  })

  it('uses the rule’s own numbers', () => {
    expect(CROWN_BONUS).toBe(10)
    expect(CROWN_PENALTY_PLAYERS).toBe(3)
  })
})

describe('⚠ the alias problem: four formats were pricing as something else', () => {
  it('KOTH normalises to "redraft" upstream and would lose everything', () => {
    /*
     * normalizeConcept.ts maps king_of_the_hill -> redraft and keeps the
     * original only as an alias tag. A reader trusting leagueType alone sees a
     * plain redraft league and silently drops the crown, the penalty and the
     * waiver shock.
     */
    expect(readFormatRules({ leagueType: 'redraft' }).concept).toBe('redraft')
    expect(
      readFormatRules({ leagueType: 'redraft', aliasTags: ['king_of_the_hill'] }).concept,
    ).toBe('king_of_the_hill')
  })

  it('the alias wins over the base format, because it is the more specific claim', () => {
    const r = readFormatRules({ leagueType: 'dynasty', aliasTags: ['pirate_vampire'] })
    expect(r.concept).toBe('pirate')
  })

  it('royal and idp still resolve to their base formats, which is correct', () => {
    // These two genuinely ARE their base format for valuation purposes — royal
    // is a dynasty shell and idp is a redraft scoring variant.
    expect(readFormatRules({ leagueType: 'dynasty', aliasTags: ['royal'] }).concept).toBe('dynasty')
    expect(readFormatRules({ leagueType: 'redraft', aliasTags: ['idp'] }).concept).toBe('redraft')
  })

  it('falls back to leagueType when no alias is present', () => {
    expect(readFormatRules({ leagueType: 'guillotine', aliasTags: [] }).concept).toBe('guillotine')
  })

  it('the KOTH note names the penalty and the playoff cutoff', () => {
    const r = readFormatRules({ leagueType: 'redraft', aliasTags: ['king_of_the_hill'] })
    expect(r.notes.join(' ')).toContain('forfeits')
    expect(r.notes.join(' ')).toContain('stops at the playoffs')
  })
})
