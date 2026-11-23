import { describe, expect, it } from 'vitest'

import { afIntelligenceFor, withholdAfIntelligence } from '@/lib/core-app/afIntelligenceWithhold'
import { basicTradeScenarioText, TRADE_BREAKDOWN_LOCKED_NOTE } from '@/lib/chimmy/basicTradeAnswer'
import { getAcceptedPlansForFeature, hasFeatureAccessForPlans } from '@/lib/subscription/feature-access'
import { CORE_DEPTH } from '@/lib/core-app/coreDepthAccess'
import { OWN_GATE_CHIMMY_TOOLS, PRO_ONLY_CHIMMY_TOOLS } from '@/lib/chimmy/chimmyDepth'
import { applyTradeAnalysisDepth } from '@/lib/trade-value-console/tradeAnalysisDepth'
import { decideCoreDepth } from '@/lib/core-app/coreDepthAccess'

const LOCKED = { unlocked: false }
const OPEN = { unlocked: true }

describe('AF Intelligence — one key, three plans (owner, 2026-11-22)', () => {
  it('opens for AF Pro, AF Commissioner and AF Supreme, and for nobody else', () => {
    expect(getAcceptedPlansForFeature('af_intelligence').sort()).toEqual(['commissioner', 'pro', 'supreme'])
    for (const p of ['pro', 'commissioner', 'supreme'] as const) expect(hasFeatureAccessForPlans([p], 'active', 'af_intelligence'), p).toBe(true)
    expect(hasFeatureAccessForPlans(['war_room'], 'active', 'af_intelligence')).toBe(false)
    expect(hasFeatureAccessForPlans(['pro'], 'expired' as never, 'af_intelligence')).toBe(false)
  })

  it('is what the trade, player and AF depths read', () => {
    expect(CORE_DEPTH.trade_depth.featureId).toBe('af_intelligence')
    expect(CORE_DEPTH.player_depth.featureId).toBe('af_intelligence')
    expect(CORE_DEPTH.af_intelligence.featureId).toBe('af_intelligence')
  })
})

describe('withholdAfIntelligence', () => {
  const payload = {
    league: { id: 'L1' },
    players: [
      { id: 'a', projectedPoints: 11.5, afEngineProjectedPoints: 13.2, afEngineFrom: 2, afFactors: { multiplier: 1.1, reasons: ['hot'], unadjusted: { projectedPoints: 10.45 } } },
      { id: 'b', projectedPoints: 8, adp: 40.2, afAdp: 35.1, afAdpContributions: { market: 1 }, aiAdp: 33, aiAdpSevenDayTrend: -2 },
    ],
    when: new Date('2026-11-22T00:00:00Z'),
  }

  it('drops AF engine, AF ADP and AllFantasy-drafts ADP fields, at any depth', () => {
    const out = withholdAfIntelligence(payload)
    expect(out.players[1]).toEqual({ id: 'b', projectedPoints: 8, adp: 40.2 })
    expect(Object.keys(out.players[0]!)).toEqual(['id', 'projectedPoints'])
  })

  it('puts a factor-moved number BACK to what it was before the factors (positive control: it was moved)', () => {
    expect(payload.players[0]!.projectedPoints).not.toBe(10.45)
    expect(withholdAfIntelligence(payload).players[0]!.projectedPoints).toBe(10.45)
  })

  it('never mutates its input, and leaves Dates and an AF-free payload untouched', () => {
    const before = JSON.stringify(payload)
    const out = withholdAfIntelligence(payload)
    expect(JSON.stringify(payload)).toBe(before)
    expect(out.when).toBe(payload.when)
    const clean = { a: [{ b: 1 }], c: 'x' }
    expect(withholdAfIntelligence(clean)).toBe(clean)
  })

  it('is a no-op for an unlocked viewer or a surface with no paywall read', () => {
    expect(afIntelligenceFor(payload, OPEN)).toBe(payload)
    expect(afIntelligenceFor(payload, null)).toBe(payload)
    expect(afIntelligenceFor(payload, LOCKED)).not.toBe(payload)
  })
})

