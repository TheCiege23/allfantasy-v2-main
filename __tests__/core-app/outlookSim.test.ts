import { describe, expect, it } from 'vitest'
import {
  bandAround,
  mathStatus,
  pctOf,
  readMilestones,
  scheduleStrength,
  simulateOddsBands,
  simulateSeason,
  standardByes,
  type SimInput,
  type SimTeam,
} from '@/lib/core-app/outlookSim'

function team(id: string, wins: number, losses: number, mu = 100, sigma = 20, n = 12, pointsFor = wins * 100): SimTeam {
  return { rosterId: id, wins, losses, pointsFor, profile: { mu, sigma, n } }
}

/** Round-robin of the ids for `weeks` weeks, starting at `firstWeek`. */
function schedule(ids: string[], weeks: number, firstWeek = 5) {
  const games = []
  const list = [...ids]
  for (let w = 0; w < weeks; w += 1) {
    for (let i = 0; i < list.length / 2; i += 1) {
      games.push({ week: firstWeek + w, a: list[i], b: list[list.length - 1 - i] })
    }
    list.splice(1, 0, list.pop()!)
  }
  return games
}

const IDS = ['1', '2', '3', '4', '5', '6', '7', '8']

function league(over: Partial<SimInput> = {}): SimInput {
  return {
    teams: IDS.map((id, i) => team(id, 3, 1, 100 + (IDS.length - i) * 2)),
    remaining: schedule(IDS, 6),
    playoffTeams: 4,
    byeTeams: 0,
    ...over,
  }
}

describe('standardByes', () => {
  it('is the gap to the next power of two', () => {
    expect([2, 4, 5, 6, 7, 8, 10].map(standardByes)).toEqual([0, 0, 3, 2, 1, 0, 6])
  })
})

