// lib/trade-engine/snapshot-store.ts
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

export type SnapshotType = 'league_analyze' | 'rankings_analyze' | 'otb_packages'
const LEGACY_SNAPSHOT_TYPES: SnapshotType[] = ['league_analyze', 'rankings_analyze', 'otb_packages']

export async function writeSnapshot(params: {
  leagueId: string
  sleeperUsername: string
  snapshotType: SnapshotType
  payload: Record<string, any>
  contextKey?: string
  season?: number
  ttlHours?: number
}): Promise<void> {
  const { leagueId, sleeperUsername, snapshotType, payload, contextKey, season, ttlHours } = params
  if (!LEGACY_SNAPSHOT_TYPES.includes(snapshotType)) return
  const expiresAt = ttlHours ? new Date(Date.now() + ttlHours * 60 * 60 * 1000) : null

  try {
    await prisma.tradeAnalysisSnapshot.create({
      data: {
        leagueId,
        sleeperUsername: sleeperUsername.toLowerCase(),
        snapshotType,
        contextKey: contextKey ?? null,
        payloadJson: payload,
        season: season ?? null,
        expiresAt,
      },
    })
  } catch (e) {
    console.error('[SnapshotStore] Failed to write snapshot:', e)
  }
}

export async function readLatestSnapshot(params: {
  leagueId: string
  sleeperUsername: string
  snapshotType: SnapshotType
  contextKey?: string
}): Promise<Record<string, any> | null> {
  const { leagueId, sleeperUsername, snapshotType, contextKey } = params
  if (!LEGACY_SNAPSHOT_TYPES.includes(snapshotType)) return null
  try {
    const snapshot = await prisma.tradeAnalysisSnapshot.findFirst({
      where: {
        leagueId,
        sleeperUsername: sleeperUsername.toLowerCase(),
        snapshotType,
        ...(contextKey ? { contextKey } : {}),
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
    })
    return (snapshot?.payloadJson as Record<string, any>) ?? null
  } catch (e) {
    console.error('[SnapshotStore] Failed to read snapshot:', e)
    return null
  }
}

export type SnapshotRecord = {
  leagueId: string
  sleeperUsername: string
  snapshotType: string
  payload: Record<string, any>
  createdAt: Date
  season: number | null
  contextKey: string | null
}

/**
 * Same lookup as readLatestSnapshot(), but returns metadata + payload.
 * This is ideal for UI consumers (Rankings/Overview/Career) that want timestamps + season.
 */
export async function readLatestSnapshotRecord(params: {
  leagueId: string
  sleeperUsername: string
  snapshotType: SnapshotType
  contextKey?: string
}): Promise<SnapshotRecord | null> {
  const { leagueId, sleeperUsername, snapshotType, contextKey } = params
  if (!LEGACY_SNAPSHOT_TYPES.includes(snapshotType)) return null
  try {
    const s = await prisma.tradeAnalysisSnapshot.findFirst({
      where: {
        leagueId,
        sleeperUsername: sleeperUsername.toLowerCase(),
        snapshotType,
        ...(contextKey ? { contextKey } : {}),
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!s) return null

    return {
      leagueId: s.leagueId,
      sleeperUsername: s.sleeperUsername,
      snapshotType: s.snapshotType,
      payload: s.payloadJson as Record<string, any>,
      createdAt: s.createdAt,
      season: s.season,
      contextKey: s.contextKey,
    }
  } catch (e) {
    console.error('[SnapshotStore] Failed to read snapshot record:', e)
    return null
  }
}

export async function readSnapshotsForUser(params: {
  sleeperUsername: string
  snapshotType?: SnapshotType
  leagueId?: string
  limit?: number
}): Promise<SnapshotRecord[]> {
  const { sleeperUsername, snapshotType, leagueId, limit = 10 } = params
  if (snapshotType && !LEGACY_SNAPSHOT_TYPES.includes(snapshotType)) return []
  try {
    const snapshots = await prisma.tradeAnalysisSnapshot.findMany({
      where: {
        sleeperUsername: sleeperUsername.toLowerCase(),
        // Account-owned trade receipts are read only through their authenticated
        // store, never through this legacy username-based listing.
        snapshotType: snapshotType ?? { in: LEGACY_SNAPSHOT_TYPES },
        ...(leagueId ? { leagueId } : {}),
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return snapshots.map((s) => ({
      leagueId: s.leagueId,
      sleeperUsername: s.sleeperUsername,
      snapshotType: s.snapshotType,
      payload: s.payloadJson as Record<string, any>,
      createdAt: s.createdAt,
      season: s.season,
      contextKey: s.contextKey,
    }))
  } catch (e) {
    console.error('[SnapshotStore] Failed to read user snapshots:', e)
    return []
  }
}

export async function cleanupExpiredSnapshots(): Promise<number> {
  try {
    const result = await prisma.tradeAnalysisSnapshot.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    })
    return result.count
  } catch (e) {
    console.error('[SnapshotStore] Failed to cleanup expired snapshots:', e)
    return 0
  }
}
