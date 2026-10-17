// @vitest-environment node
/**
 * Keeper cost in the trade evaluator (2026-09-28): read from the league's own drafts, priced only
 * where the league's rule is MEASURED, and shown BESIDE the grade — never in the letter.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  MIN_MEASURED_KEEPERS,
  draftedIdForName,
  keeperCostsBySleeperId,
  measureKeeperCostRule,
  type KeeperDraftPick,
} from '@/lib/keeper/importedKeeperCost'
import { loadTradeKeeperCosts, roundCostOnChart } from '@/lib/keeper/tradeKeeperCosts'
import { keeperCostsViewFor } from '@/components/trade-evaluator/KeeperCostNote'

const pick = (playerId: string, season: number, round: number, isKeeper = false): KeeperDraftPick => ({ playerId, season, round, isKeeper })

/** A league whose 2026 keepers each sit at the round they went in 2025 — the same-round rule. */
function sameRoundLeague(keepers = 6): KeeperDraftPick[] {
  const out: KeeperDraftPick[] = []
  for (let i = 0; i < keepers; i++) {
    out.push(pick(`k${i}`, 2025, 3 + i))
    out.push(pick(`k${i}`, 2026, 3 + i, true))
  }
  out.push(pick('fresh', 2026, 11)) // drafted fresh this season
  out.push(pick('gone', 2025, 2)) // drafted last season, not this one
  return out
}

