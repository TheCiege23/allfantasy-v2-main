/**
 * The Trade Center verdict is graded on LEAGUE value (Guap, 2026-09-24).
 *
 * 🛑 BEFORE: `percentDiff` came from a hidden composite built on each player's REDRAFT value, while
 * every line on screen showed his dynasty MARKET value — graded in one currency, shown in another,
 * and blind to the league's own scoring and the manager's roster. These pin the replacement:
 * market value on the league's chart × the league's scoring × the viewer's roster need, each factor
 * visible, and the grade taken on those numbers.
 */
import { describe, expect, it } from 'vitest'
import type { PricedAsset } from '@/lib/hybrid-valuation'
import { gradeOnLeagueValue } from '@/lib/trade-value-console/leagueGrade'
import type { TradeConsolePlayerLine } from '@/lib/trade-value-console/types'

function priced(name: string, position: string, marketValue: number): PricedAsset {
  return {
    name,
    type: 'player',
    value: marketValue,
    assetValue: { marketValue, impactValue: Math.round(marketValue * 0.6), vorpValue: 100, volatility: 0.1 },
    source: 'fantasycalc',
    position,
  } as PricedAsset
}

function line(name: string, position: string, marketValue: number, extra: Partial<TradeConsolePlayerLine> = {}): TradeConsolePlayerLine {
  return {
    name,
    playerId: null,
    sport: 'NFL',
    position,
    team: 'X',
    headshotUrl: null,
    logoUrl: null,
    injuryStatus: null,
    dataSource: 'deterministic',
    composite: 0,
    marketValue,
    pricedSource: 'fantasycalc',
    ...extra,
  }
}

/* A league paying tight ends 1.5 per catch against a chart fetched at full PPR (1.0). */
const TE_PREMIUM_LEAGUE = { scoringSettings: { rec: 1, bonus_rec_te: 0.5 } }
const CHART = { dynasty: true, superflex: false, teams: 12, ppr: 1 }
const TE_FIT = Math.sqrt(1 + 0.5 * 0.624) // scoringFit: points ratio, damped by the square root

describe('🛑 the grade follows the league, not the chart alone', () => {
  const deal = {
    giveLines: [line('Kenneth Walker', 'RB', 5000)],
    getLines: [line('Trey McBride', 'TE', 4500)],
    givePriced: [priced('Kenneth Walker', 'RB', 5000)],
    getPriced: [priced('Trey McBride', 'TE', 4500)],
  }

  it('on the chart alone this trade loses; in this league, for this roster, it wins — and says why', () => {
    const g = gradeOnLeagueValue({
      ...deal,
      league: TE_PREMIUM_LEAGUE,
      chart: CHART,
      needFactors: {
        give: [null],
        get: [{ kind: 'need', factor: 1.15, reason: 'you cannot fill 1 TE slot and there is no TE available on waivers' }],
        gap: null,
      },
    })

    const te = g.getLines[0]!
    expect(te.marketValue).toBe(4500)
    expect(te.leagueValue).toBe(Math.round(4500 * TE_FIT * 1.15))
    expect(te.valueAdjustments?.map((a) => a.kind)).toEqual(['scoring', 'need'])
    expect(te.valueAdjustments?.[0]?.reason).toMatch(/TE receptions are worth 1\.5 here vs 1 on the chart/)

    // The RB's reception rule matches the chart, so nothing moves him — and nothing is claimed to.
    expect(g.giveLines[0]!.leagueValue).toBe(5000)
    expect(g.giveLines[0]!.valueAdjustments).toEqual([])

    // Market: −10% for you. League: clearly your way.
    expect(g.totals.getBase - g.totals.giveBase).toBeLessThan(0)
    expect(g.totals.percentDiff).toBe(Math.round(((te.leagueValue! - 5000) / te.leagueValue!) * 100))
    expect(g.totals.percentDiff).toBeGreaterThan(10)

    expect(g.valueBasis).toEqual({
      graded: 'league',
      label: 'Dynasty · 1QB · 12 teams · PPR · TE premium +0.5',
      scoringAdjusted: true,
      needAdjusted: true,
      needGap: null,
    })
  })

  it('the grade is exactly the difference of the league values shown on the lines — nothing hidden', () => {
    const g = gradeOnLeagueValue({ ...deal, league: TE_PREMIUM_LEAGUE, chart: CHART, needFactors: null })
    const sum = (ls: TradeConsolePlayerLine[]) => ls.reduce((s, l) => s + (l.leagueValue ?? 0), 0)
    expect(g.totals.giveLeague).toBe(sum(g.giveLines))
    expect(g.totals.getLeague).toBe(sum(g.getLines))
  })

  it('without a league, nothing league-specific is applied, and the basis says so', () => {
    const g = gradeOnLeagueValue({ ...deal, league: null, chart: CHART, needFactors: null })
    expect(g.getLines[0]!.leagueValue).toBe(4500)
    expect(g.valueBasis.graded).toBe('market')
    expect(g.valueBasis.label).toMatch(/no league selected, so no league rules apply$/)
    expect(g.totals.percentDiff).toBe(-10)
  })

  it('when roster need could not be read, the reason rides along instead of a silent 1.0', () => {
    const g = gradeOnLeagueValue({
      ...deal,
      league: TE_PREMIUM_LEAGUE,
      chart: CHART,
      needFactors: { give: [null], get: [null], gap: 'which of these teams is yours — claim your team' },
    })
    expect(g.valueBasis.needAdjusted).toBe(false)
    expect(g.valueBasis.needGap).toMatch(/claim your team/)
  })

  it('a pick is priced on its curve alone — never by position scoring', () => {
    const pick = line('2027 1st', 'PICK', 3000, { pricedSource: 'pick' })
    const g = gradeOnLeagueValue({
      giveLines: [pick],
      getLines: [line('Trey McBride', 'TE', 4500)],
      givePriced: [priced('2027 1st', 'PICK', 3000)],
      getPriced: [priced('Trey McBride', 'TE', 4500)],
      league: TE_PREMIUM_LEAGUE,
      chart: CHART,
      needFactors: null,
    })
    expect(g.giveLines[0]!.valueAdjustments).toEqual([])
    expect(g.giveLines[0]!.leagueValue).toBe(3000)
  })

  it('an unpriced line stays unpriced and out of the totals — never graded as a zero', () => {
    const g = gradeOnLeagueValue({
      giveLines: [line('A defense', 'DEF', 0, { unpriced: true }), line('Kenneth Walker', 'RB', 5000)],
      getLines: [line('Trey McBride', 'TE', 4500)],
      givePriced: [priced('A defense', 'DEF', 0), priced('Kenneth Walker', 'RB', 5000)],
      getPriced: [priced('Trey McBride', 'TE', 4500)],
      league: null,
      chart: CHART,
      needFactors: null,
    })
    expect(g.giveLines[0]!.leagueValue).toBeNull()
    expect(g.totals).toMatchObject({ giveLeague: 5000, unpriced: 1 })
  })
})
