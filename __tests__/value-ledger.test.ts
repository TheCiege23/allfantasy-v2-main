import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  classifyMicrostructure,
  leagueFitRatio,
  priceByAdjustedRank,
  priceForCounterparty,
  type ValueLedger,
} from '@/lib/trade-intel/valueLedger'
import { computeRosterNeed, readSlotRequirements } from '@/lib/trade-intel/rosterNeed'

/**
 * The ledger's whole claim is that FantasyCalc is the anchor and not the answer.
 * These pin the two ways that claim can quietly become false: a layer that
 * pretends to have run, and a ratio that leaks into the output as an invented
 * scale factor.
 */

/** A half-PPR-ish baseline: what the market price is assumed to be priced on. */
const BASELINE = {
  rec: 0.5,
  rec_yd: 0.1,
  rec_td: 6,
  rush_yd: 0.1,
  rush_td: 6,
  pass_yd: 0.04,
  pass_td: 4,
}

describe('leagueFitRatio: exact, or absent — never 1.0', () => {
  it('⚠ returns null when the league has no scoring on file', () => {
    /*
     * A 1.0 here would be a silent claim that the layer ran and found this
     * league identical to the market. "No adjustment" and "did not look" are
     * different statements, and only one of them is true.
     */
    expect(
      leagueFitRatio({
        componentStats: { rec: 80, rec_yd: 1000 },
        leagueScoring: null,
        baselineScoring: BASELINE,
      }),
    ).toBeNull()
  })

  it('returns null when the player has no projected line', () => {
    expect(
      leagueFitRatio({
        componentStats: null,
        leagueScoring: BASELINE,
        baselineScoring: BASELINE,
      }),
    ).toBeNull()
  })

  it('is 1 when the league scores exactly like the baseline', () => {
    const fit = leagueFitRatio({
      componentStats: { rec: 80, rec_yd: 1000, rec_td: 6 },
      leagueScoring: BASELINE,
      baselineScoring: BASELINE,
    })
    expect(fit).not.toBeNull()
    expect(fit!.ratio).toBeCloseTo(1, 6)
  })

  it('prices TE premium exactly, rather than estimating it', () => {
    // A full-PPR-plus-0.5 TE premium league against a half-PPR baseline. The
    // reception line is the only difference, so the ratio is arithmetic.
    const line = { rec: 80, rec_yd: 1000, rec_td: 6 }
    const fit = leagueFitRatio({
      componentStats: line,
      leagueScoring: { ...BASELINE, rec: 1.5 },
      baselineScoring: BASELINE,
    })
    // baseline: 80*0.5 + 100 + 36 = 176 ; league: 80*1.5 + 100 + 36 = 256
    expect(fit!.baselinePoints).toBeCloseTo(176, 4)
    expect(fit!.leaguePoints).toBeCloseTo(256, 4)
    expect(fit!.ratio).toBeCloseTo(256 / 176, 6)
  })

  it('prices six-point passing touchdowns', () => {
    const line = { pass_yd: 4500, pass_td: 30 }
    const fit = leagueFitRatio({
      componentStats: line,
      leagueScoring: { ...BASELINE, pass_td: 6 },
      baselineScoring: BASELINE,
    })
    // baseline: 180 + 120 = 300 ; league: 180 + 180 = 360
    expect(fit!.ratio).toBeCloseTo(360 / 300, 6)
  })

  it('⚠ refuses rather than dividing when the baseline scores the player at zero', () => {
    /*
     * The normal case for a linebacker: his league points are real and the
     * market's baseline genuinely scores him zero, so there is no ratio. A
     * division here would produce Infinity and rank every defender above every
     * quarterback in the league.
     */
    const fit = leagueFitRatio({
      componentStats: { idp_tkl_solo: 90, idp_sack: 8 },
      leagueScoring: { idp_tkl_solo: 1.5, idp_sack: 4 },
      baselineScoring: BASELINE,
    })
    expect(fit).toBeNull()
  })
})

describe('priceByAdjustedRank: the ratio reorders, it does not rescale', () => {
  const population = [
    { sleeperId: 'a', value: 9000, ratio: 1 },
    { sleeperId: 'b', value: 6000, ratio: 1 },
    { sleeperId: 'c', value: 3000, ratio: 1 },
    { sleeperId: 'd', value: 1000, ratio: 1 },
  ]

  it('⚠ every output is a value that exists on the market curve', () => {
    /*
     * This is the guarantee that makes the layer defensible. Multiplying a
     * market value by a points ratio would claim value moves linearly with
     * points — it does not, and the two sources in this repo disagree with each
     * other by 2.8x to 7.0x on the same players. So the ratio is used only to
     * order the field, and the order is priced off the real curve. The invented
     * scale must not survive into the output.
     */
    const priced = priceByAdjustedRank([
      { sleeperId: 'a', value: 9000, ratio: 1 },
      { sleeperId: 'b', value: 6000, ratio: 3 },
      { sleeperId: 'c', value: 3000, ratio: 1 },
      { sleeperId: 'd', value: 1000, ratio: 1 },
    ])
    const curve = new Set([9000, 6000, 3000, 1000])
    for (const v of priced.values()) expect(curve.has(v)).toBe(true)
    // b tripled past a, so b takes the top price and a takes second.
    expect(priced.get('b')).toBe(9000)
    expect(priced.get('a')).toBe(6000)
  })

  it('leaves the board alone when every ratio is 1', () => {
    const priced = priceByAdjustedRank(population)
    expect(priced.get('a')).toBe(9000)
    expect(priced.get('b')).toBe(6000)
    expect(priced.get('c')).toBe(3000)
    expect(priced.get('d')).toBe(1000)
  })

  it('⚠ a player with no ratio keeps his market position', () => {
    /*
     * Ordering him on a null would push him to the bottom of the board for the
     * crime of having no projection on file — turning missing data into a
     * valuation, which is the failure mode this whole module exists to avoid.
     */
    const priced = priceByAdjustedRank([
      { sleeperId: 'a', value: 9000, ratio: null },
      { sleeperId: 'b', value: 6000, ratio: 1 },
      { sleeperId: 'c', value: 3000, ratio: 1 },
    ])
    expect(priced.get('a')).toBe(9000)
  })
})

