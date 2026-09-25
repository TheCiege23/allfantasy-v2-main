import { createHash } from 'node:crypto'

import { createTradeSimulator } from '@/lib/ai/sim/tradeSimulator'
import { createRng, prepareTeamWeeklySampler } from '@/lib/ai/sim/playerModel'
import type { SimPlayerInput, SimTeamInput } from '@/lib/ai/sim/types'
import type {
  ProposalLeagueMode,
  ProposalOutcomeSimulation,
  MultiTeamTradeSuggestion,
  SuggestionRoster,
  TradePartnerSuggestion,
} from '@/lib/league-trade-engine/proposalSuggestions'

export function hasPairedProposalSimulation(input: {
  suggestions: TradePartnerSuggestion[]
  multiTeamSuggestions: MultiTeamTradeSuggestion[]
}): boolean {
  return input.suggestions.some((suggestion) =>
    suggestion.packages.some((proposal) => proposal.simulation?.available),
  ) || input.multiTeamSuggestions.some((suggestion) => suggestion.simulation?.available)
}

function simPlayers(roster: SuggestionRoster): SimPlayerInput[] {
  return roster.players
    .filter((player) => player.weeklyProjection != null && Number.isFinite(player.weeklyProjection))
    .map((player) => ({
      id: player.id,
      name: player.name,
      position: player.position ?? 'FLEX',
      projection: player.weeklyProjection ?? 0,
      variance: Math.max(2.5, (player.weeklyProjection ?? 0) * 0.38),
    }))
}

function unavailable(metric: 'playoff' | 'survival', reason: string): ProposalOutcomeSimulation {
  return { available: false, metric, beforePct: null, afterPct: null, deltaPct: null, iterations: 0, reason }
}

/*
 * One set of starter samplers per team LIST. `survivalOdds` is called several times per package
 * against the same list (before, after, and once per participant), and each call used to re-sort
 * every roster on every iteration. Bit-identical to `sampleTeamWeeklyScore`; see
 * `prepareTeamWeeklySampler`.
 */
const samplersByTeamList = new WeakMap<SimTeamInput[], Array<(rng: () => number) => number>>()
function teamSamplers(teams: SimTeamInput[]): Array<(rng: () => number) => number> {
  let samplers = samplersByTeamList.get(teams)
  if (!samplers) {
    samplers = teams.map((team) => prepareTeamWeeklySampler(team.roster))
    samplersByTeamList.set(teams, samplers)
  }
  return samplers
}

/*
 * Seeded, so the same list, team, iteration count and seed always give the same odds — and the
 * "before" list is asked the same question for every package. Remembered per list for that reason.
 */
const survivalByTeamList = new WeakMap<SimTeamInput[], Map<string, number>>()

function survivalOdds(teams: SimTeamInput[], focusedId: string, iterations: number, seed: number): number {
  let memo = survivalByTeamList.get(teams)
  if (!memo) {
    memo = new Map()
    survivalByTeamList.set(teams, memo)
  }
  const key = `${focusedId}\u0000${iterations}\u0000${seed}`
  const known = memo.get(key)
  if (known !== undefined) return known
  const odds = computeSurvivalOdds(teams, focusedId, iterations, seed)
  memo.set(key, odds)
  return odds
}

function computeSurvivalOdds(teams: SimTeamInput[], focusedId: string, iterations: number, seed: number): number {
  const samplers = teamSamplers(teams)
  let survives = 0
  for (let index = 0; index < iterations; index += 1) {
    const rng = createRng(seed + index * 7919)
    const scores = teams.map((team, teamIndex) => ({ id: team.id, score: samplers[teamIndex]!(rng) }))
    const lowest = Math.min(...scores.map((row) => row.score))
    if ((scores.find((row) => row.id === focusedId)?.score ?? lowest) > lowest) survives += 1
  }
  return survives / iterations
}

function playoffOutcome(input: {
  roster: SuggestionRoster
  before: number
  after: number
}) {
  const deltaPct = (input.after - input.before) * 100
  const beforePct = input.roster.playoffProbability ?? input.before * 100
  const afterPct = Math.max(0, Math.min(100, beforePct + deltaPct))
  return { rosterId: input.roster.rosterId, beforePct, afterPct, deltaPct: afterPct - beforePct }
}

/*
 * ── REPEAT LOADS REUSE THE LAST ANSWER ──────────────────────────────────────────────────────
 *
 * Every simulation here is SEEDED, so its output is a pure function of its input: the same rosters,
 * projections, packages and settings always produce byte-identical odds. The Trade Center asks the
 * same question on every visit, and the inputs only move when a roster, a projection or a value
 * does — so the answer is remembered, keyed on a hash of the ENTIRE input rather than on a league
 * id. A key that covered only some fields could serve a stale answer; hashing all of it cannot, and
 * any change at all is simply a miss.
 *
 * Bounded (least recently used) because a key per league-and-viewer accumulates. Callers get a
 * clone, so nothing downstream can edit the remembered copy.
 */
