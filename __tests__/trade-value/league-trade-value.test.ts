/**
 * The league-graded trade value (Guap, 2026-09-24): market value × this league's scoring × the
 * viewer's roster need, every factor carried with its reason, and the grade taken on the result.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  applyLeagueAdjustments,
  describeValueBasis,
  LEAGUE_FACTOR_MAX,
  leagueTradeTotals,
  type LeagueValueAdjustment,
} from '@/lib/trade-value/leagueTradeValue'
import { allocateNeedFactors, type NeedLine } from '@/lib/trade-value/viewerNeedFactors'
import { computeRosterNeed, readSlotRequirements } from '@/lib/trade-intel/rosterNeed'
import type { ScarcityBoard } from '@/lib/trade-intel/positionScarcity'

const scoring = (factor: number): LeagueValueAdjustment => ({ kind: 'scoring', factor, reason: 'scoring' })
const need = (factor: number): LeagueValueAdjustment => ({ kind: 'need', factor, reason: 'need' })

describe('applyLeagueAdjustments', () => {
  it('multiplies the market value by every factor and keeps each one with its reason', () => {
    const v = applyLeagueAdjustments(1000, [scoring(1.2), need(1.1)])
    expect(v).toEqual({ base: 1000, leagueValue: 1320, adjustments: [scoring(1.2), need(1.1)] })
  })

  it('a factor of exactly 1 is "looked, no effect" and is not carried as an adjustment', () => {
    expect(applyLeagueAdjustments(1000, [scoring(1), null]).adjustments).toEqual([])
  })

  it('🛑 caps the PRODUCT, so stacked factors cannot triple a price', () => {
    expect(applyLeagueAdjustments(1000, [scoring(2), need(1.6)]).leagueValue).toBe(1000 * LEAGUE_FACTOR_MAX)
  })

  it('an unpriced line stays unpriced — never a zero', () => {
    expect(applyLeagueAdjustments(null, [scoring(1.3)])).toMatchObject({ base: null, leagueValue: null })
  })
})

describe('leagueTradeTotals', () => {
  it('grades on the LEAGUE values, with the formula every letter band was calibrated on', () => {
    const t = leagueTradeTotals(
      [applyLeagueAdjustments(1000, [])],
      [applyLeagueAdjustments(1000, [need(1.5)])],
    )
    expect(t).toMatchObject({ giveBase: 1000, getBase: 1000, giveLeague: 1000, getLeague: 1500 })
    // Equal on the chart; 33% your way once this roster's need is priced.
    expect(t.percentDiff).toBe(Math.round(((1500 - 1000) / 1500) * 100))
  })

  it('leaves unpriced lines out of the totals and counts them', () => {
    const t = leagueTradeTotals([applyLeagueAdjustments(null, [])], [applyLeagueAdjustments(500, [])])
    expect(t.giveLeague).toBe(0)
    expect(t.unpriced).toBe(1)
  })
})

describe('describeValueBasis', () => {
  it('names the chart and the TE premium in words', () => {
    expect(describeValueBasis({ dynasty: true, superflex: true, teams: 12, ppr: 0.5, tePremium: 0.5 })).toBe(
      'Dynasty · Superflex · 12 teams · Half PPR · TE premium +0.5',
    )
    expect(describeValueBasis({ dynasty: false, superflex: false, teams: 10, ppr: 1 })).toBe('Redraft · 1QB · 10 teams · PPR')
  })
})

describe('allocateNeedFactors — which assets a roster need applies to', () => {
  const requirements = readSlotRequirements(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN'])!
  const needOf = (positions: string[]) => computeRosterNeed({ requirements, rostered: positions })
  const emptyWire = (pos: string): ScarcityBoard => new Map([[pos, { position: pos, freeAgents: 0, scarcity: 1 }]])
  const line = (name: string, position: string | null, base: number): NeedLine => ({ name, position, base })

  it('an incoming player at a position this roster cannot fill is worth more — most when the wire is empty', () => {
    const noTe = needOf(['QB', 'RB', 'RB', 'WR', 'WR'])
    const out = allocateNeedFactors({
      give: [line('Some RB', 'RB', 2000)],
      get: [line('Trey McBride', 'TE', 4000)],
      needAfterOutgoing: noTe,
      needAfterTrade: needOf(['QB', 'RB', 'RB', 'WR', 'WR', 'TE']),
      scarcity: emptyWire('TE'),
    })
    expect(out.get[0]?.kind).toBe('need')
    expect(out.get[0]!.reason).toMatch(/^you cannot fill 1 TE slot and there is no TE available on waivers/)
    // The same hole with a full wire is a claim away, and worth much less of a premium.
    const plentiful = allocateNeedFactors({
      give: [line('Some RB', 'RB', 2000)],
      get: [line('Trey McBride', 'TE', 4000)],
      needAfterOutgoing: noTe,
      needAfterTrade: needOf(['QB', 'RB', 'RB', 'WR', 'WR', 'TE']),
      scarcity: new Map([['TE', { position: 'TE', freeAgents: 30, scarcity: 0 }]]),
    })
    expect(out.get[0]!.factor).toBeGreaterThan(plentiful.get[0]!.factor)
    expect(plentiful.get[0]!.reason).toMatch(/30 are on waivers, so this is a claim away/)
  })

  it('🛑 two receivers for ONE empty slot: only the better one gets the premium', () => {
    const oneWrShort = needOf(['QB', 'RB', 'RB', 'WR', 'TE'])
    const out = allocateNeedFactors({
      give: [],
      get: [line('WR two', 'WR', 3000), line('WR one', 'WR', 6000)],
      needAfterOutgoing: oneWrShort,
      needAfterTrade: needOf(['QB', 'RB', 'RB', 'WR', 'TE', 'WR', 'WR']),
      scarcity: emptyWire('WR'),
    })
    expect(out.get[1]?.factor).toBeGreaterThan(1)
    expect(out.get[0]).toBeNull()
  })

  it('🛑 sending away a starter the trade does not replace costs more than his market price', () => {
    const out = allocateNeedFactors({
      give: [line('Only TE', 'TE', 3000)],
      get: [line('A WR', 'WR', 3000)],
      needAfterOutgoing: needOf(['QB', 'RB', 'RB', 'WR', 'WR']),
      needAfterTrade: needOf(['QB', 'RB', 'RB', 'WR', 'WR', 'WR']),
      scarcity: emptyWire('TE'),
    })
    expect(out.give[0]?.factor).toBeGreaterThan(1)
    expect(out.give[0]!.reason).toMatch(/^after this trade you cannot fill 1 TE slot/)
  })

  it('a like-for-like swap at one position is priced up on BOTH sides, so it nets out', () => {
    const out = allocateNeedFactors({
      give: [line('TE out', 'TE', 3000)],
      get: [line('TE in', 'TE', 3000)],
      needAfterOutgoing: needOf(['QB', 'RB', 'RB', 'WR', 'WR']),
      needAfterTrade: needOf(['QB', 'RB', 'RB', 'WR', 'WR', 'TE']),
      scarcity: emptyWire('TE'),
    })
    // After the swap the TE slot is filled, so the outgoing TE leaves no hole and is not priced up.
    expect(out.get[0]?.factor).toBeGreaterThan(1)
    expect(out.give[0]).toBeNull()
  })

  it('a position this roster already has depth at is worth slightly less, to every incoming body', () => {
    const deepAtRb = needOf(['QB', 'RB', 'RB', 'RB', 'RB', 'WR', 'WR', 'TE'])
    const out = allocateNeedFactors({
      give: [],
      get: [line('RB a', 'RB', 1000), line('RB b', 'RB', 900)],
      needAfterOutgoing: deepAtRb,
      needAfterTrade: deepAtRb,
      scarcity: new Map(),
    })
    expect(out.get.map((a) => a?.factor)).toEqual([0.96, 0.96])
    expect(out.get[0]!.reason).toMatch(/^you already start 2 RB/)
  })

  it('picks and FAAB (no position) are never need-adjusted', () => {
    const out = allocateNeedFactors({
      give: [line('2027 1st', null, 5000)],
      get: [line('$20 FAAB', null, 300)],
      needAfterOutgoing: needOf([]),
      needAfterTrade: needOf([]),
      scarcity: new Map(),
    })
    expect(out).toEqual({ give: [null], get: [null] })
  })
  it('does not give an unavailable acquisition a premium for filling a starting hole', () => {
    const out = allocateNeedFactors({
      give: [], get: [{ ...line('Injured TE', 'TE', 3000), injuryStatus: 'IR' }],
      needAfterOutgoing: needOf([]), needAfterTrade: needOf([]), scarcity: emptyWire('TE'),
    })
    expect(out.get).toEqual([null])
  })
})
