import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeSurvivorFoundationSettings } from './normalizeSurvivorSettings'
import { runShuffle } from './SurvivorTribeShuffleEngine'
import { withSurvivorSetupTransaction } from './survivorSetupTransaction'
import {
  SURVIVOR_HOST_USER_ID,
  TRIBE_REDRAW_DECISIONS,
  TRIBE_REDRAW_DEFAULT_DECISION,
  TRIBE_REDRAW_RECOMMENDATION_ACTION,
  TRIBE_REDRAW_RESPONSE_ACTION,
  TRIBE_REDRAW_RESPONSE_ACTIONS,
  type TribeRedrawDecision,
} from './survivorTribeRedrawActions'

/**
 * A tribe has fallen below half the size of the largest tribe (SurvivorSitOutEngine raises the
 * recommendation after an elimination). The commissioner answers with one of three choices, or
 * postpones; when nobody answers before the next council, the default runs on its own:
 *
 *  - approve   random redraw of every active manager (the default)
 *  - manual    the host moves managers by hand (survivorTribeReassign.ts); host only
 *  - merge     merge now: the cast becomes one tribe
 *  - postpone  keep the tribes; the rule is checked again after the next elimination
 */

const AUDIT_SUFFIX: Record<TribeRedrawDecision, string> = { approve: 'approved', postpone: 'postponed', manual: 'manual', merge: 'merged' }

export type PendingTribeRedraw = {
  id: string
  week: number | null
  minTribeSize: number | null
  maxTribeSize: number | null
  tribeSizes: Array<{ tribeId: string; tribeName: string; activeCount: number }>
  defaultDecision: TribeRedrawDecision
  options: readonly TribeRedrawDecision[]
}

function readTribeSizes(value: unknown): PendingTribeRedraw['tribeSizes'] {
  if (!Array.isArray(value)) return []
  const out: PendingTribeRedraw['tribeSizes'] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    if (typeof row.tribeId === 'string' && typeof row.activeCount === 'number') {
      out.push({ tribeId: row.tribeId, tribeName: typeof row.tribeName === 'string' ? row.tribeName : row.tribeId, activeCount: row.activeCount })
    }
  }
  return out
}

export async function getPendingTribeRedraw(leagueId: string): Promise<PendingTribeRedraw | null> {
  const recommendation = await prisma.survivorCommissionerAction.findFirst({
    where: { leagueId, actionType: TRIBE_REDRAW_RECOMMENDATION_ACTION }, orderBy: { executedAt: 'desc' },
    select: { id: true, week: true, newState: true },
  })
  if (!recommendation) return null
  const response = await prisma.survivorCommissionerAction.findFirst({
    where: { leagueId, actionType: { in: TRIBE_REDRAW_RESPONSE_ACTIONS }, description: recommendation.id }, select: { id: true },
  })
  if (response) return null
  const state = recommendation.newState && typeof recommendation.newState === 'object' && !Array.isArray(recommendation.newState)
    ? recommendation.newState as Record<string, unknown> : {}
  return {
    id: recommendation.id,
    week: recommendation.week,
    minTribeSize: typeof state.minTribeSize === 'number' ? state.minTribeSize : null,
    maxTribeSize: typeof state.maxTribeSize === 'number' ? state.maxTribeSize : null,
    tribeSizes: readTribeSizes(state.tribeSizes),
    defaultDecision: TRIBE_REDRAW_DEFAULT_DECISION,
    options: TRIBE_REDRAW_DECISIONS,
  }
}

export type TribeRedrawResponse =
  | { ok: true; decision: TribeRedrawDecision; automatic: boolean; mergeStarted?: boolean }
  | { ok: false; status: 403 | 404 | 409; error: string }

/**
 * Record the answer and carry it out. A playing commissioner may choose the random redraw, the
 * merge or a postponement, never teammates: the manual choice needs a non-participating host.
 * The random seed and the mapping are never accepted from the caller.
 */
