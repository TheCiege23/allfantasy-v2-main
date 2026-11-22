import { describe, expect, it } from 'vitest'

import { lineupProfileFromCounts, lineupProfileFromEntries, lineupProfileFromSettings, qbClassOf } from '@/lib/league/lineupProfile'
import { computeLineupFactors, resolveLeague, type LineupObservation, type MarketBook } from '@/lib/trade-market/formatMarkets'

const SF: MarketBook = { format: 'DYNASTY', qbFormat: 'SUPERFLEX' }

describe('reading a league lineup', () => {
  it('counts a Sleeper superflex lineup and ignores bench, IR and taxi', () => {
    const p = lineupProfileFromEntries(['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'IR', 'TAXI'])!
    expect(p).toMatchObject({ qb: 1, sf: 1, rb: 2, wr: 3, te: 1, flex: 2, qbDemand: 2, qbClass: 'SUPERFLEX' })
    expect(p.label).toBe('1QB · 1SF · 2RB · 3WR · 1TE · 2FLEX')
  })

  it('tells 1QB, 2QB, superflex and 4-QB apart', () => {
    expect(lineupProfileFromEntries(['QB', 'RB', 'WR', 'TE', 'FLEX'])!.qbClass).toBe('ONE_QB')
    expect(lineupProfileFromEntries(['QB', 'QB', 'RB', 'WR'])!.qbClass).toBe('SUPERFLEX')
    expect(lineupProfileFromEntries(['QB', 'QB', 'QB', 'QB', 'RB', 'WR'])).toMatchObject({ qbDemand: 4, qbClass: 'QB_HEAVY' })
    expect(lineupProfileFromEntries(['QB', 'QB', 'SUPER_FLEX'])!.qbClass).toBe('QB_HEAVY')
    expect(qbClassOf(0)).toBeNull()
  })

  it('reads the flex families separately and spreads them into per-position demand', () => {
    const p = lineupProfileFromEntries(['QB', 'RB', 'WR', 'TE', 'WRRB_FLEX', 'REC_FLEX', 'FLEX'])!
    expect(p).toMatchObject({ wrrb: 1, rec: 1, flex: 1 })
    expect(p.demand.TE).toBeCloseTo(1 + 0.1 + 0.2, 5)
    expect(p.demand.WR).toBeCloseTo(1 + 0.45 + 0.5 + 0.8, 5)
  })

  it('reads native `starter_slots` and MFL ranges, and reports unknown slot names instead of guessing', () => {
    expect(lineupProfileFromSettings({ starter_slots: { QB: 1, SUPER_FLEX: 1, RB: 2, WR: 2, TE: 2, FLEX: 1 } })).toMatchObject({ te: 2, sf: 1, qbClass: 'SUPERFLEX' })
    expect(lineupProfileFromEntries(['QB:1-2', 'RB:2'])).toMatchObject({ qb: 2 })
    expect(lineupProfileFromEntries(['QB', 'MYSTERY'])).toMatchObject({ unknown: 1 })
    expect(lineupProfileFromSettings(null)).toBeNull()
    expect(lineupProfileFromSettings({ roster_positions: ['BN', 'BN'] })).toBeNull()
  })

  it('builds the analyzer format picker the same way', () => {
    expect(lineupProfileFromCounts({ qb: 4, rb: 2, wr: 3, te: 1, flex: 2 })).toMatchObject({ qbDemand: 4, qbClass: 'QB_HEAVY' })
  })
})

describe('resolving a trade league', () => {
  it('uses the grade’s own book rule and refuses a lineup with no quarterback slot', () => {
    const sf = resolveLeague({ id: 'L1', platformLeagueId: 'p', leagueType: 'dynasty', settings: { roster_positions: ['QB', 'SUPER_FLEX', 'RB', 'WR'] } }, false)
    expect(sf).toMatchObject({ leagueKey: 'L1', book: { format: 'DYNASTY', qbFormat: 'SUPERFLEX' }, carried: false })
    const redraft = resolveLeague({ id: 'L2', platformLeagueId: 'p', leagueType: 'redraft', settings: { roster_positions: ['QB', 'RB', 'WR'] } }, true)
    expect(redraft).toMatchObject({ book: { format: 'REDRAFT', qbFormat: 'ONE_QB' }, carried: true })
    expect(resolveLeague({ id: 'L3', platformLeagueId: 'p', leagueType: 'dynasty', settings: { roster_positions: ['RB', 'WR'] } }, false)).toBeNull()
  })
})

describe('measuring lineup factors from trades', () => {
  const standard = lineupProfileFromCounts({ qb: 1, sf: 1, rb: 2, wr: 3, te: 1, flex: 2 })!
  const twoTe = lineupProfileFromCounts({ qb: 1, sf: 1, rb: 2, wr: 3, te: 2, flex: 2 })!
  const obs = (lineup: typeof standard, ratio: number, n: number, leagues: number, position: LineupObservation['position'] = 'TE'): LineupObservation[] =>
    Array.from({ length: n }, (_, i) => ({ book: SF, position, lineup, leagueKey: `L${i % leagues}-${lineup.te}`, transactionId: `t${lineup.te}-${i}`, chartValue: 1000, observedValue: 1000 * ratio }))

  it('publishes a TE premium measured across enough trades and leagues, as the ratio of medians', () => {
    const table = computeLineupFactors([...obs(standard, 0.8, 600, 40), ...obs(twoTe, 0.88, 150, 12)], () => 1, { sinceSeason: 2026 })
    const f = table.factors.find((x) => x.position === 'TE' && x.bucket === 'high')!
    expect(f.published).toBe(true)
    expect(f.factor).toBeCloseTo(1.1, 3)
    expect(f.leagues).toBe(12)
  })

  it('withholds a factor without the breadth, and says what is missing', () => {
    const table = computeLineupFactors([...obs(standard, 0.8, 600, 40), ...obs(twoTe, 0.95, 50, 3)], () => 1, { sinceSeason: 2026 })
    const f = table.factors.find((x) => x.position === 'TE' && x.bucket === 'high')!
    expect(f.published).toBe(false)
    expect(f.note).toMatch(/50 of 100 player-trades, 3 of 8 leagues/)
  })

  it('measures quarterbacks only inside the superflex book: 3+ QB lineups against 2-QB lineups', () => {
    const fourQb = lineupProfileFromCounts({ qb: 4, rb: 2, wr: 3, te: 1, flex: 2 })!
    const oneQbBook: LineupObservation[] = obs(lineupProfileFromCounts({ qb: 1, rb: 2, wr: 3, te: 1 })!, 5, 300, 30, 'QB').map((o) => ({ ...o, book: { format: 'DYNASTY', qbFormat: 'ONE_QB' } }))
    const table = computeLineupFactors([...obs(standard, 1, 300, 30, 'QB'), ...obs(fourQb, 1.2, 120, 10, 'QB'), ...oneQbBook], () => 1, { sinceSeason: 2026 })
    expect(table.usual.QB).toEqual({ low: 2, high: 2 })
    const f = table.factors.find((x) => x.position === 'QB' && x.bucket === 'high')!
    expect(f.factor).toBeCloseTo(1.2, 3)
    expect(table.factors.some((x) => x.position === 'QB' && x.bucket === 'low')).toBe(false)
  })

  it('normalises by tier baseline so a bucket full of stars is not read as a premium', () => {
    const stars = obs(twoTe, 1.0, 150, 12).map((o) => ({ ...o, chartValue: 5000, observedValue: 5000 }))
    const table = computeLineupFactors([...obs(standard, 0.8, 600, 40), ...stars], (_b, v) => (v >= 5000 ? 1.0 : 0.8), { sinceSeason: 2026 })
    expect(table.factors.find((x) => x.position === 'TE' && x.bucket === 'high')!.factor).toBeCloseTo(1, 3)
  })

  it('caps a measured factor at the trusted range', () => {
    const table = computeLineupFactors([...obs(standard, 0.5, 600, 40), ...obs(twoTe, 1.5, 150, 12)], () => 1, { sinceSeason: 2026 })
    expect(table.factors.find((x) => x.position === 'TE' && x.bucket === 'high')!.factor).toBe(1.25)
  })
})