describe('measureKeeperCostRule', () => {
  it('measures the same-round rule from the league’s own flagged keepers', () => {
    expect(measureKeeperCostRule(sameRoundLeague())).toEqual({ rule: 'same_round', season: 2026, measured: 6, agreeing: 6 })
  })

  it('does not assume a rule from too few keepers', () => {
    const r = measureKeeperCostRule(sameRoundLeague(MIN_MEASURED_KEEPERS - 1))
    expect(r.rule).toBeNull()
    expect(r.rule === null && r.reason).toMatch(/too few/)
  })

  it('does not price a league that keeps at a different round — a guessed rule prints a wrong round', () => {
    const picks = sameRoundLeague().map((p) => (p.season === 2026 && p.isKeeper ? { ...p, round: p.round - 1 } : p))
    const r = measureKeeperCostRule(picks)
    expect(r.rule).toBeNull()
    expect(r.rule === null && r.reason).toMatch(/does not keep players at the round they were drafted \(0 of 6/)
  })

  it('says so when no keeper is flagged — which is every league until the draft is re-synced', () => {
    const r = measureKeeperCostRule(sameRoundLeague().map((p) => ({ ...p, isKeeper: false })))
    expect(r.rule === null && r.reason).toMatch(/No keepers are flagged in this league's 2026 draft/)
  })

  it('has nothing to measure without a draft', () => {
    expect(measureKeeperCostRule([]).rule).toBeNull()
  })
})

describe('keeperCostsBySleeperId / draftedIdForName', () => {
  it('costs every player in THIS season’s draft at his round, kept or fresh — and nobody else', () => {
    const picks = sameRoundLeague()
    const costs = keeperCostsBySleeperId(picks, measureKeeperCostRule(picks))
    expect(costs.get('k0')).toEqual({ costRound: 3, keptThisSeason: true })
    expect(costs.get('fresh')).toEqual({ costRound: 11, keptThisSeason: false })
    expect(costs.has('gone')).toBe(false)
  })

  it('costs nothing under an unmeasured rule', () => {
    expect(keeperCostsBySleeperId(sameRoundLeague(2), measureKeeperCostRule(sameRoundLeague(2))).size).toBe(0)
  })

  it('pins a name only to the ONE drafted player who carries it', () => {
    const drafted = new Map([['a', 1], ['b', 1]])
    expect(draftedIdForName(['x', 'a'], drafted)).toBe('a')
    expect(draftedIdForName(['a', 'b'], drafted)).toBeNull()
    expect(draftedIdForName(['x'], drafted)).toBeNull()
  })
})

/** A chart, highest first: the 1st player 10,000, then 50 less per rank. */
const CHART = Array.from({ length: 300 }, (_, i) => 10000 - 50 * i)

describe('roundCostOnChart — what a keeper round buys, on the grade’s own chart', () => {
  it('is the player at the round’s middle overall pick', () => {
    // 12 teams, a 3rd: overall pick round(24 + 6.5) = 31 → the 31st player, 10,000 − 30×50.
    expect(roundCostOnChart(3, 12, CHART)).toBe(8500)
    expect(roundCostOnChart(1, 10, CHART)).toBe(CHART[5]) // round(5.5) = 6th player
  })

  it('has no price past the end of the chart, or without a round or a team count', () => {
    expect(roundCostOnChart(30, 12, CHART)).toBeNull()
    expect(roundCostOnChart(0, 12, CHART)).toBeNull()
    expect(roundCostOnChart(3, 1, CHART)).toBeNull()
  })
})

describe('loadTradeKeeperCosts', () => {
  const deps = (leagueType: string | null, picks: KeeperDraftPick[], leagueSize: number | null = 12) => ({
    loadLeague: vi.fn(async () => ({ settings: {}, leagueType, leagueSize })),
    loadPicks: vi.fn(async () => picks),
    loadChartValues: vi.fn(async () => CHART),
  })
  const players = [
    { name: 'Kept Receiver', value: 9000, candidateIds: ['k0'] },
    { name: 'Waiver Guy', value: 900, candidateIds: ['nobody'] },
  ]

  it('prices the cost round on the grade’s chart and states the surplus in the same units', async () => {
    const out = await loadTradeKeeperCosts({ leagueId: 'L', players }, deps('keeper', sameRoundLeague()))
    expect(out.applies).toBe(true)
    if (!out.applies) return
    expect(out.lines).toHaveLength(1)
    expect(out.lines[0]).toMatchObject({ name: 'Kept Receiver', costRound: 3, keptThisSeason: true, costValue: 8500 })
    expect(out.lines[0]!.surplusShare).toBeCloseTo(500 / 9000, 6)
    expect(out.lines[0]!.sentence).toBe(
      'Kept Receiver keeps at a 3rd next season (he was kept at a 3rd this season). He is worth 9,000; a 3rd here buys about 8,500 (the 31st player on the same chart), so keeping him is worth 500 more than the pick.',
    )
    expect(out.notOnFile).toEqual(['Waiver Guy'])
  })

  /**
   * 🛑 THE FIRST VERSION PRICED THE ROUND AS A DYNASTY ROOKIE PICK (a first at 950 units), so a
   * 3rd cost a few hundred and nearly every keeper read as a bargain. A 3rd in a 12-team keeper
   * league buys the ~31st player on the league's own chart.
   */
  it('never prices a keeper round as a rookie pick', async () => {
    const out = await loadTradeKeeperCosts({ leagueId: 'L', players }, deps('keeper', sameRoundLeague()))
    expect(out.applies && out.lines[0]!.costValue).toBeGreaterThan(5000)
  })

  it('says an underwater keeper costs more than he is worth — the share floors at 0', async () => {
    const out = await loadTradeKeeperCosts({ leagueId: 'L', players: [{ name: 'Kept Receiver', value: 6000, candidateIds: ['k0'] }] }, deps('keeper', sameRoundLeague()))
    expect(out.applies && out.lines[0]!.surplusShare).toBe(0)
    expect(out.applies && out.lines[0]!.sentence).toMatch(/keeping him costs 2,500 more than he is worth\.$/)
  })

  it('states the round without a surplus when the grade has no value for him', async () => {
    const out = await loadTradeKeeperCosts({ leagueId: 'L', players: [{ name: 'Kept Receiver', value: null, candidateIds: ['k0'] }] }, deps('keeper', sameRoundLeague()))
    expect(out.applies && out.lines[0]!.sentence).toBe('Kept Receiver keeps at a 3rd next season (he was kept at a 3rd this season).')
    expect(out.applies && out.lines[0]!.surplusShare).toBeNull()
  })

  it('does not read the chart without the league’s team count', async () => {
    const d = deps('keeper', sameRoundLeague(), null)
    const out = await loadTradeKeeperCosts({ leagueId: 'L', players }, d)
    expect(d.loadChartValues).not.toHaveBeenCalled()
    expect(out.applies && out.lines[0]!.costValue).toBeNull()
  })

  it('reads nothing past the league row outside a keeper league', async () => {
    const d = deps('redraft', sameRoundLeague())
    expect(await loadTradeKeeperCosts({ leagueId: 'L', players }, d)).toEqual({ applies: false })
    expect(d.loadPicks).not.toHaveBeenCalled()
  })

  it('says why nothing is priced when the league’s rule is not measured', async () => {
    const out = await loadTradeKeeperCosts({ leagueId: 'L', players }, deps('keeper', sameRoundLeague(1)))
    expect(out.applies && out.note).toMatch(/^Keeper cost not priced: Only 1 flagged keeper/)
    expect(out.applies && out.lines).toEqual([])
  })

  it('never throws — an unreadable keeper note is absent, not an error on the grade', async () => {
    const failing = { loadLeague: vi.fn(async () => { throw new Error('db down') }), loadPicks: vi.fn(), loadChartValues: vi.fn() }
    expect(await loadTradeKeeperCosts({ leagueId: 'L', players }, failing as never)).toEqual({ applies: false })
  })
})

describe('the page view', () => {
  it('renders nothing outside a keeper league, or when there is nothing to say', () => {
    expect(keeperCostsViewFor({ keeperCosts: { applies: false } })).toBeNull()
    expect(keeperCostsViewFor({})).toBeNull()
    expect(keeperCostsViewFor({ keeperCosts: { applies: true, lines: [], notOnFile: ['x'], note: null } })).toBeNull()
  })

  it('carries the lines and the unmeasured-rule note', () => {
    expect(keeperCostsViewFor({ keeperCosts: { applies: true, lines: [{ name: 'A', sentence: 's' }], notOnFile: [], note: null } }))
      .toEqual({ lines: [{ name: 'A', sentence: 's' }], notOnFile: [], note: null })
    expect(keeperCostsViewFor({ keeperCosts: { applies: true, note: 'Keeper cost not priced: x.' } })?.note).toBe('Keeper cost not priced: x.')
  })
})

describe('the trade-evaluator route', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'app/api/trade-evaluator/route.ts'), 'utf8')

  it('returns keeper cost beside the grade, from the league the grade uses', () => {
    expect(route).toMatch(/keeperCosts: await keeperCostsPromise/)
    expect(route).toMatch(/loadTradeKeeperCosts\(\{\s*leagueId,/)
    expect(route).toMatch(/await evaluationLeagueIdPromise\.catch\(\(\) => null\) : null\s*\n\s*if \(!leagueId\) return \{ applies: false \}/)
  })

  /** Each player's value is the one grade's (its receipt), never the route's dynasty-chart first pass. */
  it('values each player at the one grade’s number', () => {
    expect(route).toMatch(/const receipt = await evaluationReceiptPromise\.catch\(\(\) => null\)/)
    expect(route).toMatch(/value: gradeValueByName\.get\(p\.name\.toLowerCase\(\)\.trim\(\)\) \?\? null,/)
    expect(route).not.toMatch(/loadTradeKeeperCosts\([\s\S]{0,400}value: p\.value/)
  })

  /** 🛑 Beside, not in: nothing keeper-related may reach the one grade's inputs. */
  it('keeps keeper cost out of the letter', () => {
    const gradeCall = route.slice(route.indexOf('evaluateTrade('), route.indexOf('const oneGradePayload'))
    expect(gradeCall.length).toBeGreaterThan(0)
    expect(gradeCall).not.toMatch(/keeper/i)
  })
})