describe('classifyMicrostructure: the edge nobody was surfacing', () => {
  it('calls a rarely-traded price thin', () => {
    const m = classifyMicrostructure({
      value: 8000,
      marketStdDev: null,
      tradeFrequency: 0.004,
      trend30d: null,
    })
    expect(m.liquidity).toBe('thin')
  })

  it('calls a constantly-traded price liquid', () => {
    expect(
      classifyMicrostructure({
        value: 8000,
        marketStdDev: null,
        tradeFrequency: 0.4,
        trend30d: null,
      }).liquidity,
    ).toBe('liquid')
  })

  it('⚠ says nothing rather than "normal" when the source published no frequency', () => {
    // Null is unknown. Calling unknown liquidity "normal" is a measurement we
    // did not make.
    expect(
      classifyMicrostructure({
        value: 8000,
        marketStdDev: null,
        tradeFrequency: null,
        trend30d: null,
      }).liquidity,
    ).toBeNull()
  })

  it('⚠ judges disagreement against the player’s own value, not an absolute', () => {
    /*
     * A spread of 300 is noise on a 9,000 asset and a violent disagreement on a
     * 900 one. An absolute threshold would call the first contested and the
     * second settled — backwards in both cases.
     */
    const rich = classifyMicrostructure({
      value: 9000,
      marketStdDev: 300,
      tradeFrequency: null,
      trend30d: null,
    })
    const cheap = classifyMicrostructure({
      value: 900,
      marketStdDev: 300,
      tradeFrequency: null,
      trend30d: null,
    })
    expect(rich.agreement).toBe('settled')
    expect(cheap.agreement).toBe('contested')
  })

  it('carries momentum through untouched', () => {
    expect(
      classifyMicrostructure({
        value: 5000,
        marketStdDev: null,
        tradeFrequency: null,
        trend30d: -420,
      }).trend30d,
    ).toBe(-420)
  })
})

describe('the ledger is wired, not just built', () => {
  const GRADE = readFileSync(resolve(process.cwd(), 'lib/core-app/rosterGrade.ts'), 'utf8')
  const MYTEAM = readFileSync(resolve(process.cwd(), 'lib/core-app/myTeam.ts'), 'utf8')

  it('the roster grade reprices through the ledger', () => {
    expect(GRADE).toContain('buildValueLedger(')
    expect(GRADE).toContain('baselineScoring: BASELINE_SCORING')
  })

  it('⚠ bounds the ranking field to this league\u2019s own players', () => {
    // The comparison is between these twelve rosters, so the field to rank
    // within is the assets in play — not seven hundred prices nobody reads.
    expect(GRADE).toContain('populationIds: everyId')
  })

  it('⚠ refuses to reorder on partial coverage', () => {
    /*
     * Repricing a handful of players among a hundred and eighty would reorder
     * the whole board on information we mostly do not have, which is worse than
     * not reordering it at all.
     */
    expect(GRADE).toContain('applied.length >= priced.size * 0.5')
  })

  it('says which claim it made rather than presenting both as one', () => {
    expect(GRADE).toContain('leagueScored')
    expect(GRADE).toContain('let leagueScored = false')
  })

  it('⚠ the caller actually passes the scoring — without it the layer is inert', () => {
    /*
     * The failure this guards is the one this repo keeps hitting: a module that
     * is built, tested, merged and never executed because nothing hands it the
     * argument it needs.
     */
    const call = MYTEAM.slice(MYTEAM.indexOf('getRosterGrade({'))
    const end = call.indexOf('})')
    expect(call.slice(0, end)).toContain('scoringSettings')
    expect(call.slice(0, end)).toContain('projectionWeek')
  })
})

describe('priceForCounterparty: the third dimension', () => {
  const ledger = {
    sleeperId: 'x',
    name: 'A Back',
    position: 'RB',
    baseline: null,
    leagueFit: { factor: null, basis: '' },
    microstructure: {
      stdDev: null,
      tradeFrequency: null,
      trend30d: null,
      liquidity: null,
      agreement: null,
    },
    value: 5000,
    gaps: [],
  } as unknown as ValueLedger

  const need = computeRosterNeed({
    requirements: readSlotRequirements(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'])!,
    rostered: ['QB', 'WR', 'WR', 'WR', 'TE', 'K', 'DEF'],
  })

  it('a team that cannot fill the slot pays more', () => {
    const { price, delta } = priceForCounterparty(ledger, need)
    expect(price).toBeGreaterThan(5000)
    expect(delta.factor).toBeGreaterThan(1)
  })

  it('⚠ an unreadable roster leaves the price alone and says so', () => {
    /*
     * Not a silent 1.0 and not a refusal to price at all: the league-wide value
     * is still the best answer available, and the delta reports that the
     * counterparty layer did not run.
     */
    const { price, delta } = priceForCounterparty(ledger, null)
    expect(price).toBe(5000)
    expect(delta.factor).toBeNull()
    expect(delta.basis).toContain('cannot read')
  })

  it('carries a null value through rather than inventing one', () => {
    const unpriced = { ...ledger, value: null } as ValueLedger
    expect(priceForCounterparty(unpriced, need).price).toBeNull()
  })
})
