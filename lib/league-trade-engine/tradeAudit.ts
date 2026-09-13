/**
 * Trade audit: status history rows, processing events, and `leagueAuditLog` entries.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logAction } from '@/server/services/auditService'
import { captureNativeTradeLifecycleSnapshot } from '@/lib/decision-os/trade/lifecycleSnapshot'

export async function appendAfTradeStatusHistory(input: {
  tradeId: string
  fromStatus: string | null
  toStatus: string
  actorUserId?: string | null
  reason?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  const history = await prisma.afLeagueTradeStatusHistory.create({
    data: {
      tradeId: input.tradeId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      actorUserId: input.actorUserId ?? null,
      reason: input.reason ?? null,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  })
  await captureNativeTradeLifecycleSnapshot({
    tradeId: input.tradeId,
    lifecycleStatus: input.toStatus,
    eventRevision: history.id,
    actorUserId: input.actorUserId,
    occurredAt: history.createdAt,
  })
}

export async function appendAfTradeProcessingEvent(input: {
  tradeId: string
  eventType: string
  payload?: Record<string, unknown>
}): Promise<void> {
  await prisma.afLeagueTradeProcessingEvent.create({
    data: {
      tradeId: input.tradeId,
      eventType: input.eventType,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
    },
  })
}

export async function logAfTradeAudit(input: {
  leagueId: string
  userId?: string | null
  actionType: string
  tradeId: string
  beforeState?: Record<string, unknown> | null
  afterState?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  await logAction({
    leagueId: input.leagueId,
    userId: input.userId ?? null,
    actionType: input.actionType,
    entityType: 'af_league_trade',
    entityId: input.tradeId,
    beforeState: input.beforeState as Prisma.InputJsonValue | null,
    afterState: input.afterState as Prisma.InputJsonValue | null,
    metadata: input.metadata as Prisma.InputJsonValue | undefined,
  })
}
