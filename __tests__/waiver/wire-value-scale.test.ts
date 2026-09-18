// @vitest-environment node
/**
 * The wire is scored against the wire.
 *
 * 🛑 THE OLD SCALE COULD NOT TELL TWO REAL CANDIDATES APART. `computeStartNow` normalised against the
 * dynasty trade-value band (500..8000), which a waiver player cannot occupy, so every realistic
 * candidate landed in the bottom few points and the composite was compressed into "Monitor".
 *
 * Measured read-only on production 2026-09-18 — the value of the BEST player actually available on
 * each league's wire, across 286 leagues (FantasyCalc, the source the pool prices with):
 * p25 16 · median 251 · p75 674 · p90 1,936. Only 6% of leagues had a best-available worth the
 * ~4,000 the old scale needed. On the end-to-end engine, 251 and 674 BOTH scored 21.
 */
import { describe, expect, it } from 'vitest'

import { suggestWaiverPickups } from '@/lib/waiver-ai-engine/suggest'
import { computeTeamNeeds } from '@/lib/waiver-engine/team-needs'
import type { WaiverAIServiceInput } from '@/lib/waiver-ai-engine'

const starter = (id: string, position: string, team: string, value: number) => ({
  id,
  name: id,
  position,
  team,
  slot: 'starter' as const,
  age: 26,
  value,
})
const bench = (id: string, position: string, team: string, value: number) => ({
  ...starter(id, position, team, value),
  slot: 'bench' as const,
})

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'BN']

/* Every slot filled, with one deliberately weak back at 700 — what a wire add has to beat. */
const ROSTER = [
  starter('my-qb', 'QB', 'BUF', 3200),
  starter('my-rb1', 'RB', 'DET', 2800),
  starter('my-rb2', 'RB', 'NYG', 700),
  starter('my-wr1', 'WR', 'MIA', 4100),
  starter('my-wr2', 'WR', 'CIN', 2900),
  starter('my-te', 'TE', 'KC', 2600),
  starter('my-flex', 'WR', 'LAR', 2500),
  bench('bench-wr', 'WR', 'CAR', 300),
  bench('bench-rb', 'RB', 'LV', 1100),
]

const otherRosters = () =>
  Array.from({ length: 11 }, (_, i) => ({ players: ROSTER.map((p) => ({ ...p, id: p.id + '-o' + i })) }))

function scoreAt(value: number, goal: 'balanced' | 'win-now' = 'balanced') {
  const input = {
    sport: 'NFL',
    leagueId: 'L1',
    leagueSettings: { numTeams: 12, isSF: false, isTEP: false, isDynasty: false, faabBudget: 100, faabRemaining: 60 },
    roster: ROSTER,
    rosterPositions: SLOTS,
    allLeagueRosters: otherRosters(),
    currentWeek: 3,
    goal,
    maxResults: 5,
    availablePlayers: [{ id: 'wire-rb', name: 'Wire Back', position: 'RB', team: 'SEA', age: 25, value }],
    teamNeeds: computeTeamNeeds(ROSTER, SLOTS, otherRosters(), 3),
  } as unknown as WaiverAIServiceInput

  const top = suggestWaiverPickups(input).suggestions[0]
  return top ? { score: Number(top.compositeScore), recommendation: String(top.recommendation ?? '') } : null
}

describe('a waiver candidate is scored against the waiver population', () => {
  it('🛑 tells two real candidates apart — the median wire and the p75 wire', () => {
    /* Both scored 21 on the old scale: a 2.7x difference in value producing identical advice. */
    const median = scoreAt(251)
    const p75 = scoreAt(674)
    expect(median).not.toBeNull()
    expect(p75!.score).toBeGreaterThan(median!.score)
  })

  it('🛑 calls a p90 wire player who beats your weakest starter an Add', () => {
    /*
     * 1,936 against a 700 starter. On the old scale this read 26 — "Monitor".
     * Win-now is deliberately louder than balanced, so accept Add OR stronger there rather than
     * pinning the exact rung: pinning it would make this test fail for a change that made the
     * advice MORE confident, which is not the property being guarded.
     */
    expect(scoreAt(1936)!.recommendation).toBe('Add')
    expect(['Add', 'Strong Add', 'Must Add']).toContain(scoreAt(1936, 'win-now')!.recommendation)
  })

  it('🛑 does NOT promote the median or p75 wire player, on EITHER goal', () => {
    /*
     * This is the property the cut points exist to hold. With #1036's needFit fix and these scales
     * but the OLD 45/60/75 rungs, a win-now manager was told to Add the MEDIAN player on the wire.
     */
    for (const goal of ['balanced', 'win-now'] as const) {
      expect(scoreAt(251, goal)!.recommendation).toBe('Monitor')
      expect(scoreAt(674, goal)!.recommendation).toBe('Monitor')
    }
  })

  it('still drops a player the market prices at nothing', () => {
    /* The `value < 200` entry gate is unchanged: half of production leagues have no priced wire
     * player above it, and in those "no qualifying targets" is the true answer. */
    expect(scoreAt(16)).toBeNull()
  })

  it('saturates above the wire ceiling rather than re-flattening everyone below it', () => {
    const p90 = scoreAt(1936)!.score
    const elite = scoreAt(6000)!.score
    expect(elite).toBeGreaterThanOrEqual(p90)
    /* The ceiling is the wire's p90, so the top of the range compresses — deliberately. */
    expect(elite - p90).toBeLessThan(20)
  })
})
