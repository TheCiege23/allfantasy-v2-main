// lib/trade-engine/snapshots.ts
import { prisma } from '@/lib/prisma'

export type SnapshotType = 'league_analyze' | 'rankings_analyze' | 'otb_packages'

export async function readLatestSnapshot(opts: {
  leagueId: string
  sleeperUsername: string
  snapshotType: SnapshotType
  contextKey?: string | null
}) {
  const leagueId = String(opts.leagueId || '').trim()
  const sleeperUsername = String(opts.sleeperUsername || '').trim().toLowerCase()
  const snapshotType = opts.snapshotType
  const contextKey = opts.contextKey ? String(opts.contextKey).trim() : null

  if (!leagueId || !sleeperUsername || !snapshotType) return null
  if (!(['league_analyze', 'rankings_analyze', 'otb_packages'] as const).includes(snapshotType)) return null

  const row = await (prisma as any).tradeAnalysisSnapshot.findFirst({
    where: {
      leagueId,
      sleeperUsername,
      snapshotType,
      ...(contextKey ? { contextKey } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, payloadJson: true, createdAt: true, season: true, contextKey: true },
  })

  if (!row) return null
  return {
    id: row.id,
    createdAt: row.createdAt,
    season: row.season ?? null,
    contextKey: row.contextKey ?? null,
    payload: row.payloadJson,
  }
}
