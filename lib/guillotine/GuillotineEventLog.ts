/**
 * Append-only guillotine event log (chop, commissioner override, media events).
 */

import * as prismaJson from '@/lib/prisma-json'
import { prisma } from '@/lib/prisma'
import type { GuillotineEventType } from './types'

export async function appendEvent(
  leagueId: string,
  eventType: GuillotineEventType,
  metadata?: Record<string, unknown>
): Promise<void> {
  await prisma.guillotineEventLog.create({
    data: {
      leagueId,
      eventType,
      metadata: prismaJson.toPrismaNullableJsonInput(metadata ?? undefined),
    },
  })
}

export async function getRecentEvents(
  leagueId: string,
  options: { limit?: number; eventTypes?: GuillotineEventType[] } = {}
): Promise<{ eventType: string; metadata: unknown; createdAt: Date }[]> {
  const limit = Math.min(options.limit ?? 50, 100)
  const where: { leagueId: string; eventType?: { in: string[] } } = { leagueId }
  if (options.eventTypes?.length) {
    where.eventType = { in: options.eventTypes }
  }
  const rows = await prisma.guillotineEventLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { eventType: true, metadata: true, createdAt: true },
  })
  return rows
}
