import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ImportProvider } from '@/lib/league-import/types'
import { getProviderCapability } from '@/lib/shared-services/player-identity/ProviderAdapters'

/**
 * Resolve a non-Sleeper platform's roster player ids to names, positions and teams, through the
 * platform's own column on `PlayerIdentityMap`.
 *
 * 🛑 THIS EXISTS BECAUSE THE MATERIALIZER ONLY EVER KNEW SLEEPER. `materializeRedraftRosterPlayers`
 * ran its lookup for `platform === 'sleeper'` alone, so every ESPN, Fantrax and Fleaflicker roster
 * was written with the platform id as the player's NAME and `position: 'UNK'`. Values are looked
 * up by name downstream, so those rosters went from empty to full of rows nothing can price.
 * Measured on production 2026-09-13: 1,873 such rows; of those, ESPN NFL resolves 878 of 1,176 by
 * `espnId` and Fantrax NCAAF 118 of 465 by `fantraxId`.
 *
 * ⚠ THE COLUMN COMES FROM THE PROVIDER CAPABILITY MAP, NOT FROM A SECOND COPY OF IT.
 * `ProviderAdapters` already says which `PlayerIdentityMap` column carries each provider's id;
 * repeating that here would be the one-rule-two-implementations shape `resolveSleeperRosterPlayers`
 * was written to delete. Sleeper is excluded on purpose: it has its own resolver, which also reads
 * `SportsPlayer` and ranks sources.
 *
 * ⚠ NEVER `externalId`. Bare numeric provider ids collide across namespaces and sports (see
 * `./externalIdNamespace`). The dedicated column plus the sport is the only safe key.
 *
 * ⚠ AN ID THAT MATCHES TWO IDENTITIES IS LEFT UNRESOLVED. Measured: zero such `espnId` or
 * `fantraxId` groups today, so this is a guard rather than a workaround — but guessing between two
 * people writes the wrong player onto somebody's roster, and an unresolved id only leaves the name
 * as it was.
 */
export type ResolvedProviderPlayer = {
  name: string
  position: string | null
  team: string | null
  sport: string
}

const IDENTITY_COLUMNS = ['espnId', 'fantraxId', 'fleaflickerId', 'mflId'] as const
type IdentityColumn = (typeof IDENTITY_COLUMNS)[number]

/** The `PlayerIdentityMap` column holding this platform's player ids, or null when there is none. */
export function providerIdentityColumn(platform: string): IdentityColumn | null {
  const provider = platform.trim().toLowerCase()
  if (!provider || provider === 'sleeper') return null
  const column = getProviderCapability(provider as ImportProvider).directIdSources.find(
    (s) => s.table === 'PlayerIdentityMap',
  )?.column
  return (IDENTITY_COLUMNS as readonly string[]).includes(column ?? '') ? (column as IdentityColumn) : null
}

/**
 * One query for a whole league's ids. Returns a map keyed by the platform's player id; ids that
 * resolve to nothing, or to more than one identity, are simply absent.
 */
export async function resolveProviderRosterPlayers(
  platform: string,
  playerIds: readonly string[],
  sport: string,
): Promise<Map<string, ResolvedProviderPlayer>> {
  const out = new Map<string, ResolvedProviderPlayer>()
  const column = providerIdentityColumn(platform)
  const ids = [...new Set(playerIds.map((i) => String(i ?? '').trim()).filter(Boolean))]
  if (!column || ids.length === 0) return out

  const rows = await prisma.playerIdentityMap.findMany({
    where: { [column]: { in: ids }, sport } as Prisma.PlayerIdentityMapWhereInput,
    select: {
      canonicalName: true,
      position: true,
      currentTeam: true,
      sport: true,
      espnId: true,
      fantraxId: true,
      fleaflickerId: true,
      mflId: true,
    },
  })

  const matches = new Map<string, number>()
  for (const row of rows) {
    const key = row[column]
    if (!key) continue
    matches.set(key, (matches.get(key) ?? 0) + 1)
    out.set(key, {
      name: row.canonicalName,
      position: row.position,
      team: row.currentTeam,
      sport: row.sport,
    })
  }
  for (const [key, count] of matches) if (count > 1) out.delete(key)
  return out
}
