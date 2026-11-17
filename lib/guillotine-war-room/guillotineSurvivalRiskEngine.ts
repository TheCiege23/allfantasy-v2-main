/**
 * GUILLOTINE SURVIVAL-RISK ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * The core guillotine signal: how close is the user's team to the CHOP ZONE (elimination)?
 * Uses the real danger-tier standings (chop_zone/danger/safe + pointsFromChopZone). Returns
 * a survival-risk level + the projected safety margin. When the elimination line cannot be
 * computed (no scores/projections), returns a truthful 'limited' state — never invents a line.
 */

import type { GuillotineWarRoomContext } from './types'

type SurvivalRiskLevel = 'critical' | 'high' | 'moderate' | 'safe' | 'eliminated' | 'limited'

export interface GuillotineSurvivalRiskResult {
  rosterId: string
  riskLevel: SurvivalRiskLevel
  tier: string
  rank: number | null
  activeTeams: number
  /** Points above the chop zone (negative = in/below the chop zone); null when limited. */
  safetyMargin: number | null
  dangerMargin: number
  teamsPerChop: number
  explanationFacts: string[]
  missingDataFlags: string[]
}

export function evaluateSurvivalRisk(context: GuillotineWarRoomContext, rosterId: string): GuillotineSurvivalRiskResult {
  const missingDataFlags = [...context.missingDataFlags]
  const row = context.standings.find((s) => s.rosterId === rosterId)
  const dangerMargin = context.guillotine.dangerMarginPoints
  const facts: string[] = []

  if (!row) {
    return {
      rosterId,
      riskLevel: 'limited',
      tier: 'unknown',
      rank: null,
      activeTeams: context.activeTeamCount,
      safetyMargin: null,
      dangerMargin,
      teamsPerChop: context.guillotine.teamsPerChop,
      explanationFacts: ['Roster not found in this league.'],
      missingDataFlags,
    }
  }

  if (row.eliminated) {
    return {
      rosterId,
      riskLevel: 'eliminated',
      tier: 'eliminated',
      rank: null,
      activeTeams: context.activeTeamCount,
      safetyMargin: null,
      dangerMargin,
      teamsPerChop: context.guillotine.teamsPerChop,
      explanationFacts: [`Eliminated${row.choppedInPeriod != null ? ` in period ${row.choppedInPeriod}` : ''} — focus shifts to post-elimination/league play.`],
      missingDataFlags,
    }
  }

  if (!context.featureAvailability.survivalRisk || row.pointsFromChopZone == null) {
    missingDataFlags.push('Survival risk is limited — the elimination line needs projected/period scores.')
    return {
      rosterId,
      riskLevel: 'limited',
      tier: row.tier,
      rank: row.rank,
      activeTeams: context.activeTeamCount,
      safetyMargin: null,
      dangerMargin,
      teamsPerChop: context.guillotine.teamsPerChop,
      explanationFacts: ['No elimination line yet — risk read is structural only.'],
      missingDataFlags: [...new Set(missingDataFlags)],
    }
  }

  const margin = row.pointsFromChopZone
  let riskLevel: SurvivalRiskLevel
  if (row.tier === 'chop_zone' || margin <= 0) riskLevel = 'critical'
  else if (margin <= dangerMargin * 0.5) riskLevel = 'high'
  else if (row.tier === 'danger' || margin <= dangerMargin) riskLevel = 'moderate'
  else riskLevel = 'safe'

  facts.push(`Tier ${row.tier}, ${margin >= 0 ? '+' : ''}${margin.toFixed(1)} pts vs the chop zone (danger margin ${dangerMargin}).`)
  facts.push(`${context.activeTeamCount} active teams; ${context.guillotine.teamsPerChop} chopped per period.`)
  if (riskLevel === 'critical') facts.push('You are in the chop zone — maximize this period\'s floor AND ceiling to climb out; survival overrides everything.')
  else if (riskLevel === 'high') facts.push('Within striking distance of the chop zone — secure a safe floor and consider an upside swing.')
  else if (riskLevel === 'safe') facts.push('Comfortably clear of the chop zone — play a stable floor and conserve resources.')

  return {
    rosterId,
    riskLevel,
    tier: row.tier,
    rank: row.rank,
    activeTeams: context.activeTeamCount,
    safetyMargin: Math.round(margin * 100) / 100,
    dangerMargin,
    teamsPerChop: context.guillotine.teamsPerChop,
    explanationFacts: facts,
    missingDataFlags: [...new Set(missingDataFlags)],
  }
}

export function evaluateUserSurvivalRisk(context: GuillotineWarRoomContext): GuillotineSurvivalRiskResult | null {
  if (!context.userRosterId) return null
  return evaluateSurvivalRisk(context, context.userRosterId)
}
