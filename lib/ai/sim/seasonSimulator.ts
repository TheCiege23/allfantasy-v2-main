import { createRng, prepareTeamWeeklySampler } from '@/lib/ai/sim/playerModel'
import type { MonteCarloOptions, SeasonSimResult, SimTeamInput } from '@/lib/ai/sim/types'

function synthesizeSchedule(teamIds: string[], weeks: number, rng: () => number): Array<Array<{ home: string; away: string }>> {
  const out: Array<Array<{ home: string; away: string }>> = []
  for (let w = 0; w < weeks; w++) {
    const row: Array<{ home: string; away: string }> = []
    const shuffled = [...teamIds].sort(() => rng() - 0.5)
    for (let i = 0; i + 1 < shuffled.length; i += 2) {
      row.push({ home: shuffled[i]!, away: shuffled[i + 1]! })
    }
    if (row.length === 0 && teamIds.length >= 2) {
      row.push({ home: teamIds[0]!, away: teamIds[1]! })
    }
    out.push(row)
  }
  return out
}

/**
 * Full regular season + simple playoff bracket Monte Carlo.
 */
export function simulateSeason(teams: SimTeamInput[], opts: MonteCarloOptions): SeasonSimResult {
  const iterations = Math.max(20, Math.min(2000, opts.iterations))
  const weeks = Math.max(1, Math.min(18, opts.weeksRemaining ?? opts.regularSeasonWeeks ?? 14))
  const playoffN = Math.max(2, Math.min(teams.length, opts.playoffTeams ?? Math.min(6, teams.length)))
  const teamIds = teams.map((t) => t.id)
  const byId = new Map(teams.map((t) => [t.id, t]))
  /*
   * Each roster's starters are fixed for the whole run, so they are chosen once here rather than
   * re-sorted on every draw. `prepareTeamWeeklySampler` is bit-identical to `sampleTeamWeeklyScore`,
   * so a seeded run returns the same numbers it always did — only faster.
   */
  const samplerById = new Map(teams.map((t) => [t.id, prepareTeamWeeklySampler(t.roster)]))

  const champCount: Record<string, number> = Object.fromEntries(teamIds.map((id) => [id, 0]))
  const playoffCount: Record<string, number> = Object.fromEntries(teamIds.map((id) => [id, 0]))
  const winsSum: Record<string, number> = Object.fromEntries(teamIds.map((id) => [id, 0]))
  const winsBest: Record<string, number> = Object.fromEntries(teamIds.map((id) => [id, 0]))
  const winsWorst: Record<string, number> = Object.fromEntries(teamIds.map((id) => [id, weeks]))

  for (let it = 0; it < iterations; it++) {
    const seed = (opts.seed ?? 1) + it * 9973
    const rng = createRng(seed)
    const schedule = synthesizeSchedule(teamIds, weeks, rng)
    const wins: Record<string, number> = Object.fromEntries(teamIds.map((id) => [id, 0]))

    for (let w = 0; w < weeks; w++) {
      const matchups = schedule[w] ?? []
      for (const m of matchups) {
        const ta = byId.get(m.home)
        const tb = byId.get(m.away)
        if (!ta || !tb) continue
        const sa = samplerById.get(ta.id)!(rng)
        const sb = samplerById.get(tb.id)!(rng)
        if (sa > sb) wins[m.home] = (wins[m.home] ?? 0) + 1
        else if (sb > sa) wins[m.away] = (wins[m.away] ?? 0) + 1
        else {
          if (rng() < 0.5) wins[m.home] = (wins[m.home] ?? 0) + 1
          else wins[m.away] = (wins[m.away] ?? 0) + 1
        }
      }
    }

    for (const id of teamIds) {
      winsSum[id] = (winsSum[id] ?? 0) + (wins[id] ?? 0)
      winsBest[id] = Math.max(winsBest[id] ?? 0, wins[id] ?? 0)
      winsWorst[id] = Math.min(winsWorst[id] ?? weeks, wins[id] ?? 0)
    }

    const standings = [...teamIds].sort((a, b) => (wins[b] ?? 0) - (wins[a] ?? 0))
    const playoffSet = new Set(standings.slice(0, playoffN))
    for (const id of playoffSet) playoffCount[id] = (playoffCount[id] ?? 0) + 1

    // Single elimination; odd team gets bye (next round)
    let remaining = standings.slice(0, playoffN)
    while (remaining.length > 1) {
      const next: string[] = []
      for (let i = 0; i < remaining.length; i += 2) {
        if (i + 1 >= remaining.length) {
          next.push(remaining[i]!)
          continue
        }
        const a = remaining[i]!
        const b = remaining[i + 1]!
        const ta = byId.get(a)
        const tb = byId.get(b)
        if (!ta) {
          next.push(b)
          continue
        }
        if (!tb) {
          next.push(a)
          continue
        }
        const sa = samplerById.get(ta.id)!(rng)
        const sb = samplerById.get(tb.id)!(rng)
        next.push(sa >= sb ? a : b)
      }
      remaining = next
    }
    const champ = remaining[0]
    if (champ) champCount[champ] = (champCount[champ] ?? 0) + 1
  }

  const championshipOdds: Record<string, number> = {}
  const playoffOdds: Record<string, number> = {}
  const avgWins: Record<string, number> = {}
  const bestCaseWins: Record<string, number> = {}
  const worstCaseWins: Record<string, number> = {}

  for (const id of teamIds) {
    championshipOdds[id] = (champCount[id] ?? 0) / iterations
    playoffOdds[id] = (playoffCount[id] ?? 0) / iterations
    avgWins[id] = (winsSum[id] ?? 0) / iterations
    bestCaseWins[id] = winsBest[id] ?? 0
    worstCaseWins[id] = winsWorst[id] ?? 0
  }

  return {
    championshipOdds,
    playoffOdds,
    avgWins,
    bestCaseWins,
    worstCaseWins,
    iterations,
    weeksSimulated: weeks,
  }
}
