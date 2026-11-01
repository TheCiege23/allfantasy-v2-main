/**
 * In-memory cache for player stat snapshots (ADP, bye, etc.) to avoid
 * recomputing when the same player appears in multiple draft contexts.
 * Sport-aware; keyed by playerId + sport.
 */

import type { PlayerStatSnapshotModel } from '@/lib/draft-sports-models/types'
import { boundMap } from '@/lib/ttl-memo'

const TTL_MS = 60 * 60 * 1000 // 1 hour
const cache = new Map<string, { data: PlayerStatSnapshotModel; expiresAt: number }>()
const MAX_ENTRIES = 20_000

function key(playerId: string, sport: string): string {
  return `stats:${sport}:${playerId}`
}

export function getStatSnapshot(playerId: string, sport: string): PlayerStatSnapshotModel | null {
  const entry = cache.get(key(playerId, sport))
  if (!entry || entry.expiresAt < Date.now()) return null
  return entry.data
}

export function setStatSnapshot(
  playerId: string,
  sport: string,
  data: PlayerStatSnapshotModel
): void {
  boundMap(cache, (e) => e.expiresAt < Date.now(), MAX_ENTRIES)
  cache.set(key(playerId, sport), { data, expiresAt: Date.now() + TTL_MS })
}

export function clearStatSnapshotCache(): void {
  cache.clear()
}
