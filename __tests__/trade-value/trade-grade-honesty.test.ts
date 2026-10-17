/**
 * Trade grade audit, 2026-10-09 — the wrong-grade fixes, each pinned to the measured failure.
 *
 *   1. Outside the NFL nothing on file is a trade value. A FOUND player is unpriced with his sport's
 *      reason (the grade then withholds), never priced off `sports_players.dynasty_value` (a list
 *      position: 800 soccer players were graded on it) and never reported as "not found".
 *   2. A pick outside the NFL is unpriced. The open analyzer priced an NBA "2027 1st" off the NFL
 *      FantasyCalc chart because the pick branch had no sport check.
 *   3. Leagues created here store camelCase `scoringSettings` and `starter_slots`; reading only the
 *      snake_case keys priced them as 0-PPR, 1QB.
 *   4. Only the impossible-pick warning blocks the Trade Center verdict — the old regex also hid every
 *      Zombie league's verdict ("Zombie teams cannot trade").
 *   5. The redraft Decision OS card printed "Trade graded null — lopsided (fairness 0/100)".
 */
import { describe, expect, it, vi } from 'vitest'

const rows = vi.hoisted(() => new Map<string, Record<string, unknown>>())

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/data/players', () => ({
  getPlayer: vi.fn(async (id: string) => rows.get(id) ?? null),
  searchPlayers: vi.fn(async () => []),
}))

import { resolveAssets } from '@/lib/trade-value-console/leagueTradePricing'
import { marketContextFor } from '@/lib/trade-intel/marketContext'
import { isBlockingFormatNote, IMPOSSIBLE_PICK_MARKER } from '@/lib/trade-intel/formatNoteBlocking'
import { impossiblePickWarning } from '@/lib/trade-intel/leagueFormatRules'
import { gradeTrade } from '@/lib/decision-os/trade/tradeGrade'
import { buildTradeDCO } from '@/lib/decision-os/trade/dco'
import { decideTradeEvaluate } from '@/lib/decision-os/trade/decision'
import { fakeWorld, fakeProposal, fakeAssets, fakeSnapshot, fakeDecisionDeps } from '../decision-os/tradeFakes'
import type { ValuationContext } from '@/lib/hybrid-valuation'

const nflCtx = { asOfDate: '2026-10-09', isSuperFlex: false, numTeams: 12, fantasyCalcPlayers: [] } as unknown as ValuationContext

function row(id: string, sport: string, over: Record<string, unknown> = {}) {
  const r = {
    id, sport, name: `${sport} Player ${id}`, position: sport === 'SOCCER' ? 'MID' : 'PG', team: 'TST',
    dynastyValue: 90, projections: { points: 27.4 }, dataSource: 'provider',
    headshotUrl: null, headshotUrlLg: null, headshotUrlSm: null, logoUrl: null, injuryStatus: null,
    ...over,
  }
  rows.set(id, r)
  return r
}

async function resolveOne(sport: 'NBA' | 'SOCCER' | 'NHL', item: Parameters<typeof resolveAssets>[0][number]) {
  return resolveAssets([item], {
    effectiveSport: sport, nflCtx, waiverBudget: 100, dataGaps: [], fcPlayers: [], resolveEnrichmentIds: false,
  })
}

describe('non-NFL players are found, and unpriced with the sport reason', () => {
  it('does not price a soccer player off his list position', async () => {
    row('s1', 'SOCCER', { dynastyValue: 90 })
    const out = await resolveOne('SOCCER', { kind: 'player', playerId: 's1', name: 'SOCCER Player s1' })
    expect(out.unresolved).toEqual([])
    expect(out.priced).toHaveLength(1)
    expect(out.priced[0]).toMatchObject({ unpriced: true, value: 0 })
    expect(out.lines[0]).toMatchObject({ unpriced: true, unpricedReason: { code: 'no_feed_for_sport', label: 'No values on file for soccer players' } })
  })

  it('reports an NBA player as unpriced, not as a spelling problem', async () => {
    row('n1', 'NBA', { dynastyValue: null, projections: {} })
    const out = await resolveOne('NBA', { kind: 'player', playerId: 'n1', name: 'NBA Player n1' })
    expect(out.unresolved).toEqual([])
    expect(out.lines[0].unpricedReason).toEqual({ code: 'no_feed_for_sport', label: 'No values on file for NBA players' })
  })

  it('still reports a player nobody can find as unresolved', async () => {
    const out = await resolveOne('NHL', { kind: 'player', playerId: 'missing', name: 'Nobody Atall' })
    expect(out.unresolved).toEqual(['Nobody Atall'])
    expect(out.priced).toEqual([])
  })

  it('withholds the grade on such a deal rather than grading part of it', () => {
    const view = gradeTrade({
      giveValue: 4000, getValue: 0, giveMarket: 4000, getMarket: 0, unpriced: 1, giveCount: 1, getCount: 1,
      basis: null, scoringApplied: false, needApplied: false, needGap: null, lines: [], moves: [],
    })
    expect(view.graded).toBe(false)
  })
})

