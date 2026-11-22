import 'server-only'

import { prisma } from '@/lib/prisma'
import type { FantraxAdpEntry } from '@/lib/league-import/fantrax/fantraxApi'
import { loadNhlFantraxProspects } from '@/lib/player-identity/nhlFantraxProspects'
import { loadMlbFantraxProspects } from '@/lib/player-identity/mlbFantraxProspects'

type Sport = 'NHL' | 'MLB'
type Prospect = { fantraxId: string; playerId: string; name: string }
type Ranked = { playerId: string; name: string; adp: number; rank: number }
const cacheKey = (sport: Sport) => 'fantrax:prospect-adp:' + sport.toLowerCase()
const MIN_BOARD = 5

/** Ordinal among the verified prospect pool, never a position in Fantrax's mixed pro/rookie draft. */
export function rankFantraxProspectAdp(entries: readonly FantraxAdpEntry[], pool: readonly Prospect[]): Ranked[] {
  const verified = new Map(pool.map((p) => [p.fantraxId, p]))
  const counts = new Map<string, number>()
  for (const p of entries) counts.set(p.fantraxId, (counts.get(p.fantraxId) ?? 0) + 1)
  const matched = entries.flatMap((p) => {
    const prospect = verified.get(p.fantraxId)
    return prospect && counts.get(p.fantraxId) === 1 && Number.isFinite(p.adp) && p.adp > 0
      ? [{ playerId: prospect.playerId, name: prospect.name, adp: p.adp }] : []
  }).sort((a, b) => a.adp - b.adp || a.playerId.localeCompare(b.playerId))
  let rank = 0
  return matched.map((p, i) => {
    if (p.adp !== matched[i - 1]?.adp) rank = i + 1
    return { ...p, rank }
  })
}

/** Called only by the existing ADP ingest, using its already parsed payload. */
export async function storeFantraxProspectAdp(sport: Sport, entries: readonly FantraxAdpEntry[], now = new Date()) {
  const load = sport === 'NHL' ? loadNhlFantraxProspects : loadMlbFantraxProspects
  const { prospects } = await load(prisma, { now })
  const players = rankFantraxProspectAdp(entries, prospects)
  if (players.length < MIN_BOARD) return 0
  const key = cacheKey(sport)
  const expiresAt = new Date(now.getTime() + 14 * 86_400_000)
  const data = { source: 'fantrax-prospect-adp', observedAt: now.toISOString(), players }
  await prisma.sportsDataCache.upsert({ where: { cacheKey: key }, create: { cacheKey: key, expiresAt, data }, update: { expiresAt, data } })
  return players.length
}

/** Active prospect ranks only. An ID linked to a pro since capture is no longer a prospect fallback. */
export async function readFantraxProspectAdp(sport: Sport, now: Date): Promise<ReadonlyMap<string, Ranked>> {
  try {
    const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: cacheKey(sport) }, select: { data: true, expiresAt: true } })
    if (!row || row.expiresAt <= now) return new Map()
    const data = row.data as { source?: unknown; players?: unknown } | null
    if (data?.source !== 'fantrax-prospect-adp' || !Array.isArray(data.players)) return new Map()
    const players = data.players.filter((p): p is Ranked => !!p && typeof p === 'object' &&
      typeof p.playerId === 'string' && p.playerId.startsWith('fantrax:') && p.playerId.length > 8 &&
      typeof p.name === 'string' && p.name.length > 0 && Number.isInteger(p.rank) && p.rank > 0 &&
      typeof p.adp === 'number' && Number.isFinite(p.adp) && p.adp > 0)
    if (players.length < MIN_BOARD) return new Map()
    const promoted = await prisma.playerIdentityMap.findMany({
      where: { sport, fantraxId: { in: players.map((p) => p.playerId.slice(8)) } }, select: { fantraxId: true },
    })
    const known = new Set(promoted.map((p) => 'fantrax:' + p.fantraxId))
    return new Map(players.filter((p) => !known.has(p.playerId)).map((p) => [p.playerId, p]))
  } catch {
    return new Map()
  }
}
