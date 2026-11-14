/**
 * PROMPT 3: Deterministic Devy lifecycle engine. State machine for ownership, promotion, pool assignment.
 * States: NCAA_DEVY_ACTIVE | NCAA_DEVY_TAXI | NCAA_DEVY_LOCKED | DECLARED | DRAFTED_RIGHTS_HELD |
 *         PROMOTION_ELIGIBLE | PROMOTED_TO_PRO | RETURNED_TO_SCHOOL | RIGHTS_EXPIRED | ORPHANED_RIGHTS.
 */

import { prisma } from '@/lib/prisma'
import { appendDevyLifecycleEvent } from './DevyAuditLog'
import {
  DEVY_LIFECYCLE_STATE,
  type DevyLifecycleState,
} from '../types'

const VALID_TRANSITIONS: Partial<Record<DevyLifecycleState, DevyLifecycleState[]>> = {
  [DEVY_LIFECYCLE_STATE.NCAA_DEVY_ACTIVE]: [
    DEVY_LIFECYCLE_STATE.NCAA_DEVY_TAXI,
    DEVY_LIFECYCLE_STATE.NCAA_DEVY_LOCKED,
    DEVY_LIFECYCLE_STATE.DECLARED,
    DEVY_LIFECYCLE_STATE.RIGHTS_EXPIRED,
  ],
  [DEVY_LIFECYCLE_STATE.NCAA_DEVY_TAXI]: [
    DEVY_LIFECYCLE_STATE.NCAA_DEVY_ACTIVE,
    DEVY_LIFECYCLE_STATE.DECLARED,
    DEVY_LIFECYCLE_STATE.RIGHTS_EXPIRED,
  ],
  [DEVY_LIFECYCLE_STATE.NCAA_DEVY_LOCKED]: [
    DEVY_LIFECYCLE_STATE.NCAA_DEVY_ACTIVE,
    DEVY_LIFECYCLE_STATE.DECLARED,
  ],
  [DEVY_LIFECYCLE_STATE.DECLARED]: [
    DEVY_LIFECYCLE_STATE.DRAFTED_RIGHTS_HELD,
    DEVY_LIFECYCLE_STATE.RETURNED_TO_SCHOOL,
    DEVY_LIFECYCLE_STATE.ORPHANED_RIGHTS,
  ],
  [DEVY_LIFECYCLE_STATE.DRAFTED_RIGHTS_HELD]: [
    DEVY_LIFECYCLE_STATE.PROMOTION_ELIGIBLE,
    DEVY_LIFECYCLE_STATE.RETURNED_TO_SCHOOL,
  ],
  [DEVY_LIFECYCLE_STATE.PROMOTION_ELIGIBLE]: [
    DEVY_LIFECYCLE_STATE.PROMOTED_TO_PRO,
    DEVY_LIFECYCLE_STATE.RETURNED_TO_SCHOOL,
    DEVY_LIFECYCLE_STATE.RIGHTS_EXPIRED,
  ],
  [DEVY_LIFECYCLE_STATE.PROMOTED_TO_PRO]: [DEVY_LIFECYCLE_STATE.RETURNED_TO_SCHOOL],
  [DEVY_LIFECYCLE_STATE.RETURNED_TO_SCHOOL]: [
    DEVY_LIFECYCLE_STATE.NCAA_DEVY_ACTIVE,
    DEVY_LIFECYCLE_STATE.NCAA_DEVY_TAXI,
  ],
  [DEVY_LIFECYCLE_STATE.RIGHTS_EXPIRED]: [],
  [DEVY_LIFECYCLE_STATE.ORPHANED_RIGHTS]: [
    DEVY_LIFECYCLE_STATE.DRAFTED_RIGHTS_HELD,
    DEVY_LIFECYCLE_STATE.PROMOTION_ELIGIBLE,
  ],
}

export function canTransition(from: DevyLifecycleState, to: DevyLifecycleState): boolean {
  const allowed = VALID_TRANSITIONS[from]
  return Array.isArray(allowed) && allowed.includes(to)
}

export interface TransitionDevyRightsInput {
  rightsId: string
  newState: DevyLifecycleState
  promotedProPlayerId?: string
  sourceConfidence?: number
}

export async function transitionDevyRights(args: TransitionDevyRightsInput): Promise<{ ok: boolean; error?: string }> {
  const right = await prisma.devyRights.findUnique({ where: { id: args.rightsId } })
  if (!right) return { ok: false, error: 'Devy rights not found' }

  if (!canTransition(right.state as DevyLifecycleState, args.newState)) {
    return { ok: false, error: `Invalid transition from ${right.state} to ${args.newState}` }
  }

  const update: Record<string, unknown> = { state: args.newState }
  if (args.newState === DEVY_LIFECYCLE_STATE.PROMOTED_TO_PRO) {
    update.promotedProPlayerId = args.promotedProPlayerId ?? null
    update.promotedAt = new Date()
    update.managerPromotedAt = new Date()
  }
  if (args.newState === DEVY_LIFECYCLE_STATE.RETURNED_TO_SCHOOL) {
    update.returnedToSchoolAt = new Date()
    update.promotedProPlayerId = null
    update.promotedAt = null
  }
  if (args.sourceConfidence != null) update.sourceConfidence = args.sourceConfidence

  await prisma.devyRights.update({
    where: { id: args.rightsId },
    data: update as any,
  })

  await appendDevyLifecycleEvent({
    leagueId: right.leagueId,
    eventType: 'pool_assignment',
    rosterId: right.rosterId,
    devyPlayerId: right.devyPlayerId,
    proPlayerId: args.promotedProPlayerId ?? undefined,
    payload: { from: right.state, to: args.newState },
  })

  return { ok: true }
}