const SIMULATION_MEMO_LIMIT = 32
const simulationMemo = new Map<string, unknown>()

function rememberedSimulation<T>(kind: string, input: unknown, compute: () => T): T {
  const key = `${kind}:${createHash('sha256').update(JSON.stringify(input)).digest('base64')}`
  if (simulationMemo.has(key)) {
    const value = simulationMemo.get(key) as T
    simulationMemo.delete(key)
    simulationMemo.set(key, value)
    return structuredClone(value)
  }
  const value = compute()
  simulationMemo.set(key, value)
  while (simulationMemo.size > SIMULATION_MEMO_LIMIT) {
    simulationMemo.delete(simulationMemo.keys().next().value as string)
  }
  return structuredClone(value)
}

/** Test seam: forget remembered simulations. */
export function clearProposalSimulationMemo(): void {
  simulationMemo.clear()
}

type ProposalSimulationInput = {
  suggestions: TradePartnerSuggestion[]
  rosters: SuggestionRoster[]
  viewerRosterId: string | null
  leagueMode: ProposalLeagueMode
  weeksRemaining: number
  playoffTeams: number
  iterations?: number
}

export function enrichProposalSimulations(input: ProposalSimulationInput): TradePartnerSuggestion[] {
  return rememberedSimulation('pair', input, () => computeProposalSimulations(input))
}

function computeProposalSimulations(input: ProposalSimulationInput): TradePartnerSuggestion[] {
  const viewer = input.rosters.find((roster) => roster.rosterId === input.viewerRosterId)
  const metric = input.leagueMode === 'guillotine' || input.leagueMode === 'survivor' ? 'survival' : 'playoff'
  if (!viewer) return input.suggestions
  const totalPlayers = input.rosters.reduce((sum, roster) => sum + roster.players.length, 0)
  const projectedPlayers = input.rosters.reduce((sum, roster) => sum + simPlayers(roster).length, 0)
  const coverage = projectedPlayers / Math.max(1, totalPlayers)
  if (coverage < 0.55 || simPlayers(viewer).length < Math.min(5, viewer.players.length)) {
    return input.suggestions.map((suggestion) => ({
      ...suggestion,
      packages: suggestion.packages.map((proposal) => ({
        ...proposal,
        simulation: unavailable(metric, `Weekly projection coverage is ${Math.round(coverage * 100)}%; at least 55% is required.`),
      })),
    }))
  }

  const teams: SimTeamInput[] = input.rosters.map((roster) => ({ id: roster.rosterId, name: roster.ownerName ?? undefined, roster: simPlayers(roster) }))
  const beforePlayers = simPlayers(viewer)
  const iterations = Math.max(80, Math.min(400, input.iterations ?? 160))
  // Every package starts from this same league, so its "before" season is simulated once.
  const simulateFromHere = createTradeSimulator({
    teams, beforePlayers, focusedTeamId: viewer.rosterId, iterations,
    weeksRemaining: input.weeksRemaining, leagueSize: teams.length, playoffTeams: input.playoffTeams,
  })
  return input.suggestions.map((suggestion) => {
    const partner = input.rosters.find((roster) => roster.rosterId === suggestion.rosterId)
    return {
      ...suggestion,
      packages: suggestion.packages.map((proposal) => {
        if (!partner) return { ...proposal, simulation: unavailable(metric, 'Partner roster is unavailable.') }
        const sentIds = new Set(proposal.send.filter((asset) => asset.kind === 'player').map((asset) => asset.id))
        const receivedIds = new Set(proposal.receive.filter((asset) => asset.kind === 'player').map((asset) => asset.id))
        const incoming = simPlayers(partner).filter((player) => receivedIds.has(player.id))
        const afterPlayers = [...beforePlayers.filter((player) => !sentIds.has(player.id)), ...incoming]
        const outgoingToPartner = beforePlayers.filter((player) => sentIds.has(player.id))
        const partnerAfter = [
          ...simPlayers(partner).filter((player) => !receivedIds.has(player.id)),
          ...outgoingToPartner,
        ]
        if (metric === 'survival') {
          const beforeTeams = teams
          const afterTeams = teams.map((team) => team.id === viewer.rosterId
            ? { ...team, roster: afterPlayers }
            : team.id === partner.rosterId ? { ...team, roster: partnerAfter } : team)
          const before = survivalOdds(beforeTeams, viewer.rosterId, iterations, 241)
          const after = survivalOdds(afterTeams, viewer.rosterId, iterations, 241)
          const participants = [viewer, partner].map((roster) => {
            const participantBefore = survivalOdds(beforeTeams, roster.rosterId, iterations, 241)
            const participantAfter = survivalOdds(afterTeams, roster.rosterId, iterations, 241)
            return { rosterId: roster.rosterId, beforePct: participantBefore * 100, afterPct: participantAfter * 100, deltaPct: (participantAfter - participantBefore) * 100 }
          })
          return { ...proposal, simulation: {
            available: true, metric, beforePct: before * 100, afterPct: after * 100,
            deltaPct: (after - before) * 100, iterations, reason: null, participants,
          } satisfies ProposalOutcomeSimulation }
        }
        const result = simulateFromHere(afterPlayers, { [partner.rosterId]: partnerAfter })
        const participants = [viewer, partner].map((roster) => playoffOutcome({
          roster,
          before: result.before.playoffOdds[roster.rosterId] ?? 0,
          after: result.after.playoffOdds[roster.rosterId] ?? 0,
        }))
        const focused = participants[0]!
        return { ...proposal, simulation: {
          available: true, metric, beforePct: focused.beforePct, afterPct: focused.afterPct,
          deltaPct: focused.deltaPct, iterations: result.iterations, reason: null, participants,
        } satisfies ProposalOutcomeSimulation }
      }),
    }
  })
}

