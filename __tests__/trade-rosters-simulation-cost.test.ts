/**
 * `/api/leagues/[leagueId]/trades/rosters` took 21.6 s on a 32-team league (2026-09-25). Measured
 * against the test database, ~90% of it was the trade-suggestion simulation: 93 packages, each
 * running TWO full-season Monte Carlo runs, the first of which was the same run every time, and every
 * weekly sample re-sorting a roster that never changes inside the run.
 *
 * These tests pin both halves of the repair:
 *
 *   1. SAME NUMBERS. The optimised simulator must return exactly what the original returned — the
 *      odds are shown to managers and signed into proposal evidence, so "close" is not good enough.
 *      The original algorithm is copied below verbatim as the reference.
 *   2. LESS WORK. One baseline season per request instead of one per package, and no simulation at
 *      all on a repeat load with unchanged inputs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRng, prepareTeamWeeklySampler, sampleTeamWeeklyScore } from '@/lib/ai/sim/playerModel'
import type { MonteCarloOptions, SeasonSimResult, SimPlayerInput, SimTeamInput } from '@/lib/ai/sim/types'
import type { SuggestionRoster, TradePartnerSuggestion } from '@/lib/league-trade-engine/proposalSuggestions'

const seasonRuns = vi.hoisted(() => ({ count: 0 }))
vi.mock('@/lib/ai/sim/seasonSimulator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/sim/seasonSimulator')>()
  return {
    ...actual,
    simulateSeason: (...args: Parameters<typeof actual.simulateSeason>) => {
      seasonRuns.count += 1
      return actual.simulateSeason(...args)
    },
  }
})

const { simulateSeason } = await import('@/lib/ai/sim/seasonSimulator')
const { createTradeSimulator, simulateTrade } = await import('@/lib/ai/sim/tradeSimulator')
const { clearProposalSimulationMemo, enrichMultiTeamProposalSimulations, enrichProposalSimulations } = await import(
  '@/lib/league-trade-engine/proposalSimulation'
)

/* ── The original `simulateSeason`, verbatim apart from its name. The reference, not a helper. ── */
function referenceSchedule(teamIds: string[], weeks: number, rng: () => number) {
  const out: Array<Array<{ home: string; away: string }>> = []
  for (let w = 0; w < weeks; w++) {
    const row: Array<{ home: string; away: string }> = []
    const shuffled = [...teamIds].sort(() => rng() - 0.5)
    for (let i = 0; i + 1 < shuffled.length; i += 2) row.push({ home: shuffled[i]!, away: shuffled[i + 1]! })
    if (row.length === 0 && teamIds.length >= 2) row.push({ home: teamIds[0]!, away: teamIds[1]! })
    out.push(row)
  }
  return out
}
function referenceSeason(teams: SimTeamInput[], opts: MonteCarloOptions): SeasonSimResult {
  const iterations = Math.max(20, Math.min(2000, opts.iterations))
  const weeks = Math.max(1, Math.min(18, opts.weeksRemaining ?? opts.regularSeasonWeeks ?? 14))
  const playoffN = Math.max(2, Math.min(teams.length, opts.playoffTeams ?? Math.min(6, teams.length)))
  const teamIds = teams.map((t) => t.id)
  const byId = new Map(teams.map((t) => [t.id, t]))
  const champCount: Record<string, number> = Object.fromEntries(teamIds.map((id) => [id, 0]))
  const playoffCount: Record<string, number> = Object.fromEntries(teamIds.map((id) => [id, 0]))
  const winsSum: Record<string, number> = Object.fromEntries(teamIds.map((id) => [id, 0]))
  const winsBest: Record<string, number> = Object.fromEntries(teamIds.map((id) => [id, 0]))
  const winsWorst: Record<string, number> = Object.fromEntries(teamIds.map((id) => [id, weeks]))
  for (let it = 0; it < iterations; it++) {
    const rng = createRng((opts.seed ?? 1) + it * 9973)
    const schedule = referenceSchedule(teamIds, weeks, rng)
    const wins: Record<string, number> = Object.fromEntries(teamIds.map((id) => [id, 0]))
    for (let w = 0; w < weeks; w++) {
      for (const m of schedule[w] ?? []) {
        const ta = byId.get(m.home)
        const tb = byId.get(m.away)
        if (!ta || !tb) continue
        const sa = sampleTeamWeeklyScore(ta.roster, rng)
        const sb = sampleTeamWeeklyScore(tb.roster, rng)
        if (sa > sb) wins[m.home] = (wins[m.home] ?? 0) + 1
        else if (sb > sa) wins[m.away] = (wins[m.away] ?? 0) + 1
        else if (rng() < 0.5) wins[m.home] = (wins[m.home] ?? 0) + 1
        else wins[m.away] = (wins[m.away] ?? 0) + 1
      }
    }
    for (const id of teamIds) {
      winsSum[id] = (winsSum[id] ?? 0) + (wins[id] ?? 0)
      winsBest[id] = Math.max(winsBest[id] ?? 0, wins[id] ?? 0)
      winsWorst[id] = Math.min(winsWorst[id] ?? weeks, wins[id] ?? 0)
    }
    const standings = [...teamIds].sort((a, b) => (wins[b] ?? 0) - (wins[a] ?? 0))
    for (const id of new Set(standings.slice(0, playoffN))) playoffCount[id] = (playoffCount[id] ?? 0) + 1
    let remaining = standings.slice(0, playoffN)
    while (remaining.length > 1) {
      const next: string[] = []
      for (let i = 0; i < remaining.length; i += 2) {
        if (i + 1 >= remaining.length) { next.push(remaining[i]!); continue }
        const a = remaining[i]!
        const b = remaining[i + 1]!
        const ta = byId.get(a)
        const tb = byId.get(b)
        if (!ta) { next.push(b); continue }
        if (!tb) { next.push(a); continue }
        const sa = sampleTeamWeeklyScore(ta.roster, rng)
        const sb = sampleTeamWeeklyScore(tb.roster, rng)
        next.push(sa >= sb ? a : b)
      }
      remaining = next
    }
    const champ = remaining[0]
    if (champ) champCount[champ] = (champCount[champ] ?? 0) + 1
  }
  const pick = (f: (id: string) => number) => Object.fromEntries(teamIds.map((id) => [id, f(id)]))
  return {
    championshipOdds: pick((id) => (champCount[id] ?? 0) / iterations),
    playoffOdds: pick((id) => (playoffCount[id] ?? 0) / iterations),
    avgWins: pick((id) => (winsSum[id] ?? 0) / iterations),
    bestCaseWins: pick((id) => winsBest[id] ?? 0),
    worstCaseWins: pick((id) => winsWorst[id] ?? 0),
    iterations,
    weeksSimulated: weeks,
  }
}

