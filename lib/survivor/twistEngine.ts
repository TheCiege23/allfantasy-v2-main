import { prisma } from '@/lib/prisma'

export type TwistRecommendation = {
  twistType: string
  recommendedWeek: number
  reason: string
  priority: 'low' | 'medium' | 'high'
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
