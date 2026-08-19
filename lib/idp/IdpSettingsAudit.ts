/**
 * Audit log for IDP config changes. Preserves integrity when eligibility or settings change midseason.
 * PROMPT 5/6.
 */

import { prisma } from '@/lib/prisma'
import { toPrismaNullableJsonInput } from '@/lib/prisma-json'
import type { IdpSettingsAuditAction } from './types'

export interface IdpAuditEntry {
  leagueId: string
  configId: string
  actorId: string | null
  action: IdpSettingsAuditAction
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  metadata?: Record<string, unknown>
}

export async function writeIdpSettingsAudit(entry: IdpAuditEntry): Promise<void> {
  await prisma.idpSettingsAuditLog.create({
    data: {
      leagueId: entry.leagueId,
      configId: entry.configId,
      actorId: entry.actorId ?? undefined,
      action: entry.action,
      before: toPrismaNullableJsonInput(entry.before),
      after: toPrismaNullableJsonInput(entry.after),
      metadata: toPrismaNullableJsonInput(entry.metadata),
    },
  })
}

export async function getIdpSettingsAuditLog(
  leagueId: string,
  options: { limit?: number; since?: Date } = {}
): Promise<Array<{ action: string; actorId: string | null; before: unknown; after: unknown; createdAt: Date }>> {
  const { limit = 50, since } = options
  const rows = await prisma.idpSettingsAuditLog.findMany({
    where: { leagueId, ...(since && { createdAt: { gte: since } }) },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { action: true, actorId: true, before: true, after: true, createdAt: true },
  })
  return rows
}