/* ── A league with the awkward cases in it: ties in projection, trends, sparse fields, a short and an empty roster. ── */
function league(teamCount: number, seed: number): SimTeamInput[] {
  const rng = createRng(seed)
  return Array.from({ length: teamCount }, (_, t) => ({
    id: `t${t}`,
    roster: t === 3 ? [] : Array.from({ length: t === 4 ? 5 : 14 + (t % 6) }, (_, p): SimPlayerInput => ({
      id: `t${t}-p${p}`,
      position: p % 3 === 0 ? 'RB' : 'WR',
      // Rounded so several players share a projection: stable ordering is part of what is pinned.
      projection: Math.round(rng() * 20),
      variance: rng() < 0.3 ? undefined : rng() * 9,
      consistency: rng() < 0.5 ? undefined : rng(),
      injuryRisk: rng() < 0.7 ? undefined : rng(),
      usageTrend: rng() < 0.6 ? undefined : rng() - 0.5,
    })),
  }))
}

describe('prepareTeamWeeklySampler', () => {
  it('draws exactly what sampleTeamWeeklyScore draws, and consumes the same random numbers', () => {
    for (const team of league(10, 7)) {
      const sampler = prepareTeamWeeklySampler(team.roster)
      const a = createRng(99)
      const b = createRng(99)
      for (let draw = 0; draw < 25; draw += 1) expect(sampler(a)).toBe(sampleTeamWeeklyScore(team.roster, b))
      // Same stream position afterwards: the NEXT team sampled in a season would see the same numbers.
      expect(a()).toBe(b())
    }
  })
})

describe('simulateSeason', () => {
  it.each([
    { teams: 12, seed: 3, playoffTeams: 6, weeks: 11 },
    { teams: 32, seed: 11, playoffTeams: 12, weeks: 8 },
    { teams: 9, seed: 5, playoffTeams: 5, weeks: 14 },
  ])('returns the original numbers exactly ($teams teams)', ({ teams, seed, playoffTeams, weeks }) => {
    const input = league(teams, seed)
    const opts: MonteCarloOptions = { iterations: 60, seed: 99, weeksRemaining: weeks, playoffTeams }
    expect(simulateSeason(input, opts)).toEqual(referenceSeason(input, opts))
  })
})

describe('createTradeSimulator', () => {
  const teams = league(12, 21)
  const base = { teams, beforePlayers: teams[0]!.roster, focusedTeamId: 't0', iterations: 60, weeksRemaining: 10, leagueSize: 12, playoffTeams: 6 }
  const candidates = [1, 2, 5].map((partner) => {
    const mine = teams[0]!.roster
    const theirs = teams[partner]!.roster
    return {
      afterPlayers: [...mine.slice(1), theirs[0]!],
      afterRosterByTeamId: { [`t${partner}`]: [...theirs.slice(1), mine[0]!] },
    }
  })

  it('gives each candidate the same result simulateTrade gives it alone, and both match the original season model', () => {
    const simulate = createTradeSimulator(base)
    for (const c of candidates) {
      const shared = simulate(c.afterPlayers, c.afterRosterByTeamId)
      expect(shared).toEqual(simulateTrade({ ...base, ...c }))
      const mc = { iterations: 60, seed: 99, weeksRemaining: 10, playoffTeams: 6, regularSeasonWeeks: 10 }
      const afterTeams = teams.map((t) => t.id === 't0'
        ? { id: t.id, name: t.name, roster: c.afterPlayers }
        : c.afterRosterByTeamId[t.id] ? { id: t.id, name: t.name, roster: c.afterRosterByTeamId[t.id]! } : t)
      expect(shared.before).toEqual(referenceSeason(teams.map((t) => ({ id: t.id, name: t.name, roster: t.roster })), mc))
      expect(shared.after).toEqual(referenceSeason(afterTeams, mc))
    }
  })

  it('🛑 runs the unchanged "before" season ONCE for all candidates, not once per candidate', () => {
    const simulate = createTradeSimulator(base)
    seasonRuns.count = 0
    for (const c of candidates) simulate(c.afterPlayers, c.afterRosterByTeamId)
    // One baseline + one "after" per candidate. The old shape was 2 per candidate (6 here).
    expect(seasonRuns.count).toBe(candidates.length + 1)
  })
})

