/**
 * PROMPT 3: C2C deterministic lifecycle engine. State machine for college/pro rights, promotion, pool assignment.
 * Reuses DevyRights.state; C2C uses same states as devy plus ROOKIE_POOL_ELIGIBLE, ROOKIE_POOL_EXCLUDED, TAXI_COLLEGE where applicable.
 */

import { prisma } from '@/lib/prisma'
import { appendC2CLifecycleEvent } from './C2CAuditLog'
import { C2C_LIFECYCLE_STATE } from '../types'
import { DEVY_LIFECYCLE_STATE } from '@/lib/devy/types'

/** States that are treated as "college active" for C2C (can score in college contests until promotion deadline). */
export const C2C_COLLEGE_ACTIVE_STATES = new Set<string>([
  C2C_LIFECYCLE_STATE.COLLEGE_ACTIVE,
  C2C_LIFECYCLE_STATE.COLLEGE_STARTER,
  C2C_LIFECYCLE_STATE.COLLEGE_BENCH,
  C2C_LIFECYCLE_STATE.COLLEGE_BESTBALL_ELIGIBLE,
  C2C_LIFECYCLE_STATE.NCAA_DEVY_ACTIVE,
  DEVY_LIFECYCLE_STATE.NCAA_DEVY_ACTIVE,
  DEVY_LIFECYCLE_STATE.NCAA_DEVY_TAXI,
])

/** Valid C2C transitions (aligned with devy where overlapping). */
const C2C_VALID_TRANSITIONS: Partial<Record<string, string[]>> = {
  [C2C_LIFECYCLE_STATE.COLLEGE_ACTIVE]: [C2C_LIFECYCLE_STATE.DECLARED, C2C_LIFECYCLE_STATE.TAXI_COLLEGE, C2C_LIFECYCLE_STATE.RIGHTS_EXPIRED],
  [C2C_LIFECYCLE_STATE.NCAA_DEVY_ACTIVE]: [C2C_LIFECYCLE_STATE.DECLARED, C2C_LIFECYCLE_STATE.TAXI_COLLEGE, C2C_LIFECYCLE_STATE.RIGHTS_EXPIRED, DEVY_LIFECYCLE_STATE.DECLARED],
  [DEVY_LIFECYCLE_STATE.NCAA_DEVY_TAXI]: [C2C_LIFECYCLE_STATE.DECLARED, DEVY_LIFECYCLE_STATE.DECLARED],
  [C2C_LIFECYCLE_STATE.DECLARED]: [C2C_LIFECYCLE_STATE.DRAFTED_RIGHTS_HELD, DEVY_LIFECYCLE_STATE.DRAFTED_RIGHTS_HELD, C2C_LIFECYCLE_STATE.RETURNED_TO_SCHOOL, C2C_LIFECYCLE_STATE.ROOKIE_POOL_ELIGIBLE, C2C_LIFECYCLE_STATE.ORPHANED_RIGHTS],
  [C2C_LIFECYCLE_STATE.DRAFTED_RIGHTS_HELD]: [C2C_LIFECYCLE_STATE.PROMOTION_ELIGIBLE, DEVY_LIFECYCLE_STATE.PROMOTION_ELIGIBLE, C2C_LIFECYCLE_STATE.RETURNED_TO_SCHOOL],
  [C2C_LIFECYCLE_STATE.PROMOTION_ELIGIBLE]: [C2C_LIFECYCLE_STATE.PROMOTED_TO_PRO, C2C_LIFECYCLE_STATE.RETURNED_TO_SCHOOL, C2C_LIFECYCLE_STATE.RIGHTS_EXPIRED, C2C_LIFECYCLE_STATE.ROOKIE_POOL_EXCLUDED],
  [C2C_LIFECYCLE_STATE.PROMOTED_TO_PRO]: [C2C_LIFECYCLE_STATE.RETURNED_TO_SCHOOL],
  [C2C_LIFECYCLE_STATE.RETURNED_TO_SCHOOL]: [C2C_LIFECYCLE_STATE.COLLEGE_ACTIVE, C2C_LIFECYCLE_STATE.NCAA_DEVY_ACTIVE, DEVY_LIFECYCLE_STATE.NCAA_DEVY_ACTIVE, C2C_LIFECYCLE_STATE.TAXI_COLLEGE],
  [C2C_LIFECYCLE_STATE.ROOKIE_POOL_ELIGIBLE]: [C2C_LIFECYCLE_STATE.DRAFTED_RIGHTS_HELD],
  [C2C_LIFECYCLE_STATE.ORPHANED_RIGHTS]: [C2C_LIFECYCLE_STATE.DRAFTED_RIGHTS_HELD, C2C_LIFECYCLE_STATE.PROMOTION_ELIGIBLE],
}

export function canTransitionC2C(from: string, to: string): boolean {
  const allowed = C2C_VALID_TRANSITIONS[from]
  return Array.isArray(allowed) && allowed.includes(to)
}

export interface TransitionC2CRightsInput {
  rightsId: string
  newState: string
  promotedProPlayerId?: string
  sourceConfidence?: number
}

