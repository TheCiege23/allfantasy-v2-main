import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { providerIdentityColumn } from './resolveProviderRosterPlayers'

export type ProviderIdTranslation = {
  /** The Sleeper id for this player, when the identity map carries one. */
  sleeperId: string | null
  name: string
  position: string | null
  team: string | null
}

/**
 * A non-Sleeper platform's player ids, translated to Sleeper ids through `PlayerIdentityMap`.
 *
 * Surfaces that name, price and grade by Sleeper id (the Trades board, the one-grade engine's
 * FantasyCalc book) can then treat an ESPN or Fantrax trade exactly like a Sleeper one, instead of
 * printing "Player 4432620". `resolveProviderRosterPlayers` answers "who is this" by NAME; this
 * answers "which Sleeper id is this", keeping the name for the identities that carry no Sleeper id.
 *
 * ⚠ THE PLATFORM'S OWN COLUMN, NEVER `externalId` — see `resolveProviderRosterPlayers` for why bare
 * numeric ids are unsafe across namespaces. And an id matching TWO identities stays unresolved:
 * guessing between two people would put the wrong player in somebody's trade.
 */
export async function translateProviderIdsToSleeper(
  platform: string,
  playerIds: readonly string[],
  sport: string,
): Promise<Map<string, ProviderIdTranslation>> {
  const out = new Map<string, ProviderIdTranslation>()
  const column = providerIdentityColumn(platform)
  const ids = [...new Set(playerIds.map((i) => String(i ?? '').trim()).filter(Boolean))]
  if (!column || ids.length === 0) return out

  const rows = await prisma.playerIdentityMap.findMany({
    where: { [column]: { in: ids }, sport: sport.toUpperCase() } as Prisma.PlayerIdentityMapWhereInput,
    select: { canonicalName: true, position: true, currentTeam: true, sleeperId: true, [column]: true },
  })
  const seen = new Map<string, number>()
  for (const r of rows as Array<Record<string, unknown>>) {
    const key = String(r[column] ?? '')
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  for (const r of rows as Array<Record<string, unknown>>) {
    const key = String(r[column] ?? '')
    if (!key || seen.get(key) !== 1) continue
    out.set(key, {
      sleeperId: typeof r.sleeperId === 'string' && r.sleeperId ? r.sleeperId : null,
      name: String(r.canonicalName ?? ''),
      position: (r.position as string | null) ?? null,
      team: (r.currentTeam as string | null) ?? null,
    })
  }
  return out
}
