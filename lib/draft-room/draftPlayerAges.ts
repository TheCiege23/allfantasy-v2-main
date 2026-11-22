import 'server-only'

import { prisma } from '@/lib/prisma'
import { coercePlayerAge } from '@/lib/sports-data/playerAge'
import { ourIdOrSleeperIdWhere, playerRowKeys } from '@/lib/player-identity/externalIdNamespace'

/**
 * Ages for draft-room player ids, for draft as me's youth lean (./draftAsMe.ts). A draft pick's or a
 * pool entry's `playerId` is a Sleeper id or our own `SportsPlayer.id` — the two spellings a native
 * league's player ids come in — so it is looked up through `ourIdOrSleeperIdWhere` and keyed by
 * `playerRowKeys`, never by `externalId`: a bare Sleeper id against `externalId` names a Rolling
 * Insights row for a different person (lib/player-identity/externalIdNamespace.ts).
 * Rows more than a year apart give no age: an unknown age is honest, a wrong one tilts a pick.
 * Best-effort: a failed read returns an empty map and draft as me runs without the lean.
 */
export async function loadDraftPlayerAges(sport: string | null | undefined, playerIds: readonly (string | null | undefined)[]): Promise<Map<string, number>> {
  const ids = [...new Set(playerIds.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim()))]
  const out = new Map<string, number>()
  if (ids.length === 0) return out
  const rows = await prisma.sportsPlayer
    .findMany({
      where: { ...ourIdOrSleeperIdWhere(ids, sport ?? 'NFL'), age: { not: null } },
      select: { id: true, sleeperId: true, age: true },
    })
    .catch(() => [] as Array<{ id: string; sleeperId: string | null; age: number | null }>)
  const seen = new Map<string, number[]>()
  const wanted = new Set(ids)
  for (const r of rows) {
    const age = coercePlayerAge(r.age)
    if (age == null) continue
    for (const key of playerRowKeys(r)) {
      if (!wanted.has(key)) continue
      seen.set(key, [...(seen.get(key) ?? []), age])
    }
  }
  for (const [id, ages] of seen) {
    if (Math.max(...ages) - Math.min(...ages) > 1) continue
    out.set(id, Math.min(...ages))
  }
  return out
}

/** Mean age per draft over the picks with an age on file; drafts with fewer than `min` aged picks are left out. */
export function draftMeanAges(picks: ReadonlyArray<{ sessionId: string; playerId: string | null }>, ages: ReadonlyMap<string, number>, min = 10): Map<string, number> {
  const acc = new Map<string, { sum: number; n: number }>()
  for (const p of picks) {
    const age = p.playerId ? ages.get(p.playerId) : undefined
    if (age == null) continue
    const a = acc.get(p.sessionId) ?? { sum: 0, n: 0 }
    a.sum += age
    a.n += 1
    acc.set(p.sessionId, a)
  }
  const out = new Map<string, number>()
  for (const [id, { sum, n }] of acc) if (n >= min) out.set(id, sum / n)
  return out
}
