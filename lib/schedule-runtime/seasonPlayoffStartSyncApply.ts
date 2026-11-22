/**
 * Loading the current season and applying a playoff-start plan (lib/schedule-runtime/seasonPlayoffStartSync.ts).
 */
import { prisma } from '@/lib/prisma'
import type { PlayoffStartSyncPlan, SeasonForPlayoffSync } from './seasonPlayoffStartSync'

export async function loadCurrentSeasonForPlayoffSync(leagueId: string): Promise<SeasonForPlayoffSync | null> {
  return prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, currentWeek: true, totalWeeks: true, playoffStartWeek: true },
  })
}

/**
 * Move the season's playoffs and rebuild the weeks that have not started. The rebuild's own rules apply (it keeps
 * every started week and refuses a league mid-draft); a refusal is returned, the season move still stands.
 */
export async function applySeasonPlayoffStartSync(
  plan: Extract<PlayoffStartSyncPlan, { kind: 'apply' }>,
  actorUserId: string,
): Promise<{ rebuilt: boolean; message?: string }> {
  await prisma.redraftSeason.update({
    where: { id: plan.seasonId },
    data: { playoffStartWeek: plan.playoffStartWeek, totalWeeks: plan.totalWeeks },
  })
  const { generateNflRedraftScheduleForSeason } = await import('./resolveNflRedraftScheduleRuntime')
  const out = await generateNflRedraftScheduleForSeason({
    seasonId: plan.seasonId,
    regenerate: true,
    confirmMidSeasonChange: true,
    actorUserId,
  })
  return out.ok ? { rebuilt: true } : { rebuilt: false, message: out.message }
}
