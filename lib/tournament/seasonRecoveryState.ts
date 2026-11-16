import 'server-only'
import type { Prisma } from '@prisma/client'

export const RECOVERY_REQUESTED = 'season_recovery_requested'
export const RECOVERY_RESOLVED = 'season_recovery_resolved'
export const SCORE_DELAYED = 'season_scoring_delayed'
export const SCORE_RECOVERED = 'season_scoring_recovered'
export const RECOVERY_HOLD_MESSAGE = 'Tournament recovery is under owner review. Draft and advancement actions are paused.'
export const newestSeasonEvent = [{ createdAt: 'desc' as const }, { id: 'desc' as const }]
export const OPENING_FIELD_REOPENED = 'season_opening_field_reopened'

export async function currentSeasonOpeningField(db: Pick<Prisma.TransactionClient, 'tournamentAuditLog'>, tournamentId: string) {
  const latest = await db.tournamentAuditLog.findFirst({
    where: { tournamentId, action: { in: ['season_opening_field_frozen', OPENING_FIELD_REOPENED] } },
    orderBy: newestSeasonEvent,
  })
  return latest?.action === 'season_opening_field_frozen' ? latest : null
}

export async function findOpenSeasonRecoveries(db: Pick<Prisma.TransactionClient, 'tournamentAuditLog'>, tournamentId: string) {
  const records = await db.tournamentAuditLog.findMany({
    where: { tournamentId, action: { in: [RECOVERY_REQUESTED, RECOVERY_RESOLVED] } },
    orderBy: newestSeasonEvent,
    select: { id: true, targetId: true, action: true, data: true, createdAt: true },
  })
  const resolved = new Set(records.filter(row => row.action === RECOVERY_RESOLVED).map(row => row.targetId))
  return records.filter(row => row.action === RECOVERY_REQUESTED && !resolved.has(row.id))
}

export async function seasonRecoveryHeld(db: Pick<Prisma.TransactionClient, 'tournamentAuditLog'>, tournamentId: string) {
  return (await findOpenSeasonRecoveries(db, tournamentId)).length > 0
}

/** Mutators lock the shell before rechecking holds, using the same lock as owner resolutions. */
export async function lockAndCheckSeasonRecovery(tx: Prisma.TransactionClient, tournamentId: string) {
  await tx.$queryRaw`SELECT id FROM tournament_shells WHERE id = ${tournamentId} FOR UPDATE`
  return seasonRecoveryHeld(tx, tournamentId)
}
