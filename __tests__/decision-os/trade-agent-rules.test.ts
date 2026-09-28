import { describe, expect, it } from 'vitest'
import {
  agentLeagueRefusal,
  dealKeyOf,
  inAgentWindow,
  qualifyDeal,
  rankSuggestions,
  runDateOf,
  type AgentSuggestion,
} from '@/lib/decision-os/trade/tradeAgentRules'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'

const graded = (letter: 'A' | 'B' | 'C' | 'D' | 'F', fit: number | null, percentDiff = 0): TradeGradeView =>
  ({
    graded: true,
    letter,
    partnerLetter: letter,
    percentDiff,
    label: 'Even',
    sideAdvantage: 'even',
    action: 'review',
    recommendation: '',
    giveValue: 1000,
    getValue: 1000,
    giveMarket: 1000,
    getMarket: 1000,
    basis: 'Dynasty chart',
    scoringApplied: true,
    needApplied: false,
    needGap: null,
    lines: [],
    moves: [],
    rosterFit: fit == null ? null : { giveValue: 1000, getValue: 1000, percentDiff: fit, moves: [] },
  }) as TradeGradeView

describe('agentLeagueRefusal — which leagues the agent works in', () => {
  it('NFL redraft, dynasty and keeper leagues', () => {
    for (const leagueType of ['redraft', 'dynasty', 'keeper']) expect(agentLeagueRefusal({ sport: 'NFL', leagueType })).toBeNull()
  })

  it('refuses other sports, no-trade formats and other league types, each with a reason', () => {
    expect(agentLeagueRefusal({ sport: 'NCAAF', leagueType: 'redraft' })).toMatch(/NFL leagues only/)
    expect(agentLeagueRefusal({ sport: 'NFL', leagueType: 'redraft', concept: 'guillotine' })).toMatch(/does not allow trades/)
    expect(agentLeagueRefusal({ sport: 'NFL', leagueType: 'devy' })).toMatch(/devy leagues yet/)
  })
})

describe('qualifyDeal — near-even AND both rosters gain', () => {
  it('a C/C deal on which both rosters gain qualifies, carrying each side’s gain', () => {
    expect(qualifyDeal(graded('C', 6), graded('C', 4))).toEqual({ ok: true, viewerFitPct: 6, partnerFitPct: 4 })
  })

  it('anything but C for either side is out — the mirror makes a B for one a D for the other', () => {
    expect(qualifyDeal(graded('B', 20), graded('C', 4))).toMatchObject({ ok: false, why: expect.stringMatching(/B\/C/) })
    expect(qualifyDeal(graded('C', 6), graded('D', 4))).toMatchObject({ ok: false })
  })

  it('a side whose roster does not gain, or cannot be priced, is out', () => {
    expect(qualifyDeal(graded('C', 6), graded('C', 0))).toMatchObject({ ok: false, why: expect.stringMatching(/partner’s roster does not gain/) })
    expect(qualifyDeal(graded('C', -2), graded('C', 5))).toMatchObject({ ok: false, why: expect.stringMatching(/viewer’s roster does not gain/) })
    expect(qualifyDeal(graded('C', null), graded('C', 5))).toMatchObject({ ok: false, why: expect.stringMatching(/could not be priced for the viewer/) })
    expect(qualifyDeal(graded('C', 5), graded('C', null))).toMatchObject({ ok: false, why: expect.stringMatching(/could not be priced for the partner/) })
  })

  it('an ungraded side is out, with its reason', () => {
    expect(qualifyDeal({ graded: false, reason: 'unpriced', basis: null }, graded('C', 4))).toMatchObject({ ok: false, why: 'not graded: unpriced' })
  })
})

const s = (key: string, viewer: number, partner: number, gap = 0): AgentSuggestion => ({
  partnerRosterId: 'p',
  partnerName: null,
  give: [],
  get: [],
  dealKey: key,
  letter: 'C',
  partnerLetter: 'C',
  percentDiff: gap,
  giveValue: 1,
  getValue: 1,
  viewerFitPct: viewer,
  partnerFitPct: partner,
  basis: '',
})

describe('rankSuggestions', () => {
  it('ranks by the worse-off side’s gain, then the closer gap, keeps one of each deal and at most three', () => {
    const out = rankSuggestions([s('a', 20, 1), s('b', 5, 5, 8), s('c', 4, 6), s('b', 5, 5, 8), s('d', 5, 5, 2), s('e', 3, 3)])
    expect(out.map((x) => x.dealKey)).toEqual(['d', 'b', 'c'])
  })
})

describe('dealKeyOf / window / run date', () => {
  it('the same deal keys the same however its players were listed', () => {
    const a = { playerId: '1', name: 'A', position: 'WR' }
    const b = { playerId: '2', name: 'B', position: 'RB' }
    const c = { playerId: '3', name: 'C', position: 'QB' }
    expect(dealKeyOf([a, b], [c])).toBe(dealKeyOf([b, a], [c]))
    expect(dealKeyOf([a], [c])).not.toBe(dealKeyOf([c], [a]))
  })

  it('works 03:00–10:59 UTC and dates a run by its UTC day', () => {
    expect(inAgentWindow(new Date('2026-09-28T03:00:00Z'))).toBe(true)
    expect(inAgentWindow(new Date('2026-09-28T10:59:00Z'))).toBe(true)
    expect(inAgentWindow(new Date('2026-09-28T11:00:00Z'))).toBe(false)
    expect(inAgentWindow(new Date('2026-09-28T02:59:00Z'))).toBe(false)
    expect(runDateOf(new Date('2026-09-28T04:30:00Z'))).toBe('2026-09-28')
  })
})
