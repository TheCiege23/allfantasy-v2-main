import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeSurvivorFoundationSettings } from './normalizeSurvivorSettings'
import { runShuffle } from './SurvivorTribeShuffleEngine'
import { notifySurvivorCommissionerOnce } from './survivorCommissionerAlerts'
import { withSurvivorSetupTransaction } from './survivorSetupTransaction'
import {
  SURVIVOR_HOST_USER_ID,
  TRIBE_REDRAW_DECISIONS,
  TRIBE_REDRAW_DEFAULT_DECISION,
  TRIBE_REDRAW_RECOMMENDATION_ACTION,
  TRIBE_REDRAW_RESPONSE_ACTION,
  TRIBE_REDRAW_RESPONSE_ACTIONS,
  survivorRedrawTribeCount,
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

/** A tribe below this many active managers cannot hold a council: nobody is left to vote. */
export const SURVIVOR_COUNCIL_MIN_TRIBE_SIZE = 2

export type CouncilTribeGuardResult = { action: 'none' | 'redrawn' | 'merged'; reason?: string; tribeCount?: number }

/**
 * Never freeze. Called by the season runner just before it opens a pre-merge council: when any
 * tribe is down to one manager (or none), the council cannot run, so the commissioner's window is
 * over and Chimmy acts now. The default is a random redraw into as many tribes as the cast can
 * fill; when no fair redraw is possible, the merge starts early. Either way the commissioner hears
 * about it once and the season carries on.
 */
export async function rebalanceTribesBeforeCouncil(leagueId: string, week: number): Promise<CouncilTribeGuardResult> {
  const game = await prisma.survivorGameState.findUnique({ where: { leagueId }, select: { phase: true, mergeTriggeredAt: true, activeCouncilId: true } })
  if (!game || game.mergeTriggeredAt || game.activeCouncilId || !['pre_merge', 'active', 'tribe', 'post_swap'].includes(game.phase)) return { action: 'none' }
  const tribes = await prisma.survivorTribe.findMany({ where: { leagueId, isActive: true, isMerged: false }, select: { id: true } })
  if (tribes.length < 2) return { action: 'none' }
  const players = await prisma.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { tribeId: true } })
  const sizes = tribes.map(tribe => players.filter(player => player.tribeId === tribe.id).length)
  const smallest = Math.min(...sizes)
  if (smallest >= SURVIVOR_COUNCIL_MIN_TRIBE_SIZE) return { action: 'none' }

  const pending = await getPendingTribeRedraw(leagueId)
  const tribeCount = survivorRedrawTribeCount(players.length, tribes.length)
  let action: CouncilTribeGuardResult['action'] = 'none'
  let reason: string | undefined
  if (tribeCount != null) {
    const redraw = pending
      ? await respondToTribeRedraw(leagueId, SURVIVOR_HOST_USER_ID, pending.id, 'approve', { automatic: true })
      : await runShuffle(leagueId, { actorUserId: SURVIVOR_HOST_USER_ID })
    if (redraw.ok) action = 'redrawn'
    else reason = redraw.error
  }
  if (action === 'none') {
    if (pending && (await getPendingTribeRedraw(leagueId))?.id === pending.id) {
      const merged = await respondToTribeRedraw(leagueId, SURVIVOR_HOST_USER_ID, pending.id, 'merge', { automatic: true })
      if (merged.ok) action = 'merged'
      else reason = merged.error
    } else {
      const { advancePhase } = await import('./gameStateMachine')
      await advancePhase(leagueId, 'automatic', undefined, { toPhase: 'merge', notes: 'tribe_too_small_merge_now' })
      action = 'merged'
    }
  }
  if (action === 'none') return { action, reason }

  await notifySurvivorCommissionerOnce(leagueId, 'tribes_rebalanced', {
    dedupeKey: `${week}:${action}`,
    week,
    urgency: 'medium',
    title: action === 'redrawn' ? 'Tribes redrawn so the season keeps moving' : 'The merge started early so the season keeps moving',
    body: action === 'redrawn'
      ? `A tribe was down to ${smallest} manager${smallest === 1 ? '' : 's'}, too few for Tribal Council. Chimmy redrew the cast into ${tribeCount} tribes before this week's council. Nothing for you to do.`
      : `A tribe was down to ${smallest} manager${smallest === 1 ? '' : 's'} and the cast was too small to redraw fairly, so Chimmy started the merge before this week's council. Nothing for you to do.`,
    deepLinkPath: `/survivor/${leagueId}/commissioner?tab=tribes`,
  }).catch(() => {})
  return { action, ...(action === 'redrawn' && tribeCount != null ? { tribeCount } : {}) }
}
