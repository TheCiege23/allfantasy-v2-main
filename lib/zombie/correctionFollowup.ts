import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { updateStandings } from '@/lib/redraft/standingsEngine'
import { combatTransaction } from './beta2025CombatTransaction'
import { lockItemLeague } from './beta2025ItemService'
import { refreshItemScores } from './beta2025ItemService'
import { syncUniverseStats } from './universeStatEngine'
import type { CorrectionPlan, ReplayWeek } from './beta2025CorrectionPlan'

/** Render this week's replayed state, rather than today's inventory masquerading as an old report. */
export function correctedWeekReport(w: ReplayWeek, names: Record<string, string>, whispererPublic: boolean) {
  const hidden = new Set(whispererPublic ? [] : [
    ...w.snapshot.teams.filter(t => t.status === 'Whisperer').map(t => t.rosterId),
    ...w.teams.filter(t => t.status === 'Whisperer').map(t => t.rosterId),
  ])
  const name = (id: string) => hidden.has(id) ? 'Hidden Whisperer' : names[id] || 'Manager'
  return [`🧟 WEEK ${w.week} — CORRECTED HORDE REPORT`,
    'Official scores and 2025 consequences were reconciled in a reviewed correction.',
    'State shown as reviewed; later manager decisions appear in the Zombie tab.',
    `Survivors: ${w.teams.filter(t => t.status === 'Survivor').length} · Zombies: ${w.teams.filter(t => t.status === 'Zombie').length} · Whisperers: ${w.teams.filter(t => t.status === 'Whisperer').length}`,
    'MATCHUPS', ...w.matches.map(m => `${name(m.homeRosterId)} ${m.homeScore.toFixed(2)} — ${m.awayScore.toFixed(2)} ${name(m.awayRosterId)}`),
    'INFECTIONS', ...(w.infections.length ? w.infections.map(i => `${name(i.victimRosterId)} was infected by ${name(i.infectorRosterId)}.`) : ['No new matchup infections.']),
    'COMBAT CHOICES', ...(w.choices.length ? w.choices.map(c => `${name(c.winnerRosterId)}: ${c.decision?.replaceAll('_', ' ') ?? 'awaiting manager response'}${c.retained ? ' (original eligible choice retained)' : ''}.`) : ['No combat choices.']),
    'WINNINGS AND INVENTORY', ...w.teams.map(t => `${name(t.rosterId)}: weekly ${w.distribution[t.rosterId]?.toFixed(2) ?? '0.00'}; cumulative ${w.totals[t.rosterId]?.toFixed(2) ?? '0.00'}; unspent items ${w.items.filter(i => i.teamStatusId === t.id && !i.isUsed && !i.isExpired).length}.`),
    w.whisperer && !w.whisperer.wasDefeated ? `Seasonal ambushes remaining: ${w.whisperer.ambushesRemaining}.` : 'No active Whisperer.',
    'External payout records are unchanged. Any reconciliation reference is kept in the commissioner audit.'
  ].join('\n')
}

