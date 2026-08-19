// Shared fakes for Decision OS waiver tests (not a test file — no DB required).
import type { WaiverAIServiceInput, WaiverAIServiceOutput } from '@/lib/waiver-ai-engine'
import type { ScoredWaiverTarget } from '@/lib/waiver-engine/waiver-scoring'
import { resolveWaiverWorld, type WaiverWorld, type WaiverWorldInput } from '@/lib/decision-os/waiver/world'
import type { WaiverWorldFacts } from '@/lib/decision-os/waiver/loader'
import type { WaiverDecisionDeps } from '@/lib/decision-os/waiver/decision'

export function fakeSuggestion(over: Partial<ScoredWaiverTarget> = {}): ScoredWaiverTarget {
  return {
    playerId: 'wp1',
    playerName: 'Waiver Add One',
    position: 'RB',
    team: 'KC',
    age: 24,
    value: 1800,
    compositeScore: 82,
    dimensions: { startNow: 70, stash: 40, needFit: 80, leagueDemand: 60 },
    drivers: [],
    topDrivers: [{ id: 'wa_need_slot', label: 'Fills RB need', score: 80, direction: 'positive', detail: 'Starts at a thin RB spot.' }],
    recommendation: 'Strong Add',
    faabBid: 14,
    priorityRank: 1,
    dropCandidate: { name: 'Bench Guy', position: 'WR', value: 600, reason: 'lowest bench value', riskOfRegret: 0.2, riskLabel: 'low' },
    ...over,
  }
}

export function fakeAnalysis(suggestions: ScoredWaiverTarget[] = [fakeSuggestion()], explanationSource: 'deterministic' | 'ai' = 'deterministic'): WaiverAIServiceOutput {
  return {
    sport: 'NFL',
    deterministic: { suggestions, basedOn: ['available_players', 'team_needs'] },
    explanation: { source: explanationSource, text: explanationSource === 'ai' ? 'AI prose that must be ignored for parity.' : 'Deterministic explanation.' },
  }
}

export function fakeEngineInput(over: Partial<WaiverAIServiceInput> = {}): WaiverAIServiceInput {
  return {
    sport: 'NFL',
    leagueId: 'L1',
    leagueSettings: { numTeams: 12 },
    roster: [{ id: 'r1', name: 'My RB', position: 'RB', team: 'BUF', slot: 'bench', age: 26, value: 1200 }],
    availablePlayers: [{ playerId: 'wp1', playerName: 'Waiver Add One', position: 'RB', team: 'KC', value: 1800 }],
    goal: 'balanced',
    maxResults: 8,
    ...over,
  }
}

export function fakeWorldFacts(over: Partial<WaiverWorldFacts> = {}): WaiverWorldFacts {
  return {
    sport: 'NFL',
    leagueId: 'L1',
    rosterId: 'roster-1',
    settings: {
      waiverType: 'faab',
      normalizedWaiverType: 'faab',
      faabBudget: 100,
      claimLimitPerPeriod: null,
      claimLimitPerWeek: null,
      maxDropsPerWeek: null,
      lockType: null,
    },
    settingsKnown: true,
    faabRemaining: 60,
    waiverPriority: 3,
    rosterSize: 15,
    ...over,
  }
}

export function fakeWorldInput(over: Partial<WaiverWorldInput> = {}): WaiverWorldInput {
  const facts = fakeWorldFacts()
  return {
    sport: facts.sport,
    leagueId: facts.leagueId,
    settings: facts.settings,
    settingsKnown: facts.settingsKnown,
    faabRemaining: facts.faabRemaining,
    waiverPriority: facts.waiverPriority,
    nextProcessAtIso: null,
    ...over,
  }
}

export function fakeWorld(over: Partial<WaiverWorldInput> = {}): WaiverWorld {
  return resolveWaiverWorld(fakeWorldInput(over))
}

/** Decision deps with a legal (no-throw) eligibility gate by default. */
export function fakeDecisionDeps(over: Partial<WaiverDecisionDeps> = {}): WaiverDecisionDeps {
  const memo = fakeAnalysis()
  return {
    recommend: async () => memo,
    ruleDeps: { assertEligibility: async () => undefined },
    newId: () => 'dec_test',
    ...over,
  }
}
