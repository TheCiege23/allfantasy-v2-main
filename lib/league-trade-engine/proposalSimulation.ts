import { simulateTrade } from '@/lib/ai/sim/tradeSimulator'
import { createRng, sampleTeamWeeklyScore } from '@/lib/ai/sim/playerModel'
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

function survivalOdds(teams: SimTeamInput[], focusedId: string, iterations: number, seed: number): number {
  let survives = 0
  for (let index = 0; index < iterations; index += 1) {
    const rng = createRng(seed + index * 7919)
    const scores = teams.map((team) => ({ id: team.id, score: sampleTeamWeeklyScore(team.roster, rng) }))
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

export function enrichProposalSimulations(input: {
  suggestions: TradePartnerSuggestion[]
  rosters: SuggestionRoster[]
  viewerRosterId: string | null
  leagueMode: ProposalLeagueMode
  weeksRemaining: number
  playoffTeams: number
  iterations?: number
}): TradePartnerSuggestion[] {
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
        const result = simulateTrade({
          teams, beforePlayers, afterPlayers, focusedTeamId: viewer.rosterId, iterations,
          weeksRemaining: input.weeksRemaining, leagueSize: teams.length, playoffTeams: input.playoffTeams,
          afterRosterByTeamId: { [partner.rosterId]: partnerAfter },
        })
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

export function enrichMultiTeamProposalSimulations(input: {
  suggestions: MultiTeamTradeSuggestion[]
  rosters: SuggestionRoster[]
  viewerRosterId: string | null
  leagueMode: ProposalLeagueMode
  weeksRemaining: number
  playoffTeams: number
  iterations?: number
}): MultiTeamTradeSuggestion[] {
  const viewer = input.rosters.find((roster) => roster.rosterId === input.viewerRosterId)
  const metric = input.leagueMode === 'guillotine' || input.leagueMode === 'survivor' ? 'survival' : 'playoff'
  if (!viewer) return input.suggestions
  const teams: SimTeamInput[] = input.rosters.map((roster) => ({ id: roster.rosterId, name: roster.ownerName ?? undefined, roster: simPlayers(roster) }))
  const coverage = teams.reduce((sum, team) => sum + team.roster.length, 0) / Math.max(1, input.rosters.reduce((sum, roster) => sum + roster.players.length, 0))
  if (coverage < 0.55) return input.suggestions.map((suggestion) => ({ ...suggestion, simulation: unavailable(metric, `Weekly projection coverage is ${Math.round(coverage * 100)}%; at least 55% is required.`) }))
  const iterations = Math.max(80, Math.min(400, input.iterations ?? 160))
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
    const result = simulateTrade({ teams, beforePlayers: simPlayers(viewer), afterPlayers, focusedTeamId: viewer.rosterId, iterations, weeksRemaining: input.weeksRemaining, leagueSize: teams.length, playoffTeams: input.playoffTeams, afterRosterByTeamId: changed })
    const participants = suggestion.rosterIds.map((rosterId) => {
      const roster = input.rosters.find((row) => row.rosterId === rosterId)!
      return playoffOutcome({ roster, before: result.before.playoffOdds[rosterId] ?? 0, after: result.after.playoffOdds[rosterId] ?? 0 })
    })
    const focused = participants[0]!
    return { ...suggestion, simulation: { available: true, metric, beforePct: focused.beforePct, afterPct: focused.afterPct, deltaPct: focused.deltaPct, iterations: result.iterations, reason: null, participants } }
  })
}