/** Durable retry: the review stays pending until both derived standings and linked reports are refreshed. */
export async function finishZombieCorrectionEffects(reviewId: string) {
  const review = await prisma.zombieCorrectionReview.findUniqueOrThrow({ where: { id: reviewId }, include: { league: { include: { league: { select: { userId: true } } } } } })
  if (review.status !== 'applied' || !review.effectsPending) return { ok: true, pending: false }
  const z = review.league, plan = review.plan as unknown as CorrectionPlan & { liveWeeksToRefresh?: number[] }
  const season = await prisma.redraftSeason.findFirstOrThrow({ where: { leagueId: z.leagueId, season: z.season } })
  for (const week of plan.liveWeeksToRefresh ?? []) await refreshItemScores(z.leagueId, week)
  await updateStandings(season.id, Math.max(...plan.weeks.map(w => w.week)))
  if (z.universeId) await syncUniverseStats(z.universeId, Math.max(...plan.weeks.map(w => w.week)), z.season)
  const teams = await prisma.zombieLeagueTeam.findMany({ where: { leagueId: z.leagueId }, select: { rosterId: true, fantasyTeamName: true, displayName: true } })
  const names = Object.fromEntries(teams.map(t => [t.rosterId, t.fantasyTeamName || t.displayName || 'Manager']))
  return combatTransaction(async tx => {
    await lockItemLeague(tx, z.leagueId)
    const live = await tx.zombieLeague.findUniqueOrThrow({ where: { id: z.id } })
    if (live.latestCorrectionReviewId !== reviewId) {
      await tx.zombieCorrectionReview.update({ where: { id: reviewId }, data: { effectsPending: false } })
      return { ok: true, pending: false, superseded: true }
    }
    if (live.correctionHoldFromWeek != null) return { ok: true, pending: true }
    for (const w of plan.weeks) {
      const content = correctedWeekReport(w, names, live.whispererIsPublic)
      const existing = await tx.zombieAnnouncement.findMany({ where: { zombieLeagueId: z.id, week: w.week, type: 'weekly_update' } })
      const publish = existing.some(a => a.isPosted) || (live.weeklyUpdateAutoPost && !live.weeklyUpdateApproval)
      const ann = await tx.zombieAnnouncement.upsert({ where: { idempotencyKey: `zombie-weekly:${z.id}:${w.week}` }, create: {
        zombieLeagueId: z.id, universeId: z.universeId, week: w.week, type: 'weekly_update', title: `Week ${w.week} — corrected Horde report`, content,
        idempotencyKey: `zombie-weekly:${z.id}:${w.week}`, isPublic: true, isPosted: publish, postedAt: publish ? new Date() : null },
        update: { content, title: `Week ${w.week} — corrected Horde report`, isPosted: publish, ...(publish ? { postedAt: new Date() } : {}) } })
      const linked = await tx.leagueChatMessage.findMany({ where: { leagueId: z.leagueId, OR: [
        { zombieWeeklyAnnouncementId: { in: existing.map(a => a.id) } },
        { AND: [{ metadata: { path: ['zombieWeeklyUpdate'], equals: true } }, { metadata: { path: ['week'], equals: w.week } }] },
      ] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
      if (publish && !linked.length) await tx.leagueChatMessage.upsert({ where: { zombieWeeklyAnnouncementId: ann.id }, create: { leagueId: z.leagueId, userId: z.league.userId,
        zombieWeeklyAnnouncementId: ann.id, type: 'host_announcement', message: content, metadata: { senderIsHost: true, contentType: 'host_announcement', zombieWeeklyUpdate: true, week: w.week, correctionReviewId: reviewId } }, update: { message: content } })
      if (linked.length) await tx.leagueChatMessage.updateMany({ where: { id: { in: linked.map(m => m.id) } }, data: { message: content,
        metadata: toPrismaJsonInput({ senderIsHost: true, contentType: 'host_announcement', zombieWeeklyUpdate: true, week: w.week, correctionReviewId: reviewId }) } })
      if (linked.length && !linked.some(m => m.zombieWeeklyAnnouncementId === ann.id)) await tx.leagueChatMessage.update({ where: { id: linked[0].id }, data: { zombieWeeklyAnnouncementId: ann.id } })
      for (const a of existing.filter(a => a.id !== ann.id)) await tx.zombieAnnouncement.update({ where: { id: a.id }, data: { content, isPosted: publish, scheduledFor: null } })
    }
    await tx.zombieCorrectionReview.update({ where: { id: reviewId }, data: { effectsPending: false } })
    return { ok: true, pending: false }
  })
}

export async function retryZombieCorrectionEffects() {
  const pending = await prisma.zombieCorrectionReview.findMany({ where: { status: 'applied', effectsPending: true }, select: { id: true }, orderBy: { updatedAt: 'asc' }, take: 3 })
  const errors: string[] = []
  for (const r of pending) try { await finishZombieCorrectionEffects(r.id) } catch { errors.push(`Correction ${r.id}: standings or reports pending retry`) }
  return errors
}
