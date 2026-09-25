/**
 * PROMPT 5: Tournament audit logging for advancement, elimination, overrides, tie resolution, lock, rebalance.
 */

import * as prismaJson from '@/lib/prisma-json'
import { prisma } from '@/lib/prisma'

export type TournamentAuditAction =
  | 'advancement_run'
  | 'elimination'
  | 'force_advance'
  | 'tie_resolution'
  | 'lock'
  | 'rebalance'
  | 'rerun_standings'
  | 'rerun_seeding'
  | 'redraft_regenerate'
  | 'draft_reopen'
  | 'archive_round'
  | 'resolve_state'
  | 'bulk_update'
  | 'create_missing_league'
  | 'post_announcement'

export async function logTournamentAudit(
  tournamentId: string,
  action: TournamentAuditAction,
  options: {
    actorId?: string
    targetType?: 'participant' | 'league' | 'round' | 'tournament'
    targetId?: string
    metadata?: Record<string, unknown>
  }
): Promise<void> {
  await prisma.legacyTournamentAuditLog.create({
    data: {
      tournamentId,
      actorId: options.actorId ?? null,
      action,
      targetType: options.targetType ?? null,
      targetId: options.targetId ?? null,
      metadata: prismaJson.toPrismaNullableJsonInput((options.metadata ?? undefined) as Record<string, unknown> | undefined),
    },
  })
}

export async function getTournamentAuditLogs(
  tournamentId: string,
  options?: { limit?: number; action?: TournamentAuditAction }
): Promise<
  Array<{
    id: string
    action: string
    actorId: string | null
    targetType: string | null
    targetId: string | null
    metadata: unknown
    createdAt: Date
  }>
> {
  const where: { tournamentId: string; action?: string } = { tournamentId }
  if (options?.action) where.action = options.action
  const rows = await prisma.legacyTournamentAuditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: options?.limit ?? 100,
  })
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actorId: r.actorId,
    targetType: r.targetType,
    targetId: r.targetId,
    metadata: r.metadata,
    createdAt: r.createdAt,
  }))
}