describe('picks outside the NFL', () => {
  it('refuses an NBA pick instead of quoting the NFL chart', async () => {
    const out = await resolveOne('NBA', { kind: 'pick', year: 2027, round: 1 })
    expect(out.priced[0]).toMatchObject({ unpriced: true, value: 0, type: 'pick', name: '2027 1st' })
    expect(out.lines[0]).toMatchObject({ position: 'PICK', unpricedReason: { code: 'no_pick_market', label: 'Draft picks have no NBA price yet' } })
  })

  it('names the sport in plain words', async () => {
    const out = await resolveOne('SOCCER', { kind: 'pick', year: 2028, round: 2 })
    expect(out.lines[0].unpricedReason?.label).toBe('Draft picks have no soccer price yet')
  })
})

describe('marketContextFor reads leagues created here', () => {
  it('reads a camelCase reception weight and starter_slots superflex', () => {
    const ctx = marketContextFor(
      { scoringSettings: { ppr: 0.5, rules: { ppr: 0.5, passingTouchdown: 4 } }, starter_slots: { QB: 1, RB: 2, WR: 2, TE: 1, SUPER_FLEX: 1 } },
      'redraft',
      12,
    )
    expect(ctx.scoring.format).toBe('half_ppr')
    expect(ctx.scoring.receptionWeight).toBe(0.5)
    expect(ctx.variant.superflex).toBe(true)
  })

  it('leaves an imported Sleeper league exactly as before', () => {
    const ctx = marketContextFor({ scoring_settings: { rec: 1, bonus_rec_te: 0.5 }, roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'BN'] }, 'dynasty', 12)
    expect(ctx.scoring.format).toBe('ppr')
    expect(ctx.scoring.settings).toMatchObject({ rec: 1, bonus_rec_te: 0.5 })
    expect(ctx.variant.superflex).toBe(false)
  })

  it('does not read a basketball small-forward slot as superflex', () => {
    const ctx = marketContextFor({ starter_slots: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, UTIL: 1 } }, 'redraft', 12)
    expect(ctx.variant.superflex).toBe(false)
  })

  it('recognises IDP slots written as NAME:count', () => {
    const ctx = marketContextFor({ scoring_settings: { rec: 1 }, roster_positions: ['QB:1', 'RB:2', 'LB:2', 'DB:2'] }, 'redraft', 10)
    expect(ctx.variant.idp).toBe(true)
  })

  it('still reads a league that states no reception weight as standard', () => {
    expect(marketContextFor({}, 'redraft', 12).scoring.format).toBe('std')
  })
})

describe('only the impossible-pick warning blocks the verdict', () => {
  it('blocks on the redraft impossible-pick warning', () => {
    const note = impossiblePickWarning({ rules: { futurePicksTradeable: false } as never, pickCount: 1 })
    expect(note).toContain(IMPOSSIBLE_PICK_MARKER)
    expect(isBlockingFormatNote(note)).toBe(true)
  })

  it('is the rule the Trade Center reads (not a regex of its own)', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('components/core-app/screens/TradeCenter.tsx', 'utf8')
    // Anchored to a statement start, so a comment describing the old regex cannot satisfy or trip it.
    expect(src).toMatch(/^\s*const blocked = isBlockingFormatNote\(/m)
    expect(src).not.toMatch(/^\s*const blocked = .*\/cannot\|/m)
  })

  it('does not block on informational notes that say "cannot"', () => {
    expect(isBlockingFormatNote('Zombie Universe: there are no waivers at all … Zombie teams cannot trade, so the pool of legal partners only ever shrinks.')).toBe(false)
    expect(isBlockingFormatNote('This format has two separate pick pools … because we cannot read which pool your league opens for trading.')).toBe(false)
    expect(isBlockingFormatNote(undefined)).toBe(false)
  })
})

describe('the redraft Decision OS card', () => {
  const dco = () => buildTradeDCO({
    world: fakeWorld(), userId: 'u1', leagueId: 'L1', sport: 'NFL', proposal: fakeProposal(), assets: fakeAssets(), snapshotConfidenceScore: 90,
  })

  it('never prints a null grade or a 0/100 for a missing score', async () => {
    const decision = await decideTradeEvaluate(dco(), fakeDecisionDeps({
      evaluate: async () => fakeSnapshot({ grade: { grade: null, valueDifference: null, fairnessScore: null, confidenceScore: 40, bullets: [] } as never }),
    }))
    const text = `${decision.four_answers.what_happened} ${decision.four_answers.what_to_do}`
    expect(text).not.toContain('null')
    expect(text).not.toContain('0/100')
    expect(decision.four_answers.what_happened).toMatch(/^Not graded/)
  })

  it('states the value check without the old letter scale', async () => {
    const decision = await decideTradeEvaluate(dco(), fakeDecisionDeps())
    expect(decision.four_answers.what_happened).not.toMatch(/Trade graded/)
    expect(decision.four_answers.what_happened).toContain('fairness 82/100, where 100 is even')
  })
})
