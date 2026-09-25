import { rosterStrengthIndex } from '@/lib/ai/sim/playerModel'
import { simulateSeason } from '@/lib/ai/sim/seasonSimulator'
import type { MonteCarloOptions, SeasonSimResult, SimPlayerInput, SimTeamInput, TradeSimResult } from '@/lib/ai/sim/types'

function teamFromRoster(id: string, name: string | undefined, players: SimPlayerInput[]): SimTeamInput {
  return { id, name, roster: players }
}

function syntheticLeagueFill(teams: SimTeamInput[], targetN: number, seed: number): SimTeamInput[] {
  if (teams.length >= targetN) return teams.slice(0, targetN)
  const need = targetN - teams.length
  const mean =
    teams.reduce((s, t) => s + rosterStrengthIndex(t.roster), 0) / Math.max(1, teams.length) / 9
  const filler: SimTeamInput[] = []
  for (let i = 0; i < need; i++) {
    const roster: SimPlayerInput[] = Array.from({ length: 9 }, (_, j) => ({
      id: `fill-${seed}-${i}-${j}`,
      position: 'FLEX',
      projection: Math.max(3, mean * (0.9 + (j % 4) * 0.03)),
      variance: 7,
    }))
    filler.push({ id: `fill-${i}`, roster })
  }
  return [...teams, ...filler]
}

type TradeSimBaselineArgs = {
  teams: SimTeamInput[]
  /** Roster of focused team before trade */
  beforePlayers: SimPlayerInput[]
  focusedTeamId: string
  iterations?: number
  weeksRemaining?: number
  leagueSize?: number
  playoffTeams?: number
}

/**
 * Before vs after trade — rest of season Monte Carlo.
 */
export function simulateTrade(args: TradeSimBaselineArgs & {
  /** Same team after trade */
  afterPlayers: SimPlayerInput[]
  /** Counterparty/third-team rosters after the same transaction. */
  afterRosterByTeamId?: Record<string, SimPlayerInput[]>
}): TradeSimResult {
  return createTradeSimulator(args)(args.afterPlayers, args.afterRosterByTeamId)
}

/**
 * `simulateTrade` for MANY candidate trades against ONE starting league.
 *
 * ⚠ THE "BEFORE" SEASON IS THE SAME FOR EVERY CANDIDATE, AND IT WAS BEING RE-RUN FOR EACH ONE. The
 * trade partner suggestions simulate ~93 packages on a 32-team league, every one of them from the
 * same league, the same viewer roster and the same seed — so the baseline half of each simulation
 * was one identical Monte Carlo run 93 times. This runs it once, on first use, and hands the same
 * (read-only) result to every candidate. The "after" run keeps the same seed (common random
 * numbers), so each returned `TradeSimResult` equals what `simulateTrade` returns for those inputs.
 */
export function createTradeSimulator(
  args: TradeSimBaselineArgs,
): (afterPlayers: SimPlayerInput[], afterRosterByTeamId?: Record<string, SimPlayerInput[]>) => TradeSimResult {
  const iterations = Math.max(40, Math.min(800, args.iterations ?? 180))
  const weeks = args.weeksRemaining ?? 12
  const leagueSize = Math.max(args.teams.length, args.leagueSize ?? 12)

  const baseTeams = syntheticLeagueFill(args.teams, leagueSize, 7)
  const idx = baseTeams.findIndex((t) => t.id === args.focusedTeamId)
  const teamsBefore = baseTeams.map((t, i) =>
    i === idx ? teamFromRoster(t.id, t.name, args.beforePlayers) : t,
  )

  const mc: MonteCarloOptions = {
    iterations,
    seed: 99,
    weeksRemaining: weeks,
    playoffTeams: Math.max(2, Math.min(leagueSize, args.playoffTeams ?? Math.min(6, leagueSize))),
    regularSeasonWeeks: weeks,
  }

  let before: SeasonSimResult | null = null
  return (afterPlayers, afterRosterByTeamId) => {
    const teamsAfter = baseTeams.map((t, i) => {
      if (i === idx) return teamFromRoster(t.id, t.name, afterPlayers)
      const changed = afterRosterByTeamId?.[t.id]
      return changed ? teamFromRoster(t.id, t.name, changed) : t
    })
    before ??= simulateSeason(teamsBefore, mc)
    // Common random numbers isolate the roster change; different seeds would add
    // Monte Carlo noise to the reported trade delta.
    const after = simulateSeason(teamsAfter, mc)
    return tradeDeltas(baseTeams, before, after, iterations)
  }
}

function tradeDeltas(
  baseTeams: SimTeamInput[],
  before: SeasonSimResult,
  after: SeasonSimResult,
  iterations: number,
): TradeSimResult {
  const ids = baseTeams.map((t) => t.id)
  const winDelta: Record<string, number> = {}
  const playoffDelta: Record<string, number> = {}
  const championshipDelta: Record<string, number> = {}
  const riskChange: Record<string, number> = {}

  for (const id of ids) {
    winDelta[id] = (after.avgWins[id] ?? 0) - (before.avgWins[id] ?? 0)
    playoffDelta[id] = (after.playoffOdds[id] ?? 0) - (before.playoffOdds[id] ?? 0)
    championshipDelta[id] = (after.championshipOdds[id] ?? 0) - (before.championshipOdds[id] ?? 0)
    const riskB = Math.abs((before.bestCaseWins[id] ?? 0) - (before.worstCaseWins[id] ?? 0))
    const riskA = Math.abs((after.bestCaseWins[id] ?? 0) - (after.worstCaseWins[id] ?? 0))
    riskChange[id] = riskA - riskB
  }

  return {
    winDelta,
    playoffDelta,
    championshipDelta,
    riskChange,
    before,
    after,
    iterations,
  }
}