export async function transitionC2CRights(args: TransitionC2CRightsInput): Promise<{ ok: boolean; error?: string }> {
  const right = await prisma.devyRights.findUnique({ where: { id: args.rightsId } })
  if (!right) return { ok: false, error: 'Rights not found' }

  if (!canTransitionC2C(right.state, args.newState)) {
    return { ok: false, error: `Invalid C2C transition from ${right.state} to ${args.newState}` }
  }

  const update: Record<string, unknown> = { state: args.newState }
  if (args.newState === C2C_LIFECYCLE_STATE.PROMOTED_TO_PRO || args.newState === DEVY_LIFECYCLE_STATE.PROMOTED_TO_PRO) {
    update.promotedProPlayerId = args.promotedProPlayerId ?? null
    update.promotedAt = new Date()
    update.managerPromotedAt = new Date()
  }
  if (args.newState === C2C_LIFECYCLE_STATE.RETURNED_TO_SCHOOL || args.newState === DEVY_LIFECYCLE_STATE.RETURNED_TO_SCHOOL) {
    update.returnedToSchoolAt = new Date()
    update.promotedProPlayerId = null
    update.promotedAt = null
  }
  if (args.sourceConfidence != null) update.sourceConfidence = args.sourceConfidence

  await prisma.devyRights.update({
    where: { id: args.rightsId },
    data: update as any,
  })

  await appendC2CLifecycleEvent({
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
 * When a college player is detected as declared/drafted; mark rights accordingly. Owned → DRAFTED_RIGHTS_HELD or PROMOTION_ELIGIBLE; unowned → ROOKIE_POOL_ELIGIBLE.
 */
export async function markC2CDeclaredAndDrafted(args: {
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

  const toState = args.proPlayerId
    ? (rights.length > 0 ? C2C_LIFECYCLE_STATE.PROMOTION_ELIGIBLE : C2C_LIFECYCLE_STATE.ROOKIE_POOL_ELIGIBLE)
    : C2C_LIFECYCLE_STATE.DECLARED

  let updated = 0
  for (const r of rights) {
    const from = r.state
    if (!canTransitionC2C(from, toState)) {
      if (from === DEVY_LIFECYCLE_STATE.DECLARED && args.proPlayerId && canTransitionC2C(from, C2C_LIFECYCLE_STATE.DRAFTED_RIGHTS_HELD)) {
        await prisma.devyRights.update({
          where: { id: r.id },
          data: {
            state: C2C_LIFECYCLE_STATE.DRAFTED_RIGHTS_HELD,
            seasonYear: args.seasonYear,
            sourceConfidence: args.sourceConfidence ?? r.sourceConfidence,
          },
        })
        updated++
      }
      continue
    }
    const data: any = { state: toState, seasonYear: args.seasonYear, sourceConfidence: args.sourceConfidence ?? r.sourceConfidence }
    if (toState === C2C_LIFECYCLE_STATE.PROMOTION_ELIGIBLE && args.proPlayerId) {
      data.promotedProPlayerId = args.proPlayerId
    }
    await prisma.devyRights.update({ where: { id: r.id }, data })
    updated++

    await appendC2CLifecycleEvent({
      leagueId: args.leagueId,
      eventType: args.proPlayerId ? 'draft_detected' : 'declare_detected',
      rosterId: r.rosterId,
      devyPlayerId: args.devyPlayerId,
      proPlayerId: args.proPlayerId,
      payload: { from, to: toState, seasonYear: args.seasonYear },
    })
  }
  return { updated, errors }
}

/** Return to school: restore college state; keep rights with same manager. */
export async function c2CReturnToSchool(args: { rightsId: string }): Promise<{ ok: boolean; error?: string }> {
  const right = await prisma.devyRights.findUnique({ where: { id: args.rightsId } })
  if (!right) return { ok: false, error: 'Rights not found' }

  const from = right.state
  if (!canTransitionC2C(from, C2C_LIFECYCLE_STATE.RETURNED_TO_SCHOOL)) {
    return { ok: false, error: `Cannot return to school from ${from}` }
  }

  await prisma.devyRights.update({
    where: { id: args.rightsId },
    data: {
      state: C2C_LIFECYCLE_STATE.RETURNED_TO_SCHOOL,
      returnedToSchoolAt: new Date(),
      promotedProPlayerId: null,
      promotedAt: null,
    },
  })

  await appendC2CLifecycleEvent({
    leagueId: right.leagueId,
    eventType: 'return_to_school',
    rosterId: right.rosterId,
    devyPlayerId: right.devyPlayerId,
    payload: { from },
  })

  return { ok: true }
}

/** After return to school, restore to college active (or taxi college per league rule). */
export async function c2CRestoreCollegeState(args: {
  rightsId: string
  state: typeof C2C_LIFECYCLE_STATE.COLLEGE_ACTIVE | typeof C2C_LIFECYCLE_STATE.NCAA_DEVY_ACTIVE | typeof C2C_LIFECYCLE_STATE.TAXI_COLLEGE
}): Promise<{ ok: boolean; error?: string }> {
  const right = await prisma.devyRights.findUnique({ where: { id: args.rightsId } })
  if (!right) return { ok: false, error: 'Rights not found' }
  if (right.state !== C2C_LIFECYCLE_STATE.RETURNED_TO_SCHOOL) {
    return { ok: false, error: 'Only RETURNED_TO_SCHOOL can be restored to college state' }
  }

  await prisma.devyRights.update({
    where: { id: args.rightsId },
    data: { state: args.state, returnedToSchoolAt: null },
  })
  return { ok: true }
}