describe('simulateSeason', () => {
  it('is deterministic for the same inputs and seed', () => {
    const a = simulateSeason(league(), { iterations: 800, seed: 42 })
    const b = simulateSeason(league(), { iterations: 800, seed: 42 })
    expect(a).toEqual(b)
  })

  it('fills the field and the bye line exactly once per run', () => {
    const input = league({ playoffTeams: 6, byeTeams: 2 })
    const t = simulateSeason(input, { iterations: 500, seed: 7 })
    const sum = (k: 'playoff' | 'bye' | 'title') => Object.values(t.counts).reduce((a, c) => a + c[k], 0)
    expect(sum('playoff')).toBe(6 * 500)
    expect(sum('bye')).toBe(2 * 500)
    expect(sum('title')).toBe(500)
  })

  it('plays a first-round bye as one: equal teams, bye seeds win the title twice as often', () => {
    // No games left, so seeding is fixed by the record; every team is identical otherwise.
    const teams = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => team(id, 10 - i, i, 100, 20, 12))
    const input: SimInput = { teams, remaining: [], playoffTeams: 6, byeTeams: 2 }
    const t = simulateSeason(input, { iterations: 6000, seed: 3 })
    const title = (id: string) => pctOf(t.counts[id].title, 6000)
    expect(title('a')).toBeGreaterThan(21)
    expect(title('a')).toBeLessThan(29)
    expect(title('c')).toBeGreaterThan(9)
    expect(title('c')).toBeLessThan(16)
    expect(t.counts.a.bye).toBe(6000)
    expect(t.counts.c.bye).toBe(0)
  })

  it('moves the right way under a forced result', () => {
    const input = league()
    const next = input.remaining.find((g) => g.a === '5' || g.b === '5')!
    const opp = next.a === '5' ? next.b : next.a
    const win = simulateSeason(input, { iterations: 1500, seed: 9, forced: [{ ...next, winner: '5' }] })
    const lose = simulateSeason(input, { iterations: 1500, seed: 9, forced: [{ ...next, winner: opp }] })
    expect(win.counts['5'].playoff).toBeGreaterThan(lose.counts['5'].playoff)
  })

  it('moves the right way under a scoring adjustment, and a limited one moves it less', () => {
    const input = league()
    const base = simulateSeason(input, { iterations: 1500, seed: 11 })
    const season = simulateSeason(input, { iterations: 1500, seed: 11, adjustments: [{ rosterId: '6', points: 15 }] })
    const oneWeek = simulateSeason(input, {
      iterations: 1500,
      seed: 11,
      adjustments: [{ rosterId: '6', points: 15, fromWeek: 5, toWeek: 5 }],
    })
    expect(season.counts['6'].playoff).toBeGreaterThan(oneWeek.counts['6'].playoff)
    expect(oneWeek.counts['6'].playoff).toBeGreaterThanOrEqual(base.counts['6'].playoff)
  })

  it('a neutral schedule helps a team whose remaining opponents are the strongest', () => {
    const teams = IDS.map((id) => team(id, 2, 2, id === '1' || id === '2' || id === '3' ? 130 : 95))
    // Team 8 plays only the three strong teams from here.
    const remaining = [
      { week: 5, a: '8', b: '1' },
      { week: 6, a: '8', b: '2' },
      { week: 7, a: '8', b: '3' },
      { week: 5, a: '4', b: '5' },
      { week: 6, a: '4', b: '6' },
      { week: 7, a: '4', b: '7' },
    ]
    const input: SimInput = { teams, remaining, playoffTeams: 4, byeTeams: 0 }
    const real = simulateSeason(input, { iterations: 2000, seed: 5 })
    const neutral = simulateSeason(input, { iterations: 2000, seed: 5, neutralScheduleFor: '8' })
    expect(neutral.counts['8'].playoff).toBeGreaterThan(real.counts['8'].playoff)
  })

  it('🛑 a neutral schedule changes only who YOU play — rivals keep their games', () => {
    /*
     * The first version swapped only your opponent for the average team, which also removed that
     * game from the opponent's season. Every rival then finished with fewer wins, and in a league of
     * identical teams "your schedule" read as worth ~20 points of playoff odds. With the game split
     * in two, identical teams must give a near-zero difference.
     */
    const input: SimInput = {
      teams: IDS.map((id) => team(id, 2, 2, 110, 25, 40)),
      remaining: schedule(IDS, 10),
      playoffTeams: 4,
      byeTeams: 0,
    }
    const real = simulateSeason(input, { iterations: 4000, seed: 8 })
    const neutral = simulateSeason(input, { iterations: 4000, seed: 8, neutralScheduleFor: '3' })
    expect(Math.abs(pctOf(neutral.counts['3'].playoff - real.counts['3'].playoff, 4000))).toBeLessThan(4)
    // Every rival still plays all ten of its games: 2 wins banked plus up to 10 more.
    for (const id of IDS) {
      const hist = neutral.finishes[id].winsHist
      expect(hist.length).toBe(13)
      expect(hist.reduce((a, v) => a + v, 0)).toBe(4000)
    }
    const played = (id: string) =>
      neutral.finishes[id].winsHist.reduce((a, v, w) => a + v * w, 0) / 4000 - 2
    // Averaged over runs, each rival wins about half of its ten remaining games.
    for (const id of IDS.filter((x) => x !== '3')) expect(played(id)).toBeGreaterThan(4)
  })

  it('keeps every team finish distribution, so one run serves the whole league', () => {
    const input = league()
    const t = simulateSeason(input, { iterations: 1000, seed: 1 })
    for (const id of IDS) expect(t.finishes[id].winsHist.reduce((a, v) => a + v, 0)).toBe(1000)
    // Team 4 has 3 wins and 6 games left, so it finishes between 3 and 9.
    expect(t.finishes['4'].winsHist.slice(0, 3).every((v) => v === 0)).toBe(true)
    // Runs in the field, summed over win totals, equal the playoff count.
    expect(t.finishes['4'].inByWins.reduce((a, v) => a + v, 0)).toBe(t.counts['4'].playoff)
    expect(t.cut.winsHist.reduce((a, v) => a + v, 0)).toBe(1000)
  })
})

describe('simulateOddsBands', () => {
  it('is wider for a team fitted on three weeks than on forty', () => {
    const base = league()
    const thin: SimInput = {
      ...base,
      teams: base.teams.map((t) => ({ ...t, profile: { ...t.profile!, n: t.rosterId === '5' ? 3 : 40 } })),
    }
    const thick: SimInput = {
      ...base,
      teams: base.teams.map((t) => ({ ...t, profile: { ...t.profile!, n: 40 } })),
    }
    const w = (b: { lo: number; hi: number }) => b.hi - b.lo
    const bThin = simulateOddsBands(thin, { iterations: 4000, seed: 2 })
    const bThick = simulateOddsBands(thick, { iterations: 4000, seed: 2 })
    expect(w(bThin['5'].playoff)).toBeGreaterThan(w(bThick['5'].playoff))
  })

  it('bandAround always contains the headline', () => {
    expect(bandAround({ lo: 40, hi: 50 }, 55)).toEqual({ lo: 40, hi: 55 })
    expect(bandAround({ lo: 40, hi: 50 }, 30)).toEqual({ lo: 30, hi: 50 })
  })
})

