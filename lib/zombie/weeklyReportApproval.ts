import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { combatTransaction } from './beta2025CombatTransaction'
import { lockItemLeague } from './beta2025ItemService'
import { buildWeeklyUpdate, composeWeeklyUpdateBody } from './weeklyUpdateEngine'
import { correctedWeekReport } from './correctionFollowup'
import type { CorrectionPlan } from './beta2025CorrectionPlan'

/** Approving twice, including concurrently, posts one linked chat row and one receipt. */
export async function approveZombieWeeklyReport(leagueId: string, week: number) {
  if (!Number.isInteger(week) || week < 1 || week > 40) throw new Error('Choose a valid scoring week.')
  const z = await prisma.zombieLeague.findUniqueOrThrow({ where: { leagueId }, select: { id: true, correctionHoldFromWeek: true, latestCorrectionReviewId: true, whispererIsPublic: true } })
  const resolution = await prisma.zombieWeeklyResolution.findUnique({ where: { zombieLeagueId_week: { zombieLeagueId: z.id, week } } })
  if (z.correctionHoldFromWeek != null || resolution?.status !== 'complete' || resolution.requiresStatCorrection) throw new Error('Resolve the scoring week and correction hold before publishing its report.')
  const correction = z.latestCorrectionReviewId ? await prisma.zombieCorrectionReview.findUniqueOrThrow({ where: { id: z.latestCorrectionReviewId } }) : null
  const reviewedWeek = (correction?.plan as unknown as CorrectionPlan | undefined)?.weeks.find(w => w.week === week)
  if (reviewedWeek && correction?.effectsPending) throw new Error('The correction report refresh must finish before approval.')
  let body: string
  if (reviewedWeek) {
    const teams = await prisma.zombieLeagueTeam.findMany({ where: { leagueId }, select: { rosterId: true, fantasyTeamName: true, displayName: true } })
    body = correctedWeekReport(reviewedWeek, Object.fromEntries(teams.map(t => [t.rosterId, t.fantasyTeamName || t.displayName || 'Manager'])), z.whispererIsPublic)
  } else body = composeWeeklyUpdateBody(await buildWeeklyUpdate(leagueId, week))
  return combatTransaction(async tx => {
    await lockItemLeague(tx, leagueId)
    const live = await tx.zombieWeeklyResolution.findUniqueOrThrow({ where: { zombieLeagueId_week: { zombieLeagueId: z.id, week } } })
    const league = await tx.zombieLeague.findUniqueOrThrow({ where: { leagueId }, include: { league: { select: { userId: true } } } })
    if (league.correctionHoldFromWeek != null || league.latestCorrectionReviewId !== z.latestCorrectionReviewId || live.requiresStatCorrection || live.status !== 'complete' || live.resolvedAt?.getTime() !== resolution.resolvedAt?.getTime()) throw new Error('The settlement changed while preparing this report. Review it again.')
    const posted = await tx.zombieAnnouncement.findFirst({ where: { zombieLeagueId: z.id, week, type: 'weekly_update', isPosted: true }, orderBy: { createdAt: 'asc' } })
    if (posted) return { ok: true, alreadyPosted: true, announcementId: posted.id }
    const key = `zombie-weekly:${z.id}:${week}`
    const ann = await tx.zombieAnnouncement.upsert({ where: { idempotencyKey: key }, create: { zombieLeagueId: z.id, universeId: league.universeId, week,
      type: 'weekly_update', title: `Week ${week} — Horde report`, content: body, idempotencyKey: key, isPublic: true }, update: { content: body } })
    await tx.leagueChatMessage.upsert({ where: { zombieWeeklyAnnouncementId: ann.id }, create: { leagueId, userId: league.league.userId,
      zombieWeeklyAnnouncementId: ann.id, message: body.slice(0, 100_000), type: 'host_announcement', metadata: toPrismaJsonInput({ senderIsHost: true, contentType: 'host_announcement', isPinned: true, zombieWeeklyUpdate: true, week }) }, update: {} })
    await tx.zombieAnnouncement.update({ where: { id: ann.id }, data: { isPosted: true, postedAt: new Date() } })
    // Legacy pending copies are retired together so a queued sender cannot post another report.
    await tx.zombieAnnouncement.updateMany({ where: { zombieLeagueId: z.id, week, type: 'weekly_update', id: { not: ann.id }, isPosted: false }, data: { isPosted: true, postedAt: new Date(), scheduledFor: null, content: `Superseded by approved report ${ann.id}.` } })
    return { ok: true, alreadyPosted: false, announcementId: ann.id }
  })
}
