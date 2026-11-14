import { describe, expect, it } from 'vitest'
import { compareModes, replayDraft, replayKey, signTestP, type ReplayDraft, type ReplayRow } from '@/lib/shared-services/draft/backtest/draftReplay'

/*
 * Draft backtest core (2026-11-14). Pins the replay mechanics — the pool at each pick is the market
 * minus every earlier pick, the roster is that team's earlier picks, round 1 is skipped — and the
 * scoring maths the verdict on replacement value will rest on.
 */

const MARKET = [
  { name: 'QB A', position: 'QB', team: 'AAA', adp: 10, projectedPoints: 360 },
  { name: 'QB B', position: 'QB', team: 'BBB', adp: 30, projectedPoints: 300 },
  { name: 'QB C', position: 'QB', team: 'CCC', adp: 60, projectedPoints: 290 },
  { name: 'QB D', position: 'QB', team: 'DDD', adp: 90, projectedPoints: 280 },
  { name: 'RB A', position: 'RB', team: 'AAA', adp: 1, projectedPoints: 280 },
  { name: 'RB B', position: 'RB', team: 'BBB', adp: 2, projectedPoints: 270 },
  { name: 'RB C', position: 'RB', team: 'CCC', adp: 12, projectedPoints: 230 },
  { name: 'RB D', position: 'RB', team: 'DDD', adp: 14, projectedPoints: 220 },
  { name: 'WR A', position: 'WR', team: 'AAA', adp: 3, projectedPoints: 260 },
  { name: 'WR B', position: 'WR', team: 'BBB', adp: 4, projectedPoints: 255 },
  { name: 'WR C', position: 'WR', team: 'CCC', adp: 11, projectedPoints: 240 },
  { name: 'WR D', position: 'WR', team: 'DDD', adp: 13, projectedPoints: 235 },
]

const DRAFT: ReplayDraft = {
  id: 'd1',
  totalTeams: 2,
  rosterSlots: ['QB', 'RB', 'WR'],
  picks: [
    { overall: 1, round: 1, teamKey: 't1', playerName: 'RB A', position: 'RB' },
    { overall: 2, round: 1, teamKey: 't2', playerName: 'RB B', position: 'RB' },
    { overall: 3, round: 2, teamKey: 't2', playerName: 'WR A', position: 'WR' },
    { overall: 4, round: 2, teamKey: 't1', playerName: 'WR B', position: 'WR' },
  ],
}

const OUTCOME = new Map(MARKET.map((p, i) => [replayKey(p.name, p.position), 100 + i]))

describe('replayDraft', () => {
  const rows = replayDraft({ draft: DRAFT, market: MARKET, outcomePoints: OUTCOME, modes: ['observe', 'active'] })

  it('skips round 1 and replays every later pick', () => {
    expect(rows.map((r) => r.overall)).toEqual([3, 4])
  })

  it('never recommends a player already taken at that point', () => {
    for (const r of rows) {
      const takenBefore = DRAFT.picks.filter((p) => p.overall < r.overall).map((p) => p.playerName)
      for (const m of Object.values(r.byMode)) expect(takenBefore).not.toContain(m!.name)
    }
  })

  it('records the actual pick and each mode’s recommendation with their outcomes', () => {
    const third = rows[0]!
    expect(third.actual).toEqual({ name: 'WR A', points: OUTCOME.get(replayKey('WR A', 'WR')) })
    for (const mode of ['observe', 'active'] as const) {
      const rec = third.byMode[mode]!
      const position = MARKET.find((p) => p.name === rec.name)!.position
      expect(rec.points).toBe(OUTCOME.get(replayKey(rec.name, position)))
    }
  })
})

describe('compareModes', () => {
  const row = (a: string, ap: number, b: string, bp: number): ReplayRow => ({
    draftId: 'd',
    overall: 1,
    round: 2,
    actual: { name: 'x', points: 0 },
    byMode: { active: { name: a, points: ap }, observe: { name: b, points: bp } },
  })

  it('counts only disagreements, and wins/losses/ties on them', () => {
    const c = compareModes(
      [row('X', 10, 'X', 10), row('A', 20, 'B', 10), row('A', 5, 'B', 15), row('A', 7, 'B', 7), row('A', 30, 'B', 0)],
      'active',
      'observe',
    )
    expect(c).toMatchObject({ compared: 5, disagreed: 4, aWins: 2, bWins: 1, ties: 1 })
    expect(c.meanDiff).toBe(Math.round(((10 - 10 + 0 + 30) / 4) * 10) / 10)
  })

  it('ignores picks where an outcome is unknown', () => {
    const c = compareModes([{ ...row('A', 1, 'B', 2), byMode: { active: { name: 'A', points: null }, observe: { name: 'B', points: 2 } } }], 'active', 'observe')
    expect(c.compared).toBe(0)
    expect(c.signTestP).toBeNull()
  })
})

describe('signTestP', () => {
  it('matches the exact binomial', () => {
    expect(signTestP(5, 5)).toBe(1)
    // 9 of 10: P(X<=1) = 11/1024; two-sided 22/1024.
    expect(signTestP(9, 1)!).toBeCloseTo(22 / 1024, 10)
    expect(signTestP(0, 0)).toBeNull()
  })
})