/**
 * When a devy player is detected as "declared" (entering draft), move DECLARED rights to DRAFTED_RIGHTS_HELD
 * after draft detection; or mark PROMOTION_ELIGIBLE when they are drafted and rights are held.
 */
export async function markDeclaredAndDrafted(args: {
  leagueId: string
  devyPlayerId: string
  seasonYear: number
  proPlayerId?: string
  sourceConfidence?: number
}): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = []
  const rights = await prisma.devyRights.findMany({
    where: { leagueId: args.leagueId, devyPlayerId: args.devyPlayerId },
  })

  let updated = 0
  for (const r of rights) {
    const from = r.state as DevyLifecycleState
    const to = args.proPlayerId
      ? DEVY_LIFECYCLE_STATE.PROMOTION_ELIGIBLE
      : DEVY_LIFECYCLE_STATE.DRAFTED_RIGHTS_HELD
    if (!canTransition(from, to)) {
      if (from === DEVY_LIFECYCLE_STATE.DECLARED && args.proPlayerId && canTransition(from, DEVY_LIFECYCLE_STATE.DRAFTED_RIGHTS_HELD)) {
        await prisma.devyRights.update({
          where: { id: r.id },
          data: {
            state: DEVY_LIFECYCLE_STATE.DRAFTED_RIGHTS_HELD,
            seasonYear: args.seasonYear,
            sourceConfidence: args.sourceConfidence ?? r.sourceConfidence,
          },
        })
        updated++
      }
      continue
    }
    const data: any = { state: to, seasonYear: args.seasonYear, sourceConfidence: args.sourceConfidence ?? r.sourceConfidence }
    if (to === DEVY_LIFECYCLE_STATE.PROMOTION_ELIGIBLE && args.proPlayerId) {
      data.promotedProPlayerId = args.proPlayerId
    }
    await prisma.devyRights.update({ where: { id: r.id }, data })
    updated++

    await appendDevyLifecycleEvent({
      leagueId: args.leagueId,
      eventType: args.proPlayerId ? 'draft_detected' : 'declare_detected',
      rosterId: r.rosterId,
      devyPlayerId: args.devyPlayerId,
      proPlayerId: args.proPlayerId,
      payload: { from, to, seasonYear: args.seasonYear },
    })
  }
  return { updated, errors }
}

/**
 * Return to school: restore NCAA devy state and keep rights with current manager.
 */
export async function returnToSchool(args: { rightsId: string }): Promise<{ ok: boolean; error?: string }> {
  const right = await prisma.devyRights.findUnique({ where: { id: args.rightsId } })
  if (!right) return { ok: false, error: 'Devy rights not found' }

  const from = right.state as DevyLifecycleState
  if (!canTransition(from, DEVY_LIFECYCLE_STATE.RETURNED_TO_SCHOOL)) {
    return { ok: false, error: `Cannot return to school from ${from}` }
  }

  await prisma.devyRights.update({
    where: { id: args.rightsId },
    data: {
      state: DEVY_LIFECYCLE_STATE.RETURNED_TO_SCHOOL,
      returnedToSchoolAt: new Date(),
      promotedProPlayerId: null,
      promotedAt: null,
    },
  })

  await appendDevyLifecycleEvent({
    leagueId: right.leagueId,
    eventType: 'return_to_school',
    rosterId: right.rosterId,
    devyPlayerId: right.devyPlayerId,
    payload: { from },
  })

  return { ok: true }
}

/**
 * After return to school, restore to NCAA_DEVY_ACTIVE (or TAXI if league rule).
 */
export async function restoreNcaaState(args: {
  rightsId: string
  state: typeof DEVY_LIFECYCLE_STATE.NCAA_DEVY_ACTIVE | typeof DEVY_LIFECYCLE_STATE.NCAA_DEVY_TAXI
}): Promise<{ ok: boolean; error?: string }> {
  const right = await prisma.devyRights.findUnique({ where: { id: args.rightsId } })
  if (!right) return { ok: false, error: 'Devy rights not found' }
  if (right.state !== DEVY_LIFECYCLE_STATE.RETURNED_TO_SCHOOL) {
    return { ok: false, error: 'Only RETURNED_TO_SCHOOL can be restored to NCAA state' }
  }

  await prisma.devyRights.update({
    where: { id: args.rightsId },
    data: { state: args.state, returnedToSchoolAt: null },
  })
  return { ok: true }
}