describe('the trade grade: basic answer free, full answer paid', () => {
  const body = {
    grade: { letter: 'B+', partnerLetter: 'C', lines: [{ name: 'X' }], moves: [{ name: 'X', reasons: ['+8% across 210 trades'] }], rosterFit: { moves: [] } },
    fairnessScore: 61, giveTotal: 100, getTotal: 110,
    tradeMarket: { moves: [] }, decisionOs: { verdict: 'accept' }, visualImpact: { impact: {} },
    tradeIntelligence: {},
  }
  const locked = decideCoreDepth('trade_depth', { live: true, startsAt: new Date('2026-10-15T04:00:00Z'), hasPlan: false })
  const open = decideCoreDepth('trade_depth', { live: true, startsAt: new Date('2026-10-15T04:00:00Z'), hasPlan: true })

  it('a locked viewer keeps the letter, fairness and totals — and loses the extended value', () => {
    const out = applyTradeAnalysisDepth(body, locked) as Record<string, unknown>
    expect(out.grade).toEqual({ letter: 'B+', partnerLetter: 'C', lines: [{ name: 'X' }] })
    expect(out).toMatchObject({ fairnessScore: 61, giveTotal: 100, getTotal: 110 })
    for (const k of ['tradeMarket', 'decisionOs', 'visualImpact', 'tradeIntelligence']) expect(out, k).not.toHaveProperty(k)
  })

  it('an unlocked viewer gets everything (positive control)', () => {
    const out = applyTradeAnalysisDepth(body, open) as Record<string, unknown>
    expect(out.grade).toEqual(body.grade)
    expect(out).toHaveProperty('decisionOs')
  })
})

describe("Chimmy's basic trade answer", () => {
  const full = [
    "TRADE SCENARIO (computed from this league's real rosters by the AllFantasy trade evaluator — repeat these numbers, do not estimate your own):",
    '- You give: A. You get: B from Team 2.',
    "- League value (this league's chart): you send 100, you receive 110 (+10); grade B+.",
    '- Why values moved, measured from completed trades on AllFantasy (cite one or two):',
    '  • B: +8% across 210 trades',
    '- Starting lineup, week 12 projections: 101.0 before, 104.0 after (+3.0).',
    '- Playoff scenario estimate: 40% before, 46% after.',
    '- Evaluation receipt: r1.',
  ].join('\n')

  it('keeps what moves and the letter, drops the breakdown, and says why', () => {
    const out = basicTradeScenarioText(full)
    expect(out).toContain('grade B+')
    expect(out).toContain('- You give: A.')
    expect(out).toContain('- Evaluation receipt: r1.')
    expect(out).not.toMatch(/210 trades|Starting lineup|Playoff scenario/)
    expect(out.endsWith(TRADE_BREAKDOWN_LOCKED_NOTE)).toBe(true)
  })

  it('passes a not-computed scenario through untouched', () => {
    const nc = 'TRADE SCENARIO: NOT COMPUTED.\nno rosters'
    expect(basicTradeScenarioText(nc)).toBe(nc)
  })

  it('runs the projection and trade tools for a free plan (own gate), never pre-refusing them', () => {
    for (const t of ['get_player_projection', 'evaluate_trade'] as const) {
      expect(OWN_GATE_CHIMMY_TOOLS).toContain(t)
      expect(PRO_ONLY_CHIMMY_TOOLS).not.toContain(t)
    }
  })
})

describe('the growth page reads the AF Intelligence locks as one group', () => {
  it('sums only the AF Intelligence sources, and names them', async () => {
    const { afIntelligenceConversion, entrySourceLabel } = await import('@/lib/admin-dashboard/growthRevenue')
    const r = (entrySource: string, viewed: number, clicked: number, paid: number) => ({ entrySource, viewed, clicked, checkouts: paid, trials: 0, paid })
    const out = afIntelligenceConversion([r('lock_af_adp_draft_room', 40, 6, 1), r('lock_chimmy_evaluate_trade', 20, 4, 2), r('win_back', 99, 50, 9), r('lock_commissioner_depth', 10, 1, 1)])
    expect(out.total).toMatchObject({ viewed: 60, clicked: 10, paid: 3 })
    expect(out.rows.map((x) => x.entrySource)).toEqual(['lock_chimmy_evaluate_trade', 'lock_af_adp_draft_room'])
    expect(entrySourceLabel('lock_af_adp_draft_room')).toBe('AF ADP lock (draft room)')
    expect(entrySourceLabel('lock_chimmy_evaluate_trade')).toBe('Chimmy: full trade breakdown')
  })
})
