import { prisma } from '@/lib/prisma'

export type TwistRecommendation = {
  twistType: string
  recommendedWeek: number
  reason: string
  priority: 'low' | 'medium' | 'high'
}

/**
 * Heuristic twist schedule for a 20-player / 4-tribe reference season.
 * Does not mutate DB — commissioner tools + cron can consume recommendations.
 */
export async function evaluateTwistSchedule(
  leagueId: string,
  currentWeek: number,
): Promise<TwistRecommendation[]> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      survivorPlayerCount: true,
      survivorTribeCount: true,
      survivorMergeWeek: true,
      survivorPhase: true,
    },
  })
  const playerCount = league?.survivorPlayerCount ?? 20
  const tribeCount = league?.survivorTribeCount ?? 4
  const mergeWeek = league?.survivorMergeWeek ?? 7

  const out: TwistRecommendation[] = []

  if (currentWeek >= 3) {
    out.push({
      twistType: 'first_idol_impact',
      recommendedWeek: 3,
      reason: 'First tribal where an idol can flip the result — stakes exist after two boots.',
      priority: 'high',
    })
  }
  if (currentWeek >= 3 && currentWeek <= 4) {
    out.push({
      twistType: 'first_tribe_power',
      recommendedWeek: 3,
      reason: 'Award one secret tribe power from a challenge reward (asymmetric, not overwhelming).',
      priority: 'medium',
    })
  }
  if (currentWeek >= 4 && currentWeek <= 5) {
    out.push({
      twistType: 'first_disadvantage',
      recommendedWeek: 4,
      reason: 'Introduce first disadvantage as challenge penalty once basics are understood.',
      priority: 'medium',
    })
  }
  if (playerCount >= 16 && tribeCount >= 2) {
    out.push({
      twistType: 'tribe_swap',
      recommendedWeek: 4,
      reason: `Target ~13–15 players remaining (${playerCount}-player scale).`,
      priority: 'high',
    })
  }
  out.push({
    twistType: 'exile_return_window',
    recommendedWeek: 6,
    reason: 'Return qualification should be earned after 4–5 exile competitors exist.',
    priority: 'medium',
  })
  out.push({
    twistType: 'merge',
    recommendedWeek: mergeWeek,
    reason: 'Merge near 10–11 active players — balance tribe phase vs individual game.',
    priority: 'high',
  })
  out.push({
    twistType: 'merge_foreshadow',
    recommendedWeek: Math.max(1, mergeWeek - 1),
    reason: 'Week before merge: build anticipation without new twists stacking on merge week.',
    priority: 'low',
  })
  out.push({
    twistType: 'jury_start',
    recommendedWeek: mergeWeek + 1,
    reason: 'First post-merge elimination seats jury.',
    priority: 'high',
  })
  out.push({
    twistType: 'endgame_power_lock',
    recommendedWeek: mergeWeek + 5,
    reason: 'Final 5+: stop seeding new powers — social endgame.',
    priority: 'high',
  })
  out.push({
    twistType: 'finale_clean',
    recommendedWeek: mergeWeek + 7,
    reason: 'Final 3 / finale: no mechanical twists; jury + speeches only.',
    priority: 'high',
  })

  return out
}

const TRIBE_CHOICE_TYPE = 'tribe_choice'
const SWAP_TYPE = 'tribe_swap'
const EXILE_RETURN = 'exile_return'
const MERGE_TYPE = 'merge'

export async function shouldBlockTwist(
  leagueId: string,
  twistType: string,
  week: number,
  options?: { councilId?: string },
): Promise<{ blocked: boolean; reason?: string }> {
  if (options?.councilId && twistType === 'idol_play') {
    const c = await prisma.survivorTribalCouncil.findUnique({
      where: { id: options.councilId },
      select: { leagueId: true, idolsPlayed: true },
    })
    if (c && c.leagueId === leagueId) {
      const played = Array.isArray(c.idolsPlayed) ? (c.idolsPlayed as unknown[]).length : 0
      if (played >= 2) {
        return { blocked: true, reason: 'A third idol play is not allowed at the same Elimination Council.' }
      }
    }
  }

  const recent = await prisma.survivorTwistEvent.findMany({
    where: { leagueId },
    orderBy: { executedAt: 'desc' },
    take: 30,
  })

  const sameWeekTribal = recent.some((e) => e.week === week && e.twistType.includes('tribal'))
  const sameWeekSwap = recent.some((e) => e.week === week && e.twistType === SWAP_TYPE)

  if (twistType === SWAP_TYPE && sameWeekTribal) {
    return { blocked: true, reason: 'Avoid tribe swap and tribal in the same week (pacing).' }
  }
  if (twistType.includes('tribal') && sameWeekSwap) {
    return { blocked: true, reason: 'Tribal blocked this week — tribe swap already executed.' }
  }

  const tribeChoiceSeasonCount = recent.filter((e) => e.twistType === TRIBE_CHOICE_TYPE).length
  if (twistType === TRIBE_CHOICE_TYPE && tribeChoiceSeasonCount >= 1) {
    return { blocked: true, reason: 'At most one tribe_choice-style twist per season.' }
  }

  if (twistType === EXILE_RETURN) {
    const mergeThisWeek = recent.some((e) => e.week === week && e.twistType === MERGE_TYPE)
    if (mergeThisWeek) {
      return { blocked: true, reason: 'Do not run exile return during merge week.' }
    }
  }

  if (twistType === 'dual_immunity') {
    const mergeThisWeek = recent.some((e) => e.week === week && e.twistType === MERGE_TYPE)
    if (mergeThisWeek) {
      return { blocked: true, reason: 'Avoid dual_immunity stacking on merge week.' }
    }
  }

  return { blocked: false }
}