describe('trade suggestion simulation', () => {
  const roster = (id: string, projection: number): SuggestionRoster => ({
    rosterId: id, ownerName: id, wins: 0, losses: 0, faabRemaining: 100, picks: [],
    players: Array.from({ length: 10 }, (_, index) => ({
      id: `${id}-${index}`, name: `${id}-${index}`, position: index < 3 ? 'RB' : 'WR',
      value: projection * 100, weeklyProjection: projection + (index % 4),
    })),
  })
  const rosters = [roster('mine', 8), roster('p1', 14), roster('p2', 10), roster('p3', 11), roster('p4', 9), roster('p5', 12)]
  const pkg = (partner: string, n: number): TradePartnerSuggestion['packages'][number] => ({
    id: `${partner}-${n}`,
    send: [{ kind: 'player', id: `mine-${n}`, name: `mine-${n}`, value: 800, position: 'RB', amount: null, itemType: 'player' }],
    receive: [{ kind: 'player', id: `${partner}-${n}`, name: `${partner}-${n}`, value: 1400, position: 'RB', amount: null, itemType: 'player' }],
    sendValue: 800, receiveValue: 1400, fairness: 75, acceptanceLikelihood: null, reason: 'upgrade',
  })
  const suggestions: TradePartnerSuggestion[] = ['p1', 'p2', 'p3'].map((partner) => ({
    rosterId: partner, fitScore: 80, reasons: [], packages: [pkg(partner, 0), pkg(partner, 1)],
  }))
  const input = { suggestions, rosters, viewerRosterId: 'mine', leagueMode: 'dynasty' as const, weeksRemaining: 8, playoffTeams: 4, iterations: 80 }

  beforeEach(() => clearProposalSimulationMemo())

  it('simulates six packages with seven season runs (one shared baseline), not twelve', () => {
    seasonRuns.count = 0
    const result = enrichProposalSimulations(input)
    expect(result.flatMap((s) => s.packages).every((p) => p.simulation?.available)).toBe(true)
    expect(seasonRuns.count).toBe(7)
  })

  it('🛑 a repeat load with unchanged inputs reuses the answer instead of simulating again', () => {
    const first = enrichProposalSimulations(input)
    seasonRuns.count = 0
    const second = enrichProposalSimulations(structuredClone(input))
    expect(seasonRuns.count).toBe(0)
    expect(second).toEqual(first)
  })

  it('[control] ANY input change is a miss — one projection moving re-simulates', () => {
    enrichProposalSimulations(input)
    const moved = structuredClone(input)
    moved.rosters[4]!.players[7]!.weeklyProjection = 30
    seasonRuns.count = 0
    const result = enrichProposalSimulations(moved)
    expect(seasonRuns.count).toBe(7)
    expect(result).not.toEqual(enrichProposalSimulations(input))
  })

  it('hands out copies, so a caller editing its result cannot change the next caller\'s', () => {
    const first = enrichProposalSimulations(input)
    first[0]!.packages[0]!.simulation!.deltaPct = 12345
    expect(enrichProposalSimulations(input)[0]!.packages[0]!.simulation!.deltaPct).not.toBe(12345)
  })

  it('multi-team candidates share one baseline too, and are remembered separately from pair packages', () => {
    const multi = [0, 1].map((n) => ({
      id: `m${n}`, rosterIds: ['mine', 'p1', 'p2'], fairness: 70, reason: 'three-way',
      legs: [
        { fromRosterId: 'mine', toRosterId: 'p1', asset: pkg('p1', n).send[0]! },
        { fromRosterId: 'p1', toRosterId: 'p2', asset: pkg('p1', n).receive[0]! },
        { fromRosterId: 'p2', toRosterId: 'mine', asset: pkg('p2', n).receive[0]! },
      ],
    })) as unknown as Parameters<typeof enrichMultiTeamProposalSimulations>[0]['suggestions']
    seasonRuns.count = 0
    const result = enrichMultiTeamProposalSimulations({ ...input, suggestions: multi })
    expect(result.every((s) => s.simulation?.available)).toBe(true)
    expect(seasonRuns.count).toBe(3)
    seasonRuns.count = 0
    enrichMultiTeamProposalSimulations({ ...input, suggestions: multi })
    expect(seasonRuns.count).toBe(0)
  })
})
