/**
 * GUILLOTINE WEEKLY-PLAN ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Composes the survival-first weekly plan from the other engines: the survival-risk read,
 * the top roster weakness, the lineup posture (floor vs ceiling swing), the FAAB stance, and
 * the most urgent action. Pure orchestration — it adds no new data, only an ordered plan.
 */

import { evaluateSurvivalRisk } from './guillotineSurvivalRiskEngine'
import { evaluateRosterRisk } from './guillotineRosterRiskEngine'
import { evaluateLineupSafety } from './guillotineLineupSafetyEngine'
import { buildFaabPlan } from './guillotineFaabEngine'
import { buildWaiverRecommendations } from './guillotineWaiverEngine'
import type { GuillotineWarRoomContext } from './types'

interface GuillotineWeeklyStep {
  order: number
  action: string
  detail: string
}

export interface GuillotineWeeklyPlanResult {
  rosterId: string
  riskLevel: string
  headline: string
  steps: GuillotineWeeklyStep[]
  missingDataFlags: string[]
}

export function buildWeeklyPlan(context: GuillotineWarRoomContext, rosterId: string): GuillotineWeeklyPlanResult {
  const survival = evaluateSurvivalRisk(context, rosterId)
  const roster = evaluateRosterRisk(context, rosterId)
  const lineup = evaluateLineupSafety(context, rosterId)
  const faab = buildFaabPlan(context, rosterId)
  const waivers = buildWaiverRecommendations(context, rosterId)

  const steps: GuillotineWeeklyStep[] = []
  let order = 1

  if (survival.riskLevel === 'eliminated') {
    return {
      rosterId,
      riskLevel: 'eliminated',
      headline: 'Eliminated — no further survival actions this season.',
      steps: [{ order: 1, action: 'Review', detail: survival.explanationFacts[0] ?? 'Team is eliminated.' }],
      missingDataFlags: [...new Set(survival.missingDataFlags)],
    }
  }

  // 1) Lineup.
  steps.push({
    order: order++,
    action: 'Set the safest lineup',
    detail: lineup.posture === 'ceiling_needed'
      ? `You are at survival risk — start a high-floor core but consider a ceiling swing${lineup.ceilingSwing ? ` (e.g. ${lineup.ceilingSwing.playerName})` : ''}.`
      : 'Start your highest-floor lineup — avoid risky boom/bust starts while safe.',
  })

  // 2) Roster weakness / waivers.
  if (roster.weaknesses.length > 0) {
    steps.push({
      order: order++,
      action: `Address ${roster.weaknesses[0].position} weakness`,
      detail: waivers.recommendedAdds.length > 0
        ? `Consider adding ${waivers.recommendedAdds[0].playerName} (${waivers.recommendedAdds[0].position}).`
        : `Target ${waivers.targetPositions.join('/') || roster.weaknesses[0].position} on waivers — ${waivers.needsPoolData ? 'no pool listed yet' : 'from the eliminated-team pool'}.`,
    })
  }

  // 3) FAAB stance.
  steps.push({
    order: order++,
    action: `FAAB: ${faab.posture}`,
    detail: faab.suggestedMaxBid != null ? `Max bid ~${faab.suggestedMaxBid} (${Math.round(faab.suggestedMaxBidPct * 100)}% of remaining).` : faab.explanationFacts[0] ?? 'Bid according to survival risk.',
  })

  const headline =
    survival.riskLevel === 'critical'
      ? 'CHOP ZONE — maximize this period to survive.'
      : survival.riskLevel === 'high'
        ? 'High elimination risk — secure your floor and consider an upside swing.'
        : survival.riskLevel === 'moderate'
          ? 'Bubble — play a strong floor and make selective moves.'
          : survival.riskLevel === 'safe'
            ? 'Safe — protect your lead and conserve FAAB.'
            : 'Survival risk is limited (no elimination line yet).'

  return {
    rosterId,
    riskLevel: survival.riskLevel,
    headline,
    steps,
    missingDataFlags: [...new Set([...survival.missingDataFlags, ...roster.missingDataFlags, ...lineup.missingDataFlags, ...faab.missingDataFlags, ...waivers.missingDataFlags])],
  }
}
