import 'server-only'

/**
 * Server half of ./extendedCorrections.ts: turns a detected correction into score adjustments
 * (lib/score-adjustments/scoreAdjustmentService.ts), the same sealed-week write a commissioner makes
 * by hand — score moved under the league lock, standings refreshed, audit row written.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { hasAfCommissionerPlan } from '@/lib/entitlements/afCommissionerPlan'
import { addScoreAdjustment } from '@/lib/score-adjustments/scoreAdjustmentService'
import { readScoreAdjustments } from '@/lib/score-adjustments/scoreAdjustments'
import type { StatCorrectionReview } from './statCorrectionReview'
import { correctionApplyRefusal, planCorrectionAdjustments, STAT_CORRECTION_ACTOR } from './extendedCorrections'

export const STAT_CORRECTION_APPLIED_ACTION = 'stat_correction_applied'

/** The league owner's AF Commissioner plan. Never throws: unreadable reads as "not paying". */
export async function ownerHasAfCommissionerPlan(userId: string | null): Promise<boolean> {
  if (!userId) return false
  const owner = await prisma.appUser.findUnique({ where: { id: userId }, select: { email: true, username: true } }).catch(() => null)
  return hasAfCommissionerPlan({ id: userId, email: owner?.email ?? null, username: owner?.username ?? null })
}

export type ApplyCorrectionsResult =
  | { applied: number; refused?: undefined }
  | { applied: 0; refused: 'elimination_format' | 'playoffs' }

export async function applyStatCorrections(args: {
  leagueId: string
  seasonStatus: string | null
  league: { leagueVariant: string | null; guillotineMode: boolean | null; userId: string | null }
  week: number
  review: StatCorrectionReview
}): Promise<ApplyCorrectionsResult> {
  const refused = correctionApplyRefusal(args.league, args.seasonStatus)
  if (refused) return { applied: 0, refused }

  const row = await prisma.league.findUnique({ where: { id: args.leagueId }, select: { settings: true } })
  const plan = planCorrectionAdjustments(args.review.matchups, readScoreAdjustments(row?.settings))
  let applied = 0
  for (const a of plan) {
    const res = await addScoreAdjustment(
      args.leagueId,
      args.league.userId ?? STAT_CORRECTION_ACTOR,
      { matchupId: a.matchupId, rosterId: a.rosterId, points: a.points, reason: `Stat correction, week ${args.week}` },
      { systemActor: STAT_CORRECTION_ACTOR },
    )
    if (res.ok) applied += 1
    else console.warn('[stat-corrections] could not apply', args.leagueId, a.matchupId, res.error)
  }
  if (applied > 0) {
    await prisma.leagueAuditLog
      .create({
        data: {
          leagueId: args.leagueId,
          userId: null,
          actionType: STAT_CORRECTION_APPLIED_ACTION,
          entityType: 'redraft_week',
          entityId: `week:${args.week}`,
          afterState: JSON.parse(JSON.stringify({ adjustments: plan, changes: args.review.changes })) as Prisma.InputJsonValue,
          metadata: { week: args.week, applied, flipped: args.review.matchups.filter((m) => m.resultFlipped).length },
        },
      })
      .catch(() => {})
  }
  return { applied }
}
