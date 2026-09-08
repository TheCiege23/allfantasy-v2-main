/**
 * Persistent audit trail for league operations (`audit_logs` / `LeagueAuditLog`).
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { auditUserId } from '@/lib/league/systemActor'

export type AuditLogInput = {
  leagueId: string
  userId?: string | null
  actionType: string
  entityType: string
  entityId?: string | null
  beforeState?: Prisma.InputJsonValue | null
  afterState?: Prisma.InputJsonValue | null
  metadata?: Prisma.InputJsonValue | null
}

/** Canonical league created via `postCreateLeague` — persisted after `League` row exists. */
export async function logLeagueCreated(input: {
  leagueId: string
  userId: string
  leagueName: string
  sport: string
  concept: string
  presetKey?: string | null
}): Promise<{ id: string }> {
  return logAction({
    leagueId: input.leagueId,
    userId: input.userId,
    actionType: 'league_created',
    entityType: 'league',
    entityId: input.leagueId,
    afterState: {
      leagueName: input.leagueName,
      sport: input.sport,
      concept: input.concept,
      lifecycleState: 'setup',
    },
    metadata: { source: 'createLeagueHandler', presetKey: input.presetKey ?? null },
  })
}

export async function logAction(input: AuditLogInput): Promise<{ id: string }> {
  const row = await prisma.leagueAuditLog.create({
    data: {
      leagueId: input.leagueId,
      // `userId` is FK-constrained to AppUser. A scheduled actor
      // (`system:…`) is not a user, and writing its label violates the key and
      // rolls back whatever transaction this sits in — see lib/league/systemActor.
      userId: auditUserId(input.userId),
      actionType: input.actionType,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      beforeState: input.beforeState ?? undefined,
      afterState: input.afterState ?? undefined,
      metadata: input.metadata ?? undefined,
    },
  })
  return { id: row.id }
}

export type AuditLogFilter = {
  actionTypes?: string[]
  limit?: number
  cursor?: string
}

export async function getAuditLogs(leagueId: string, filter?: AuditLogFilter) {
  const limit = Math.min(200, Math.max(1, filter?.limit ?? 50))
  const where: Prisma.LeagueAuditLogWhereInput = { leagueId }
  if (filter?.actionTypes?.length) {
    where.actionType = { in: filter.actionTypes }
  }

  const rows = await prisma.leagueAuditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(filter?.cursor
      ? {
          cursor: { id: filter.cursor },
          skip: 1,
        }
      : {}),
    select: {
      id: true,
      leagueId: true,
      userId: true,
      actionType: true,
      entityType: true,
      entityId: true,
      beforeState: true,
      afterState: true,
      metadata: true,
      createdAt: true,
    },
  })

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? items[items.length - 1]?.id : null

  return { items, nextCursor }
}