export async function respondToTribeRedraw(
  leagueId: string,
  userId: string,
  recommendationId: string,
  decision: TribeRedrawDecision,
  opts: { automatic?: boolean } = {},
): Promise<TribeRedrawResponse> {
  const automatic = opts.automatic === true
  const result = await withSurvivorSetupTransaction(leagueId, async (db): Promise<TribeRedrawResponse> => {
    const recommendation = await db.survivorCommissionerAction.findFirst({
      where: { id: recommendationId, leagueId, actionType: TRIBE_REDRAW_RECOMMENDATION_ACTION },
      select: { id: true, week: true },
    })
    if (!recommendation) return { ok: false, status: 404, error: 'Tribe redraw recommendation not found.' }
    const prior = await db.survivorCommissionerAction.findFirst({
      where: { leagueId, actionType: { in: TRIBE_REDRAW_RESPONSE_ACTIONS }, description: recommendation.id }, select: { id: true },
    })
    if (prior) return { ok: false, status: 409, error: 'This tribe redraw has already been decided.' }
    if (decision === 'manual') {
      const league = await db.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
      const settings = normalizeSurvivorFoundationSettings(league?.settings && typeof league.settings === 'object' ? league.settings as Record<string, unknown> : {})
      if (settings.commissionerParticipationMode !== 'non_participating_host') {
        return { ok: false, status: 403, error: 'A playing commissioner cannot hand-pick tribes. Choose the random redraw, merge now, or postpone.' }
      }
    }
    if (decision === 'approve') {
      const redraw = await runShuffle(leagueId, { db, actorUserId: userId, recommendationId })
      if (!redraw.ok) return { ok: false, status: 409, error: redraw.error ?? 'The redraw could not run.' }
    }
    await db.survivorCommissionerAction.create({ data: {
      leagueId, commissionerId: userId, week: recommendation.week,
      actionType: TRIBE_REDRAW_RESPONSE_ACTION[decision],
      description: recommendation.id, wasConfirmed: !automatic,
      newState: { decision, automatic },
    } })
    await db.survivorAuditEntry.create({ data: {
      leagueId, week: recommendation.week, category: 'tribe',
      action: automatic ? 'tribe_redraw_auto_applied' : `tribe_redraw_${AUDIT_SUFFIX[decision]}`,
      actorUserId: automatic ? null : userId, relatedEntityId: recommendation.id, relatedEntityType: 'survivor_commissioner_action',
      data: { decision, automatic }, isVisibleToCommissioner: true, isVisibleToPublic: true,
    } })
    return { ok: true, decision, automatic }
  })
  if (result.ok && decision === 'merge') {
    // Outside the setup transaction: the merge moves the cast and opens the merge chat in its own.
    // Loaded here, not at the top: the commissioner dashboard and the elimination service read this
    // module, and the state machine's whole import graph must not ride along with them.
    const { advancePhase } = await import('./gameStateMachine')
    await advancePhase(leagueId, automatic ? 'automatic' : 'commissioner', automatic ? undefined : userId, { toPhase: 'merge', notes: 'tribe_imbalance_merge_now' })
    return { ...result, mergeStarted: true }
  }
  return result
}

/**
 * The default when nobody decides. Called by the season runner just before it opens a council:
 * a recommendation raised in an EARLIER week is answered with the random redraw, as Chimmy. The
 * recommendation's own week is never touched, so the commissioner always has until the next
 * council to choose. A redraw that cannot run (the merge already happened, tribes out of step)
 * is left for the commissioner rather than retried blindly.
 */
export async function autoApplyPendingTribeRedraw(leagueId: string, week: number): Promise<{ applied: boolean; reason?: string }> {
  const pending = await getPendingTribeRedraw(leagueId)
  if (!pending) return { applied: false, reason: 'none_pending' }
  if (pending.week != null && pending.week >= week) return { applied: false, reason: 'commissioner_window_open' }
  const result = await respondToTribeRedraw(leagueId, SURVIVOR_HOST_USER_ID, pending.id, TRIBE_REDRAW_DEFAULT_DECISION, { automatic: true })
  return result.ok ? { applied: true } : { applied: false, reason: result.error }
}
