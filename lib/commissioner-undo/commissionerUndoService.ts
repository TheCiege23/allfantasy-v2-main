import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logAction } from '@/server/services/auditService'
import { assertLeagueActionGate } from '@/server/services/leagueActionGate'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import {
  isUndoableActionType,
  planUndo,
  STANDINGS_FIELDS,
  UNDO_ACTION_TYPE,
  undoBlockReason,
  type StandingsFields,
  type UndoAuditRow,
  type UndoBlock,
  type UndoCurrent,
  type UndoPlan,
} from './commissionerUndo'

/**
 * Reads the facts the undo rules (./commissionerUndo.ts) need, and applies an undo.
 *
 * The write repeats the "still exactly what was set" check as its own WHERE clause, so an undo racing
 * a waiver claim, a recompute or a second tap restores nothing rather than clobbering the newer value.
 */

const ROW_SELECT = { id: true, actionType: true, entityId: true, beforeState: true, afterState: true, createdAt: true } as const

async function currentFor(leagueId: string, plan: UndoPlan | null): Promise<UndoCurrent> {
  if (!plan) return null
  if (plan.kind === 'standings') {
    const row = await prisma.fantasyStanding.findFirst({ where: { id: plan.standingId, leagueId } })
    if (!row) return null
    const fields = {} as StandingsFields
    for (const f of STANDINGS_FIELDS) fields[f] = row[f]
    return { kind: 'standings', fields, updatedAt: row.updatedAt.toISOString() }
  }
  const roster = await prisma.roster.findFirst({ where: { id: plan.rosterId, leagueId }, select: { faabRemaining: true, waiverPriority: true } })
  return roster ? { kind: 'roster', faabRemaining: roster.faabRemaining, waiverPriority: roster.waiverPriority } : null
}

async function blockFor(leagueId: string, row: UndoAuditRow, now: number): Promise<{ plan: UndoPlan | null; block: UndoBlock | null }> {
  if (!isUndoableActionType(row.actionType)) return { plan: null, block: 'not_undoable' }
  const plan = planUndo(row)
  const [undone, run, current] = await Promise.all([
    prisma.leagueAuditLog.findFirst({ where: { leagueId, actionType: UNDO_ACTION_TYPE, entityId: row.id }, select: { id: true } }),
    plan && plan.kind !== 'standings'
      ? prisma.waiverRun.findFirst({ where: { leagueId, runAt: { gt: row.createdAt } }, select: { id: true } })
      : Promise.resolve(null),
    currentFor(leagueId, plan),
  ])
  return { plan, block: undoBlockReason({ row, plan, now, alreadyUndone: Boolean(undone), waiverRunSince: Boolean(run), current }) }
}

/** Undo availability for each row a commissioner sees in the league log. Rows that are not undoable are left out. */
export async function readUndoStatus(
  leagueId: string,
  rows: readonly UndoAuditRow[],
  now = Date.now(),
): Promise<Map<string, { available: boolean; reason: UndoBlock | null }>> {
  const out = new Map<string, { available: boolean; reason: UndoBlock | null }>()
  for (const row of rows) {
    if (!isUndoableActionType(row.actionType)) continue
    const { block } = await blockFor(leagueId, row, now)
    out.set(row.id, { available: block === null, reason: block })
  }
  return out
}

export type UndoResult = { ok: true; actionType: string } | { ok: false; error: UndoBlock | 'not_found' | 'forbidden'; status: number; message?: string }

export async function undoCommissionerAction(leagueId: string, userId: string, auditId: unknown, now = Date.now()): Promise<UndoResult> {
  if (!(await isElevatedCommissioner(leagueId, userId))) return { ok: false, error: 'forbidden', status: 403 }
  if (typeof auditId !== 'string' || !auditId) return { ok: false, error: 'not_found', status: 404 }
  const row = await prisma.leagueAuditLog.findFirst({ where: { id: auditId, leagueId }, select: ROW_SELECT })
  if (!row) return { ok: false, error: 'not_found', status: 404 }

  const { plan, block } = await blockFor(leagueId, row, now)
  if (block || !plan) return { ok: false, error: block ?? 'no_before_state', status: 409 }

  // The same lifecycle gate the original edit passed: an archived or locked league stays as it is.
  const gate = await assertLeagueActionGate(leagueId, userId, plan.kind === 'standings' ? 'standings_manual_edit' : 'waiver_claim_submit', {
    lifecycle: { commissionerOverride: true },
  })
  if (!gate.ok) return { ok: false, error: 'forbidden', status: gate.err.status ?? 403, message: gate.err.error }

  let changed = 0
  if (plan.kind === 'standings') {
    const where = { id: plan.standingId, leagueId, updatedAt: new Date(plan.afterUpdatedAt) }
    changed = plan.before
      ? (await prisma.fantasyStanding.updateMany({ where, data: plan.before })).count
      : (await prisma.fantasyStanding.deleteMany({ where })).count
  } else {
    changed = (
      plan.kind === 'faab'
        ? await prisma.roster.updateMany({ where: { id: plan.rosterId, leagueId, faabRemaining: plan.after }, data: { faabRemaining: plan.before } })
        : await prisma.roster.updateMany({ where: { id: plan.rosterId, leagueId, waiverPriority: plan.after }, data: { waiverPriority: plan.before } })
    ).count
  }
  if (changed !== 1) return { ok: false, error: 'changed_since', status: 409 }

  await logAction({
    leagueId,
    userId,
    actionType: UNDO_ACTION_TYPE,
    entityType: 'audit_log',
    entityId: row.id,
    beforeState: row.afterState as Prisma.InputJsonValue,
    afterState: row.beforeState as Prisma.InputJsonValue,
    metadata: {
      undoneActionType: row.actionType,
      ...(plan.kind === 'standings' ? { standingId: plan.standingId } : { rosterId: plan.rosterId }),
    },
  })
  return { ok: true, actionType: row.actionType }
}
