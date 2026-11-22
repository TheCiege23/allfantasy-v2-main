import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type FinanceAuditInput = {
  leagueId: string
  actorUserId?: string | null
  eventType: string
  entityType: string
  entityId?: string | null
  payload?: Prisma.InputJsonValue | null
}

/** Append-only finance audit row (dispute-safe trail alongside `LeagueAuditLog`). */
export async function appendFinanceAuditEvent(input: FinanceAuditInput): Promise<{ id: string }> {
  const row = await prisma.financeAuditEvent.create({
    data: {
      leagueId: input.leagueId,
      actorUserId: input.actorUserId ?? null,
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      payload: input.payload ?? undefined,
    },
  })
  return { id: row.id }
}
