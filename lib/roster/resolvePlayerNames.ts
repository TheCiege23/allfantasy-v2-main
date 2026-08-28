import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'

function fallbackPlayerLabel(playerId: string): string {
  return `Player ${playerId.slice(0, 8)}`
}

function setNameIfPresent(map: Map<string, string>, playerId: string | null | undefined, name: string | null | undefined): void {
  if (!playerId || !name || map.has(playerId)) return
  const trimmed = name.trim()
  if (!trimmed) return
  map.set(playerId, trimmed)
}

function normalizeSport(sport: LeagueSport | string | null | undefined): string {
  const raw = String(sport ?? 'NFL').trim().toUpperCase()
  return raw || 'NFL'
}

export function normalizePlayerLookupToken(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function resolvePlayerNamesForSport(
  playerIds: string[],
  sport: LeagueSport | string | null | undefined
): Promise<Map<string, string>> {
  const uniquePlayerIds = [...new Set(playerIds.map((id) => id?.trim()).filter((id): id is string => Boolean(id)))]
  const nameMap = new Map<string, string>()
  if (uniquePlayerIds.length === 0) return nameMap

  const normalizedSport = normalizeSport(sport)

  if (normalizedSport === 'NFL') {
    try {
      // Phase 3: canonical read path. Was a live `getAllPlayers()` fetch of Sleeper's entire
      // NFL universe to look up a handful of ids; now a fixed 3 queries against `Player` +
      // `PlayerProviderIdentity`, keyed by the same Sleeper ids the caller already holds.
      // Ids with no canonical player are simply absent, so the DB fallbacks below still run.
      const { getCanonicalPlayersBySleeperIds } = await import('@/lib/canonical/getCanonicalPlayer')
      const canonical = await getCanonicalPlayersBySleeperIds(uniquePlayerIds)
      for (const playerId of uniquePlayerIds) {
        setNameIfPresent(nameMap, playerId, canonical.get(playerId)?.name)
      }
    } catch {
      // Fall through to local database lookups.
    }
  }

  try {
    const identityRows = await prisma.playerIdentityMap.findMany({
      where: {
        sport: normalizedSport,
        OR: [
          { sleeperId: { in: uniquePlayerIds } },
          { espnId: { in: uniquePlayerIds } },
          { mflId: { in: uniquePlayerIds } },
          { fleaflickerId: { in: uniquePlayerIds } },
          { apiSportsId: { in: uniquePlayerIds } },
          { clearSportsId: { in: uniquePlayerIds } },
          { fantasyCalcId: { in: uniquePlayerIds } },
          { rollingInsightsId: { in: uniquePlayerIds } },
        ],
      },
      select: {
        canonicalName: true,
        sleeperId: true,
        espnId: true,
        mflId: true,
        fleaflickerId: true,
        apiSportsId: true,
        clearSportsId: true,
        fantasyCalcId: true,
        rollingInsightsId: true,
      },
    })

    for (const row of identityRows) {
      setNameIfPresent(nameMap, row.sleeperId, row.canonicalName)
      setNameIfPresent(nameMap, row.espnId, row.canonicalName)
      setNameIfPresent(nameMap, row.mflId, row.canonicalName)
      setNameIfPresent(nameMap, row.fleaflickerId, row.canonicalName)
      setNameIfPresent(nameMap, row.apiSportsId, row.canonicalName)
      setNameIfPresent(nameMap, row.clearSportsId, row.canonicalName)
      setNameIfPresent(nameMap, row.fantasyCalcId, row.canonicalName)
      setNameIfPresent(nameMap, row.rollingInsightsId, row.canonicalName)
    }
  } catch {
    // Optional mapping layer; ignore lookup failures.
  }

  /*
   * ⚠ TWO QUERIES, AUTHORITATIVE FIRST, BECAUSE THESE TOKENS ARE NOT ALL IN ONE ID SPACE.
   *
   * This was one query — `OR: [{ externalId: { in } }, { sleeperId: { in } }]` — binding the
   * name to both columns of every row it found. `SportsPlayer.externalId` is 83% bare numerics
   * written by Rolling Insights, CFBD and api_football, and 42,032 of those collide with a
   * Sleeper id where 42,031 are a DIFFERENT PERSON. So a Sleeper token could match a Rolling
   * Insights row and bind a stranger's name, and `setNameIfPresent` keeps the FIRST name it is
   * given — so which name a player got depended on row order.
   *
   * The caller genuinely mixes spaces here (the identity-map hop above resolves FantasyCalc and
   * Rolling Insights ids too), so the fix is not to pick one. It is to ask in order of
   * authority: `sleeperId` is a real Sleeper id by definition and can never be a coincidence,
   * so it is claimed first. Only tokens still unnamed are tried against `externalId`, where a
   * bare numeric is a legitimate provider id rather than a collision.
   */
  try {
    const bySleeperId = await prisma.sportsPlayer.findMany({
      where: { sport: normalizedSport, sleeperId: { in: uniquePlayerIds } },
      select: { sleeperId: true, name: true },
    })
    for (const player of bySleeperId) setNameIfPresent(nameMap, player.sleeperId, player.name)

    const stillUnnamed = uniquePlayerIds.filter((id) => !nameMap.has(id))
    if (stillUnnamed.length > 0) {
      const byExternalId = await prisma.sportsPlayer.findMany({
        where: { sport: normalizedSport, externalId: { in: stillUnnamed } },
        select: { externalId: true, name: true },
      })
      for (const player of byExternalId) setNameIfPresent(nameMap, player.externalId, player.name)
    }
  } catch {
    // Optional lookup; ignore failures.
  }

  for (const playerId of uniquePlayerIds) {
    if (!nameMap.has(playerId)) {
      nameMap.set(playerId, fallbackPlayerLabel(playerId))
    }
  }

  return nameMap
}
