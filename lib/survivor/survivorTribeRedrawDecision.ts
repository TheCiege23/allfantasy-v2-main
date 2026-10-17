import 'server-only'

import { prisma } from '@/lib/prisma'
import { runShuffle } from './SurvivorTribeShuffleEngine'
import { withSurvivorSetupTransaction } from './survivorSetupTransaction'

const RECOMMENDATION = 'sit_out_shuffle_recommendation'
const RESPONSES = ['sit_out_shuffle_approved', 'sit_out_shuffle_postponed']

export async function getPendingTribeRedraw(leagueId: string) {
  const recommendation = await prisma.survivorCommissionerAction.findFirst({
    where: { leagueId, actionType: RECOMMENDATION }, orderBy: { executedAt: 'desc' },
    select: { id: true, week: true, newState: true },
  })
  if (!recommendation) return null
  const response = await prisma.survivorCommissionerAction.findFirst({
    where: { leagueId, actionType: { in: RESPONSES }, description: recommendation.id }, select: { id: true },
  })
  if (response) return null
  const state = recommendation.newState && typeof recommendation.newState === 'object' && !Array.isArray(recommendation.newState)
    ? recommendation.newState as Record<string, unknown> : {}
  return {
    id: recommendation.id,
    week: recommendation.week,
    minTribeSize: typeof state.minTribeSize === 'number' ? state.minTribeSize : null,
    maxTribeSize: typeof state.maxTribeSize === 'number' ? state.maxTribeSize : null,
  }
}

/** A playing commissioner can choose only approve/postpone, never the random seed or teammates. */
export async function respondToTribeRedraw(leagueId: string, userId: string, recommendationId: string, decision: 'approve' | 'postpone') {
  return withSurvivorSetupTransaction(leagueId, async db => {
    const recommendation = await db.survivorCommissionerAction.findFirst({
      where: { id: recommendationId, leagueId, actionType: RECOMMENDATION },
      select: { id: true, week: true },
    })
    if (!recommendation) return { ok: false as const, status: 404 as const, error: 'Tribe redraw recommendation not found.' }
    const prior = await db.survivorCommissionerAction.findFirst({
      where: { leagueId, actionType: { in: RESPONSES }, description: recommendation.id }, select: { id: true },
    })
    if (prior) return { ok: false as const, status: 409 as const, error: 'This tribe redraw has already been decided.' }
    if (decision === 'approve') {
      const redraw = await runShuffle(leagueId, { db, actorUserId: userId, recommendationId })
      if (!redraw.ok) return { ok: false as const, status: 409 as const, error: redraw.error ?? 'The redraw could not run.' }
    }
    await db.survivorCommissionerAction.create({ data: {
      leagueId, commissionerId: userId, week: recommendation.week,
      actionType: decision === 'approve' ? 'sit_out_shuffle_approved' : 'sit_out_shuffle_postponed',
      description: recommendation.id, wasConfirmed: true,
      newState: { decision },
    } })
    await db.survivorAuditEntry.create({ data: {
      leagueId, week: recommendation.week, category: 'tribe',
      action: decision === 'approve' ? 'tribe_redraw_approved' : 'tribe_redraw_postponed',
      actorUserId: userId, relatedEntityId: recommendation.id, relatedEntityType: 'survivor_commissioner_action',
      data: { decision }, isVisibleToCommissioner: true, isVisibleToPublic: true,
    } })
    return { ok: true as const, decision }
  })
}
