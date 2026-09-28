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
import { loadTradeKeeperCosts } from '@/lib/keeper/tradeKeeperCosts'
import { keeperCostsViewFor } from '@/components/trade-evaluator/KeeperCostNote'
import { buildLeagueShape } from '@/lib/trade-value/leagueShape'

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

describe('loadTradeKeeperCosts', () => {
  const shape = buildLeagueShape({ teams: 12, starterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'] })
  const deps = (leagueType: string | null, picks: KeeperDraftPick[]) => ({
    loadLeague: vi.fn(async () => ({ settings: {}, leagueType })),
    loadPicks: vi.fn(async () => picks),
  })
  const players = [
    { name: 'Kept Receiver', value: 6000, position: 'WR', candidateIds: ['k0'] },
    { name: 'Waiver Guy', value: 900, position: 'RB', candidateIds: ['nobody'] },
  ]

  it('prices a keeper league’s players and words the surplus through the keeper model', async () => {
    const out = await loadTradeKeeperCosts({ leagueId: 'L', players, shape }, deps('keeper', sameRoundLeague()))
    expect(out.applies).toBe(true)
    if (!out.applies) return
    expect(out.lines).toHaveLength(1)
    expect(out.lines[0]).toMatchObject({ name: 'Kept Receiver', costRound: 3, keptThisSeason: true })
    expect(out.lines[0]!.sentence).toMatch(/^Kept Receiver \(kept at a 3rd this season\): He keeps at a 3rd/)
    expect(out.lines[0]!.surplusShare).toBeGreaterThanOrEqual(0)
    expect(out.notOnFile).toEqual(['Waiver Guy'])
  })

  it('reads nothing past the league row outside a keeper league', async () => {
    const d = deps('redraft', sameRoundLeague())
    expect(await loadTradeKeeperCosts({ leagueId: 'L', players, shape }, d)).toEqual({ applies: false })
    expect(d.loadPicks).not.toHaveBeenCalled()
  })

  it('says why nothing is priced when the league’s rule is not measured', async () => {
    const out = await loadTradeKeeperCosts({ leagueId: 'L', players, shape }, deps('keeper', sameRoundLeague(1)))
    expect(out.applies && out.note).toMatch(/^Keeper cost not priced: Only 1 flagged keeper/)
    expect(out.applies && out.lines).toEqual([])
  })

  it('never throws — an unreadable keeper note is absent, not an error on the grade', async () => {
    const failing = { loadLeague: vi.fn(async () => { throw new Error('db down') }), loadPicks: vi.fn() }
    expect(await loadTradeKeeperCosts({ leagueId: 'L', players, shape }, failing as never)).toEqual({ applies: false })
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

  /** 🛑 Beside, not in: nothing keeper-related may reach the one grade's inputs. */
  it('keeps keeper cost out of the letter', () => {
    const gradeCall = route.slice(route.indexOf('evaluateTrade('), route.indexOf('const oneGradePayload'))
    expect(gradeCall.length).toBeGreaterThan(0)
    expect(gradeCall).not.toMatch(/keeper/i)
  })
})