type MultiTeamSimulationInput = Omit<ProposalSimulationInput, 'suggestions'> & {
  suggestions: MultiTeamTradeSuggestion[]
}

export function enrichMultiTeamProposalSimulations(input: MultiTeamSimulationInput): MultiTeamTradeSuggestion[] {
  return rememberedSimulation('multi', input, () => computeMultiTeamProposalSimulations(input))
}

function computeMultiTeamProposalSimulations(input: MultiTeamSimulationInput): MultiTeamTradeSuggestion[] {
  const viewer = input.rosters.find((roster) => roster.rosterId === input.viewerRosterId)
  const metric = input.leagueMode === 'guillotine' || input.leagueMode === 'survivor' ? 'survival' : 'playoff'
  if (!viewer) return input.suggestions
  const teams: SimTeamInput[] = input.rosters.map((roster) => ({ id: roster.rosterId, name: roster.ownerName ?? undefined, roster: simPlayers(roster) }))
  const coverage = teams.reduce((sum, team) => sum + team.roster.length, 0) / Math.max(1, input.rosters.reduce((sum, roster) => sum + roster.players.length, 0))
  if (coverage < 0.55) return input.suggestions.map((suggestion) => ({ ...suggestion, simulation: unavailable(metric, `Weekly projection coverage is ${Math.round(coverage * 100)}%; at least 55% is required.`) }))
  const iterations = Math.max(80, Math.min(400, input.iterations ?? 160))
  // As above: one shared "before" season for every multi-team candidate.
  const simulateFromHere = createTradeSimulator({
    teams, beforePlayers: simPlayers(viewer), focusedTeamId: viewer.rosterId, iterations,
    weeksRemaining: input.weeksRemaining, leagueSize: teams.length, playoffTeams: input.playoffTeams,
  })
  return input.suggestions.map((suggestion) => {
    const afterById = new Map(teams.map((team) => [team.id, [...team.roster]]))
    for (const leg of suggestion.legs.filter((row) => row.asset.kind === 'player')) {
      const from = afterById.get(leg.fromRosterId) ?? []
      const moving = from.find((player) => player.id === leg.asset.id)
      if (!moving) continue
      afterById.set(leg.fromRosterId, from.filter((player) => player.id !== moving.id))
      afterById.set(leg.toRosterId, [...(afterById.get(leg.toRosterId) ?? []), moving])
    }
    const afterPlayers = afterById.get(viewer.rosterId) ?? []
    if (metric === 'survival') {
      const afterTeams = teams.map((team) => ({ ...team, roster: afterById.get(team.id) ?? team.roster }))
      const before = survivalOdds(teams, viewer.rosterId, iterations, 811)
      const after = survivalOdds(afterTeams, viewer.rosterId, iterations, 811)
      const participants = suggestion.rosterIds.map((rosterId) => {
        const participantBefore = survivalOdds(teams, rosterId, iterations, 811)
        const participantAfter = survivalOdds(afterTeams, rosterId, iterations, 811)
        return { rosterId, beforePct: participantBefore * 100, afterPct: participantAfter * 100, deltaPct: (participantAfter - participantBefore) * 100 }
      })
      return { ...suggestion, simulation: { available: true, metric, beforePct: before * 100, afterPct: after * 100, deltaPct: (after - before) * 100, iterations, reason: null, participants } }
    }
    const changed = Object.fromEntries([...afterById.entries()].filter(([id]) => id !== viewer.rosterId))
    const result = simulateFromHere(afterPlayers, changed)
    const participants = suggestion.rosterIds.map((rosterId) => {
      const roster = input.rosters.find((row) => row.rosterId === rosterId)!
      return playoffOutcome({ roster, before: result.before.playoffOdds[rosterId] ?? 0, after: result.after.playoffOdds[rosterId] ?? 0 })
    })
    const focused = participants[0]!
    return { ...suggestion, simulation: { available: true, metric, beforePct: focused.beforePct, afterPct: focused.afterPct, deltaPct: focused.deltaPct, iterations: result.iterations, reason: null, participants } }
  })
}
