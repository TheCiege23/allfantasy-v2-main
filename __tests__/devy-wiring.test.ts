import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { readFormatRules } from '@/lib/trade-intel/leagueFormatRules'

/**
 * ⚠ THE FAILURE THIS FILE EXISTS FOR is the one this repo keeps repeating: a
 * module built, tested, merged and never called. `devyOutlook` was exactly that
 * on the day it landed — 13 green tests and nothing invoking it.
 *
 * These assertions are about the CALL SITE. The valuation behaviour is covered
 * by devy-outlook.test.ts; what is covered here is that a college asset in a
 * real trade actually reaches it.
 */
const SRC = readFileSync(resolve(process.cwd(), 'lib/trade-intel/tradeContextNotes.ts'), 'utf8')

describe('devy valuation is reachable from the trade console', () => {
  it('imports the devy module rather than reimplementing it', () => {
    expect(SRC).toContain("from './devyOutlook'")
    expect(SRC).toContain('refuseMixedScaleGrade')
    expect(SRC).toContain('projectDevyOutlook')
  })

  it('actually calls the identifier from the scale notes', () => {
    expect(SRC).toContain('await identifyDevyAssets(')
  })

  it('leads with the refusal, because a cross-scale verdict is a correctness problem', () => {
    // unshift, not push — same treatment impossiblePickWarning gets.
    expect(SRC).toContain('notes.unshift(devy.refusal)')
  })

  /**
   * ⚠ THE REGRESSION THAT WOULD BE INVISIBLE. assessUnpriced explains a null
   * value with "our value feed covers offence and picks only" — true of an IDP
   * linebacker, false of a devy wideout. If devy players stop being excluded
   * from that count, the deal still produces notes and they are quietly wrong.
   */
  it('excludes devy players from the generic unpriced note', () => {
    expect(SRC).toContain('notDevy(args.pricedGive)')
    expect(SRC).toContain('notDevy(args.pricedGet)')
  })

  it('only reinterprets names that carry no market price', () => {
    // A name that priced is an NFL player whatever else shares his name.
    expect(SRC).toContain('x.marketValue == null')
  })
})

describe('readFormatRules recognises the college formats', () => {
  it('devy is its own concept, not "other"', () => {
    const rules = readFormatRules({ leagueType: 'devy' })
    expect(rules.concept).toBe('devy')
  })

  it('c2c is its own concept, under each spelling the normaliser accepts', () => {
    for (const t of ['c2c', 'campus2canton', 'campus_to_canton']) {
      expect(readFormatRules({ leagueType: t }).concept).toBe('c2c')
    }
  })

  it('uppercase survives, because leagueType is not normalised for case', () => {
    expect(readFormatRules({ leagueType: 'DEVY' }).concept).toBe('devy')
  })

  /**
   * ⚠ NEITHER PICK POOL IS CLAIMED TRADEABLE. C2CLeagueConfig separates
   * supportsTradeableRookiePicks from supportsTradeableCollegePicks, and as of
   * 2026-08-25 that table holds zero rows — so there is no setting to read even
   * in principle. Returning true would invent an asset class.
   */
  it('leaves pick tradeability unknown rather than guessing', () => {
    expect(readFormatRules({ leagueType: 'devy' }).futurePicksTradeable).toBeNull()
    expect(readFormatRules({ leagueType: 'c2c' }).futurePicksTradeable).toBeNull()
  })

  it('warns about the two pick pools, because the labels look almost identical', () => {
    const notes = readFormatRules({ leagueType: 'devy' }).notes.join(' ')
    expect(notes).toContain('2027 college 1st')
    expect(notes).toMatch(/NFL rookie draft/)
  })

  it('says devy players do not score and c2c players do — the difference is the format', () => {
    expect(readFormatRules({ leagueType: 'devy' }).notes.join(' ')).toMatch(/do not score/)
    expect(readFormatRules({ leagueType: 'c2c' }).notes.join(' ')).toMatch(/DO score/)
  })

  it('does not disturb the formats that were already recognised', () => {
    expect(readFormatRules({ leagueType: 'dynasty' }).concept).toBe('dynasty')
    expect(readFormatRules({ leagueType: 'redraft' }).concept).toBe('redraft')
    expect(readFormatRules({ aliasTags: ['king_of_the_hill'], leagueType: 'redraft' }).concept).toBe(
      'king_of_the_hill',
    )
    expect(readFormatRules({ leagueType: 'something_new' }).concept).toBe('other')
  })
})
