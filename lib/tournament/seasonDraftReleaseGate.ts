import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export function seasonDraftMarker(settings: unknown) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const raw = (settings as Record<string, unknown>).seasonTournament
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const marker = raw as Record<string, unknown>
  if (marker.version !== 1 || marker.launchBlocked !== true || typeof marker.tournamentId !== 'string' || typeof marker.freezeId !== 'string' || typeof marker.manifestHash !== 'string' || typeof marker.key !== 'string') return null
  if (marker.stage !== undefined && (typeof marker.stage !== 'number' || ![1, 2, 3].includes(marker.stage))) return null
  return { ...marker, stage: marker.stage ?? 1 } as { version: 1; launchBlocked: true; tournamentId: string; freezeId: string; manifestHash: string; key: string; stage: number }
}

type AuditReader = Pick<Prisma.TransactionClient, 'tournamentAuditLog'>
/** Opens draft actions only after the frozen room has its matching release receipt. */
export async function hasSeasonDraftRelease(leagueId: string, settings: unknown, db: AuditReader = prisma) {
  const marker = seasonDraftMarker(settings)
  if (!marker) return false
  const event = await db.tournamentAuditLog.findFirst({ where: { tournamentId: marker.tournamentId, action: marker.stage === 1 ? 'season_opening_draft_released' : 'season_redraft_released', targetType: 'league', targetId: leagueId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  const data = event?.data as Record<string, unknown> | undefined
  return Boolean(data?.version === 1 && data.freezeId === marker.freezeId && data.manifestHash === marker.manifestHash && data.key === marker.key && data.leagueId === leagueId && data.seasonLaunchReady === false && (marker.stage === 1 || (data.stage === marker.stage && typeof data.cutId === "string")))
}
