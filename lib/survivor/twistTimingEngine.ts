/**
 * Twist Timing Engine — controls when twists, powers, and drama events occur.
 *
 * Drama pacing principles:
 * 1. Week 1: No idols played. Establish baseline.
 * 2. Weeks 2-3: First idol clue or tribe power appears.
 * 3. Week 4: First tribe swap window.
 * 4. Weeks 5-6: Idol-relevant elimination council. First disadvantage appears.
 * 5. Week 7: Merge trigger window. Public reveal twist eligible.
 * 6. Weeks 8-9: Individual immunity. Advantage management peaks.
 * 7. Weeks 10-11: Exile return. Jury questions prep.
 * 8. Week 12+: Finale arc. Powers stop. Clean vote/social endgame.
 *
 * Anti-twist-overload rules:
 * - Max 1 twist per week
 * - Max 2 new powers introduced per 3-week window
 * - No new powers after the final 3 are set
 * - Twists must feel earned (challenge reward, exile result) not arbitrary
 * - Commissioner can override any twist recommendation
 */

import { prisma } from '@/lib/prisma'
import type { PowerBalanceLimits } from './powerBalanceEngine'
import { getBalanceLimitsForLeagueSize, isPowerDensityHigh } from './powerBalanceEngine'

export interface TwistRecommendation {
  week: number
  twistType: string
  description: string
  priority: 'required' | 'recommended' | 'optional'
  requiresCommissionerApproval: boolean
  category: 'idol' | 'tribe' | 'challenge' | 'exile' | 'merge' | 'disadvantage' | 'reveal'
}

export interface SeasonTwistPlan {
  playerCount: number
  totalWeeks: number
  mergeWeek: number
  juryStartWeek: number
  finaleWeek: number
  recommendations: TwistRecommendation[]
  doNotRules: string[]
}

/**
 * Generate twist timing recommendations for a season.
 */
export function generateTwistPlan(
  playerCount: number,
  mergeWeek: number,
  totalWeeks: number,
): SeasonTwistPlan {
  const juryStartWeek = mergeWeek + 1
  const finaleWeek = totalWeeks
  const recommendations: TwistRecommendation[] = []

  // Week 1: No twists. Pure gameplay establishment.
  // (intentionally empty)

  // Week 2: First idol clue
  recommendations.push({
    week: 2,
    twistType: 'idol_clue',
    description: 'AI posts a cryptic idol clue in one tribe chat. Tribe members must figure out who received the actual idol.',
    priority: 'recommended',
    requiresCommissionerApproval: false,
    category: 'idol',
  })

  // Week 3: Secret tribe power
  recommendations.push({
    week: 3,
    twistType: 'secret_tribe_power',
    description: 'Winning challenge tribe receives a secret tribe power (e.g., choose which tribe goes to tribal next week).',
    priority: 'optional',
    requiresCommissionerApproval: true,
    category: 'tribe',
  })

  // Week 4: Tribe swap window
  if (playerCount >= 16) {
    recommendations.push({
      week: 4,
      twistType: 'tribe_swap',
      description: 'Random tribe shuffle. Players reassigned to new tribes. Old tribe chats archived, new ones created.',
      priority: 'recommended',
      requiresCommissionerApproval: true,
      category: 'tribe',
    })
  }

  // Week 5: Disadvantage introduction
  recommendations.push({
    week: 5,
    twistType: 'disadvantage_seed',
    description: 'A disadvantage (e.g., lose_vote, challenge_sit_out) is secretly assigned to the player with the lowest individual score.',
    priority: 'optional',
    requiresCommissionerApproval: true,
    category: 'disadvantage',
  })

  // Week 6: Exile/boat trip
  recommendations.push({
    week: 6,
    twistType: 'exile_trip',
    description: 'One player from the winning tribe is sent to Exile Island for the week. They miss tribe chat but find an advantage.',
    priority: 'optional',
    requiresCommissionerApproval: true,
    category: 'exile',
  })

  // Merge week: Major event
  recommendations.push({
    week: mergeWeek,
    twistType: 'merge_announcement',
    description: 'Tribes merge into one. Pre-merge-only idols expire. Individual immunity begins. Jury phase may start.',
    priority: 'required',
    requiresCommissionerApproval: false,
    category: 'merge',
  })

  // Post-merge weeks: Individual focus
  for (let w = mergeWeek + 1; w < finaleWeek - 2; w++) {
    if (w === mergeWeek + 2) {
      recommendations.push({
        week: w,
        twistType: 'public_reveal',
        description: 'AI publicly reveals that "a hidden power exists in the game" without naming the holder.',
        priority: 'optional',
        requiresCommissionerApproval: false,
        category: 'reveal',
      })
    }
  }

  // Exile return window
  const exileReturnWeek = Math.min(mergeWeek + 3, finaleWeek - 3)
  recommendations.push({
    week: exileReturnWeek,
    twistType: 'exile_return',
    description: 'Top exile token holder returns to the main island. They rejoin as an individual player.',
    priority: 'recommended',
    requiresCommissionerApproval: true,
    category: 'exile',
  })

  // Final 5: Last power play window
  recommendations.push({
    week: finaleWeek - 2,
    twistType: 'endgame_power_cutoff',
    description: 'Last week for any hidden powers to be played. After this week, all remaining powers expire.',
    priority: 'required',
    requiresCommissionerApproval: false,
    category: 'idol',
  })

  // Finale: Clean
  recommendations.push({
    week: finaleWeek,
    twistType: 'finale',
    description: 'Final 3 face jury. No powers, no twists. Pure social/vote gameplay.',
    priority: 'required',
    requiresCommissionerApproval: false,
    category: 'merge',
  })

  const doNotRules = [
    'Never introduce new powers after Final 5',
    'Never have more than 1 twist per week',
    'Never introduce more than 2 new powers in any 3-week window',
    'Never assign a disadvantage to the same player twice in a row',
    'Never reveal idol holders publicly without the idol being played',
    'Never override a vote result with a twist (twists affect setup, not outcomes)',
    'Never use a twist to save a specific player the AI or commissioner favors',
    'Never introduce twists that cannot be tracked/audited',
    'Never allow twists to bypass the voting mechanic entirely',
    'Preserve player agency — twists should create choices, not remove them',
  ]

  return {
    playerCount,
    totalWeeks,
    mergeWeek,
    juryStartWeek,
    finaleWeek,
    recommendations,
    doNotRules,
  }
}

