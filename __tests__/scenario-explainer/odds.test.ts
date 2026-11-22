import { describe, expect, it } from 'vitest'
import type { SimInput } from '@/lib/core-app/outlookSim'
import { chopProfile, firstPickOdds, simulateChop } from '@/lib/scenario-explainer/odds'

const team = (rosterId: string, wins: number, mu: number, pointsFor = wins * 100) => ({
  rosterId, wins, losses: 6 - wins, pointsFor, profile: { mu, sigma: 15, n: 6 },
})
// Six teams, two make it; three weeks left, everyone plays.
const input: SimInput = {
  teams: [team('A', 5, 120), team('B', 4, 115), team('C', 3, 105), team('D', 3, 100), team('E', 2, 95), team('F', 0, 70, 380)],
  remaining: [1, 2, 3].flatMap((w) => [
    { week: 6 + w, a: 'A', b: 'F' }, { week: 6 + w, a: 'B', b: 'E' }, { week: 6 + w, a: 'C', b: 'D' },
  ]),
  playoffTeams: 2,
  byeTeams: 0,
}

describe('firstPickOdds', () => {
  it('the worst team is the favourite for #1 under reverse standings, and odds sum to 100', () => {
    const odds = firstPickOdds(input, 'reverse_standings', { iterations: 2000, seed: 7 })
    expect(odds.get('F')!.firstPickPct).toBeGreaterThan(90)
    const total = [...odds.values()].reduce((a, o) => a + o.firstPickPct, 0)
    expect(total).toBeCloseTo(100, 0)
    // The leader almost never misses the playoffs; the last team almost always does.
    expect(odds.get('A')!.missPlayoffsPct).toBeLessThan(10)
    expect(odds.get('F')!.missPlayoffsPct).toBeGreaterThan(99)
  })

  it('lowest points ranks by points, not record', () => {
    // E has a better record than F but far fewer points.
    const custom: SimInput = { ...input, teams: input.teams.map((t) => (t.rosterId === 'E' ? { ...t, pointsFor: 200 } : t)) }
    const odds = firstPickOdds(custom, 'lowest_points', { iterations: 2000, seed: 7 })
    expect(odds.get('E')!.firstPickPct).toBeGreaterThan(odds.get('F')!.firstPickPct)
  })

  it('a lottery averages the lottery’s own odds over the simulated tables', () => {
    const odds = firstPickOdds(input, 'lottery', {
      iterations: 1000,
      seed: 3,
      // An even lottery among the non-playoff teams of each run.
      lottery: (rows, playoffTeams) => {
        const out = rows.filter((r) => r.rank > playoffTeams)
        return new Map(out.map((r) => [r.rosterId, 1 / out.length]))
      },
    })
    expect(odds.get('F')!.firstPickPct).toBeCloseTo(25, 0)
    expect([...odds.values()].reduce((a, o) => a + o.firstPickPct, 0)).toBeCloseTo(100, 0)
  })

  it('is deterministic for a seed', () => {
    const a = firstPickOdds(input, 'reverse_standings', { iterations: 500, seed: 11 })
    const b = firstPickOdds(input, 'reverse_standings', { iterations: 500, seed: 11 })
    expect([...a.entries()]).toEqual([...b.entries()])
  })
})

describe('simulateChop', () => {
  const teams = [
    { rosterId: 'strong', mu: 130, sigma: 15 },
    { rosterId: 'mid', mu: 110, sigma: 15 },
    { rosterId: 'mid2', mu: 108, sigma: 15 },
    { rosterId: 'weak', mu: 80, sigma: 15 },
  ]

  it('the weak team is the likeliest chop, and survival falls with every chop left', () => {
    const r = simulateChop(teams, { chopWeeks: 3, teamsPerChop: 1, iterations: 3000, seed: 5 })
    expect(r.chopWeeks).toBe(3)
    expect(r.odds.get('weak')!.surviveWeekPct).toBeLessThan(15)
    expect(r.odds.get('strong')!.surviveWeekPct).toBeGreaterThan(95)
    for (const o of r.odds.values()) expect(o.surviveAllPct).toBeLessThanOrEqual(o.surviveWeekPct)
    // Exactly one team is left standing in every run.
    expect([...r.odds.values()].reduce((a, o) => a + o.surviveAllPct, 0)).toBeCloseTo(100, 0)
  })

  it('caps the chops at what the field can hold, and gives an ordered safe line', () => {
    const r = simulateChop(teams, { chopWeeks: 10, teamsPerChop: 2, iterations: 500, seed: 5 })
    expect(r.chopWeeks).toBe(1) // four teams, two per chop: one chop leaves two standing
    const line = r.safeScore.get('mid')!
    expect(line.p50).toBeLessThan(line.p80)
    expect(line.p80).toBeLessThan(line.p95)
  })
})

describe('chopProfile', () => {
  const league = { mu: 100, sigma: 20 }
  it('falls back to the league with fewer than two weeks', () => {
    expect(chopProfile([140], league)).toEqual(league)
  })
  it('shrinks a short record toward the league and never trusts a too-tight spread', () => {
    const p = chopProfile([140, 140, 140], league)
    expect(p.mu).toBe(120) // 3 weeks → half weight
    expect(p.sigma).toBe(10) // zero observed spread → half the league's
  })
})
