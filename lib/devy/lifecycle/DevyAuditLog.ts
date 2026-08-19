/**
 * PROMPT 3: Audit log for every graduation, promotion, pool assignment, and commissioner action.
 */

import { prisma } from '@/lib/prisma'
import { toPrismaNullableJsonInput } from '@/lib/prisma-json'

export type DevyLifecycleEventType =
  | 'graduation'
  | 'promotion'
  | 'return_to_school'
  | 'rights_expired'
  | 'orphaned'
  | 'pool_assignment'
  | 'commissioner_override'
  | 'declare_detected'
  | 'draft_detected'
  | 'force_promote'
  | 'revoke_promotion'
  | 'reopen_window'
  | 'recalc_status'
  | 'regenerate_pool'
  | 'repair_duplicate_rights'

export interface AppendDevyEventInput {
  leagueId: string
  eventType: DevyLifecycleEventType
  rosterId?: string
  devyPlayerId?: string
  proPlayerId?: string
  payload?: Record<string, unknown>
}

export async function appendDevyLifecycleEvent(input: AppendDevyEventInput): Promise<void> {
  await prisma.devyLifecycleEvent.create({
    data: {
      leagueId: input.leagueId,
      eventType: input.eventType,
      rosterId: input.rosterId ?? null,
      devyPlayerId: input.devyPlayerId ?? null,
      proPlayerId: input.proPlayerId ?? null,
      payload: toPrismaNullableJsonInput(input.payload),
    },
  })
}

export async function getDevyLifecycleEvents(args: {
  leagueId: string
  eventType?: DevyLifecycleEventType
  limit?: number
  offset?: number
}): Promise<
  Array<{
    id: string
    eventType: string
    rosterId: string | null
    devyPlayerId: string | null
    proPlayerId: string | null
    payload: unknown
    createdAt: Date
  }>
> {
  const { leagueId, eventType, limit = 100, offset = 0 } = args
  const rows = await prisma.devyLifecycleEvent.findMany({
    where: { leagueId, ...(eventType && { eventType }) },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
    select: {
      id: true,
      eventType: true,
      rosterId: true,
      devyPlayerId: true,
      proPlayerId: true,
      payload: true,
      createdAt: true,
    },
  })
  return rows
}