/**
 * Check if a twist is appropriate for the current game state.
 */
export async function canExecuteTwist(
  leagueId: string,
  week: number,
  twistType: string,
): Promise<{ allowed: boolean; reason?: string }> {
  // Check: max 1 twist per week
  const existingTwists = await (prisma as any).survivorTwistEvent.count({
    where: { leagueId, week },
  })
  if (existingTwists > 0) {
    return { allowed: false, reason: 'Already 1 twist this week. Max 1 per week.' }
  }

  // Check: max 2 new powers in 3-week window
  const recentPowers = await (prisma as any).survivorIdol.count({
    where: {
      leagueId,
      assignedAt: { gte: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000) },
    },
  })
  if (twistType.includes('power') || twistType.includes('idol')) {
    if (recentPowers >= 2) {
      return { allowed: false, reason: '2 powers already introduced in the last 3 weeks' }
    }
  }

  // Check: no new powers after Final 5
  const gameState = await (prisma as any).survivorGameState.findUnique({ where: { leagueId } })
  if (gameState?.activePlayerCount <= 5 && (twistType.includes('power') || twistType.includes('idol'))) {
    return { allowed: false, reason: 'No new powers after Final 5' }
  }

  // Check: power density
  const densityHigh = await isPowerDensityHigh(leagueId)
  if (densityHigh && twistType.includes('seed')) {
    return { allowed: false, reason: 'Power density too high (>50% of players hold powers)' }
  }

  return { allowed: true }
}

/**
 * Log a twist execution.
 */
export async function logTwistExecution(
  leagueId: string,
  week: number,
  twistType: string,
  description: string,
  affectedPlayerIds: string[],
  affectedTribeIds: string[],
  wasAutoTriggered: boolean,
  commissionerNote?: string,
): Promise<string> {
  const twist = await (prisma as any).survivorTwistEvent.create({
    data: {
      leagueId,
      week,
      twistType,
      description,
      affectedPlayerIds,
      affectedTribeIds,
      wasAutoTriggered,
      commissionerNote,
      executedAt: new Date(),
    },
  })
  return twist.id
}
