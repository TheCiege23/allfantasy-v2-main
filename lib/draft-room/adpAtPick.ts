/**
 * ADP at pick time — the market ADP a player carried when they were drafted,
 * read from the league's cached draft pool (`DraftPoolCache`, the same pool the
 * room shows). Stored on `DraftPick.pickMetadata.adpAtPick` so a manager's
 * reach / value history can be measured later without the pool that existed then.
 *
 * DB-first: reads Postgres only, never a provider.
 */

import { prisma } from '@/lib/prisma'
import { buildAdpLookup, type PulsePoolPlayer } from './draftPulse'

type PoolPlayerRef = { playerId?: string | null; playerName: string; position: string }

/** Pool entries out of a `DraftPoolCache.payload`; empty for anything malformed. */
export function poolEntriesFromPayload(payload: unknown): PulsePoolPlayer[] {
  const entries = payload && typeof payload === 'object' ? (payload as { entries?: unknown }).entries : null
  if (!Array.isArray(entries)) return []
  const out: PulsePoolPlayer[] = []
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue
    const r = e as Record<string, unknown>
    const name = typeof r.name === 'string' ? r.name : ''
    const position = typeof r.position === 'string' ? r.position : ''
    if (!name || !position) continue
    out.push({
      name,
      position,
      playerId: typeof r.playerId === 'string' ? r.playerId : null,
      adp: typeof r.adp === 'number' ? r.adp : null,
    })
  }
  return out
}

/** Latest cached pool entries for a league, or [] when none is cached. */
export async function readLeaguePoolEntries(leagueId: string): Promise<PulsePoolPlayer[]> {
  const row = await prisma.draftPoolCache.findFirst({
    where: { leagueId },
    orderBy: { syncedAt: 'desc' },
    select: { payload: true },
  })
  return row ? poolEntriesFromPayload(row.payload) : []
}

/**
 * The player's market ADP in this league's cached pool, or null. Never throws:
 * a missing ADP must not stand between a manager and their pick.
 */
export async function resolveAdpAtPick(leagueId: string, player: PoolPlayerRef): Promise<number | null> {
  try {
    const entries = await readLeaguePoolEntries(leagueId)
    if (entries.length === 0) return null
    return buildAdpLookup(entries)({ ...player, playerId: player.playerId ?? null })
  } catch {
    return null
  }
}