describe('mathStatus', () => {
  it('eliminates a team that cannot reach the wins already banked above it', () => {
    const teams = [team('a', 9, 0), team('b', 9, 0), team('c', 1, 8)]
    const input: SimInput = { teams, remaining: [{ week: 10, a: 'c', b: 'a' }], playoffTeams: 2, byeTeams: 0 }
    expect(mathStatus(input, 'c')).toBe('eliminated')
  })

  it('clinches a team nobody else can catch', () => {
    // b can still be caught by c (4 wins, one game left), so only a is safe.
    const teams = [team('a', 9, 0), team('b', 5, 4), team('c', 4, 5), team('d', 1, 8)]
    const input: SimInput = {
      teams,
      remaining: [{ week: 10, a: 'a', b: 'd' }, { week: 10, a: 'b', b: 'c' }],
      playoffTeams: 2,
      byeTeams: 0,
    }
    expect(mathStatus(input, 'a')).toBe('clinched')
    expect(mathStatus(input, 'b')).toBe(null)
  })

  it('does not call a tie on wins a clinch, because points for is still open', () => {
    const teams = [team('a', 5, 0), team('b', 4, 1), team('c', 4, 1)]
    const input: SimInput = {
      teams,
      remaining: [{ week: 6, a: 'b', b: 'c' }],
      playoffTeams: 1,
      byeTeams: 0,
    }
    // b or c can reach 5 wins, tying a.
    expect(mathStatus(input, 'a')).toBe(null)
  })
})

describe('scheduleStrength', () => {
  it('ranks past and remaining separately, on fitted averages', () => {
    const teams = [team('a', 1, 1, 140), team('b', 1, 1, 90), team('c', 1, 1, 100), team('d', 1, 1, 110)]
    const played = [
      { week: 1, a: 'c', b: 'a' },
      { week: 2, a: 'c', b: 'd' },
      { week: 1, a: 'b', b: 'd' },
      { week: 2, a: 'b', b: 'a' },
    ]
    const remaining = [
      { week: 3, a: 'c', b: 'b' },
      { week: 3, a: 'a', b: 'd' },
    ]
    const s = scheduleStrength({ teams, remaining, playoffTeams: 2, byeTeams: 0 }, played)
    expect(s.c.pastOpponentMu).toBe(125)
    expect(s.c.remainingOpponentMu).toBe(90)
    expect(s.c.remainingRank).toBe(4)
    expect(s.d.remainingRank).toBe(1)
    expect(s.c.leagueMu).toBe(110)
  })
})

describe('readMilestones', () => {
  it('reports the record that gets you in, never below what you already have', () => {
    const input = league()
    const tally = simulateSeason(input, { iterations: 3000, seed: 4 })
    const m = readMilestones(tally, input, '4')!
    expect(m.totalGames).toBe(10)
    expect(m.currentWins).toBe(3)
    expect(m.maxWins).toBe(9)
    expect(m.winsForLikely).not.toBeNull()
    expect(m.winsForLikely!).toBeGreaterThanOrEqual(3)
    if (m.winsForSafe != null) expect(m.winsForSafe).toBeGreaterThanOrEqual(m.winsForLikely!)
    expect(m.oddsByWins.slice(0, 3).every((v) => v === null)).toBe(true)
    expect(m.cutWinsLow!).toBeLessThanOrEqual(m.cutWinsMedian!)
    expect(m.cutWinsMedian!).toBeLessThanOrEqual(m.cutWinsHigh!)
  })

  it('is null for a team that is not modelled or not in the league', () => {
    const base = league()
    const input: SimInput = { ...base, teams: base.teams.map((t) => (t.rosterId === '5' ? { ...t, profile: null } : t)) }
    const tally = simulateSeason(input, { iterations: 100, seed: 4 })
    expect(readMilestones(tally, input, '5')).toBeNull()
    expect(readMilestones(tally, input, 'nobody')).toBeNull()
  })
})
