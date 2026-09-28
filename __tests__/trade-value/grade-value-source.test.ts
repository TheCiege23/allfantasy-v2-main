/**
 * Every grade line records WHICH evidence priced it and WHEN that evidence was captured (2026-09-28).
 * Before, `source` held the player record's origin (`sleeper`) and no value carried a date, so a
 * saved grade could not say which feed priced it or how old the price was.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { tradeValueAsOf, tradeValueSourceOf } from '@/lib/decision-os/trade/valueSource'
import { linesOf } from '@/lib/decision-os/trade/leagueTradeGrader'

const SYNCED = '2026-09-28T14:27:28.097Z'

describe('tradeValueSourceOf — the evidence behind one priced asset', () => {
  it.each([
    [{ source: 'fantasycalc' }, { position: 'WR', dataSource: 'sleeper' }, 'fantasycalc'],
    [{ source: 'fantasycalc' }, { position: 'PICK', dataSource: 'fantasycalc_pick' }, 'fantasycalc_pick'],
    [{ source: 'idp-vorp' }, { position: 'LB' }, 'league_idp'],
    [{ source: 'kicker-flat' }, { position: 'K' }, 'league_kicker'],
    [{ source: 'dst-flat' }, { position: 'DEF' }, 'league_defense'],
    [{ source: 'unknown' }, { position: 'FAAB', dataSource: 'league_waiver_budget' }, 'faab_formula'],
    [{ source: 'devy-option' }, { position: 'WR', dataSource: 'devy-option' }, 'devy_option'],
    [{ source: 'excel' }, { position: 'WR' }, 'historical_file'],
    [{ source: 'analytics-lifetime' }, { position: 'RB' }, 'draft_analytics'],
    [{ source: 'idp-flat-baseline' }, { position: 'LB' }, 'position_baseline'],
    [{ source: 'curve' }, { position: 'PICK' }, 'pick_curve'],
    [{ source: 'unknown' }, { position: 'C', dataSource: 'rolling' }, 'sports_db'],
  ] as const)('%j on %j → %s', (priced, line, want) => {
    expect(tradeValueSourceOf(priced, line)).toBe(want)
  })

  it('an unpriced asset has no source — never a borrowed one', () => {
    expect(tradeValueSourceOf({ source: 'fantasycalc', unpriced: true }, { position: 'WR' })).toBeNull()
    expect(tradeValueSourceOf({ source: 'fantasycalc' }, { position: 'WR', unpriced: true })).toBeNull()
  })

  it('only a market chart value is dated; league math and undated stores are not', () => {
    expect(tradeValueAsOf('fantasycalc', SYNCED)).toBe(SYNCED)
    expect(tradeValueAsOf('fantasycalc_pick', SYNCED)).toBe(SYNCED)
    for (const s of ['league_idp', 'league_kicker', 'league_defense', 'faab_formula', 'pick_curve', 'historical_file'] as const) {
      expect(tradeValueAsOf(s, SYNCED)).toBeNull()
    }
    expect(tradeValueAsOf('fantasycalc', null)).toBeNull()
  })
})

describe('linesOf — the grader writes source and age onto every line', () => {
  const line = (name: string, over: Record<string, unknown> = {}) =>
    ({ name, marketValue: 1000, leagueValue: 1000, dataSource: 'sleeper', position: 'WR', ...over }) as never
  const priced = (source: string, over: Record<string, unknown> = {}) => ({ name: 'x', source, value: 1000, ...over }) as never

  it('pairs each line with the asset that priced it, in order, on both sides', () => {
    const out = linesOf(
      {
        giveLines: [line('Market Wideout'), line('Linebacker', { position: 'LB', projectionScope: { season: 2026, week: 3 } })],
        getLines: [line('2027 Round 1', { position: 'PICK', dataSource: 'fantasycalc_pick' }), line('FAAB', { position: 'FAAB', dataSource: 'league_waiver_budget' })],
      },
      { give: [priced('fantasycalc'), priced('idp-vorp')], get: [priced('fantasycalc'), priced('unknown')] },
      SYNCED,
    )
    expect(out.map((l) => [l.side, l.name, l.valueSource, l.valueAsOf, l.valueScope])).toEqual([
      ['give', 'Market Wideout', 'fantasycalc', SYNCED, null],
      ['give', 'Linebacker', 'league_idp', null, '2026 week 3'],
      ['get', '2027 Round 1', 'fantasycalc_pick', SYNCED, null],
      ['get', 'FAAB', 'faab_formula', null, null],
    ])
    // The record's origin is kept as it was, for compatibility.
    expect(out[0]!.source).toBe('sleeper')
  })

  it('an unpriced line records no source, no age and no value', () => {
    const [l] = linesOf({ giveLines: [line('Nobody', { unpriced: true })], getLines: [] }, { give: [priced('unknown', { unpriced: true })], get: [] }, SYNCED)
    expect(l).toMatchObject({ marketValue: null, valueSource: null, valueAsOf: null })
  })

  it('[control] without the priced assets the source is not guessed', () => {
    const [l] = linesOf({ giveLines: [line('Market Wideout')], getLines: [] })
    expect(l!.valueSource).toBeNull()
  })
})
