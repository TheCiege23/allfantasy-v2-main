/**
 * PROMPT 239 — Waiver AI Engine: deterministic suggestions from available players + team needs.
 */

import { scoreWaiverCandidates } from '@/lib/waiver-engine'
import { computeTeamNeeds } from '@/lib/waiver-engine/team-needs'
import type { WaiverScoringContext } from '@/lib/waiver-engine'
import type { WaiverAIEngineInput, WaiverSuggestionsResult, UserGoal } from './types'

function buildScoringContext(input: WaiverAIEngineInput): WaiverScoringContext {
  const roster = input.roster ?? []
  let teamNeeds = input.teamNeeds
  if (!teamNeeds && input.roster?.length && input.rosterPositions?.length && input.allLeagueRosters) {
    teamNeeds = computeTeamNeeds(
      input.roster,
      input.rosterPositions,
      input.allLeagueRosters,
      input.currentWeek ?? 1
    )
  }
  const needs = teamNeeds?.weakestSlots?.map((s) => s.position) ?? []
  // depthRating is 0-100 with 50 = league median (see computeTeamNeeds); >60 means genuinely deep.
  const surplus = teamNeeds?.positionalDepth?.filter((d) => d.depthRating > 60).map((d) => d.position) ?? []

  return {
    goal: (input.goal ?? 'balanced') as UserGoal,
    needs,
    surplus,
    isSF: input.leagueSettings.isSF ?? false,
    isTEP: input.leagueSettings.isTEP ?? false,
    numTeams: input.leagueSettings.numTeams ?? 12,
    isDynasty: input.leagueSettings.isDynasty ?? false,
    faabBudget: input.leagueSettings.faabBudget ?? null,
    faabRemaining: input.leagueSettings.faabRemaining ?? null,
    rosterPlayers: roster,
    teamNeeds: teamNeeds ?? {
      weakestSlots: [],
      biggestNeed: null,
      byeWeekClusters: [],
      positionalDepth: [],
      dropCandidates: [],
    },
    currentWeek: input.currentWeek ?? 1,
  }
}

function toWaiverCandidate(
  p: WaiverAIEngineInput['availablePlayers'][0]
): import('@/lib/waiver-engine').WaiverCandidate {
  const c = p as import('@/lib/waiver-engine').WaiverCandidate
  if (c.assetValue && typeof c.assetValue === 'object') return c
  const value = Number((p as { value?: number }).value ?? 0)
  return {
    playerId: (p as { playerId?: string }).playerId ?? (p as { id?: string }).id ?? '',
    playerName: (p as { playerName?: string }).playerName ?? (p as { name?: string }).name ?? '',
    position: (p as { position?: string }).position ?? '',
    team: (p as { team?: string | null }).team ?? null,
    byeWeek: (p as { product?: { byeWeek?: number | null } }).product?.byeWeek ?? null,
    age: (p as { age?: number | null }).age ?? null,
    value,
    assetValue: {
      impactValue: (p as { assetValue?: { impactValue?: number } }).assetValue?.impactValue ?? value * 0.4,
      marketValue: (p as { assetValue?: { marketValue?: number } }).assetValue?.marketValue ?? value,
      vorpValue: (p as { assetValue?: { vorpValue?: number } }).assetValue?.vorpValue ?? value * 0.25,
      volatility: (p as { assetValue?: { volatility?: number } }).assetValue?.volatility ?? 0.2,
    },
    source: (p as { source?: string }).source ?? 'waiver-ai-engine',
  }
}

/**
 * Suggest waiver pickups (deterministic): rank available players by composite score and team needs.
 */
export function suggestWaiverPickups(input: WaiverAIEngineInput): WaiverSuggestionsResult {
  const ctx = buildScoringContext(input)
  const candidates = input.availablePlayers.map(toWaiverCandidate)
  const suggestions = scoreWaiverCandidates(candidates, ctx, {
    maxResults: input.maxResults ?? 10,
  })
  return { suggestions }
}
