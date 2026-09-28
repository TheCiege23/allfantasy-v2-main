/**
 * Which CFBD athlete id a drafted NCAAF roster player's game logs are stored under.
 *
 * `player_game_stats` NCAAF rows are keyed on the raw CFBD athlete id ("4432577") — the scheduled
 * CFBD ingest writes them that way. A drafted player carries the pool's id, `SportsPlayer.sleeperId ??
 * externalId`, and no NCAAF pool row has a `sleeperId`, so that id is one of:
 *
 *   - a CFBD id — the pool row came from CFBD (`source: 'cfbd'`, `scripts/refresh-ncaaf-pool-cfbd.ts`),
 *     whose `externalId` is the CFBD roster id, the same athlete id `/games/players` reports;
 *   - a Rolling Insights id — every other pool row; reached through `PlayerIdentityMap`, whose
 *     `cfbdId` the scheduled `backfillCfbdIdsForNcaaf` writes (one-to-one or not at all);
 *   - a `PlayerIdentityMap.id`, or a synthetic `name:` id — the latter never has game logs.
 *
 * 🛑 NEVER MATCH A BARE NUMBER TO ITSELF. The daily-sport bridge maps every roster id to itself,
 * which is safe there because those game logs are keyed on identity uuids. Here BOTH id spaces are
 * plain integers: an RI roster id "5158948" and a CFBD athlete "5158948" are, in general, different
 * men, and a self-match would score one from the other's game with nothing to show it happened. So a
 * roster id reaches a CFBD id only through a row that SAYS they are the same player.
 *
 * ⚠ AMBIGUITY IS REFUSED IN BOTH DIRECTIONS — the rule `cfbdIdentityBridge.ts` already applies. A
 * roster id with two different CFBD candidates is not scored; neither is a CFBD id that two roster
 * players both resolve to. Both are reported so the gap is visible.
 */

export const NCAAF_SPORT_KEYS = ['NCAAF', 'NCAAFB', 'ncaaf', 'ncaafb']

export type NcaafBridgeDb = {
  sportsPlayer: {
    findMany(args: {
      where: Record<string, unknown>
      select: { externalId: true }
    }): Promise<Array<{ externalId: string }>>
  }
  playerIdentityMap: {
    findMany(args: {
      where: Record<string, unknown>
      select: { id: true; rollingInsightsId: true; cfbdId: true }
    }): Promise<Array<{ id: string; rollingInsightsId: string | null; cfbdId: string | null }>>
  }
}

export type NcaafGameLogIdBridge = {
  /** CFBD athlete ids to query `player_game_stats` with. */
  cfbdIds: string[]
  /** A game-log row's playerId (a CFBD id) -> the roster playerId it belongs to. */
  rosterIdFor: (cfbdId: string) => string | undefined
  /** Roster ids with conflicting candidates, or sharing a CFBD id with another roster player. */
  ambiguous: string[]
  /** Roster ids with no provenance link to any CFBD id — they cannot be scored. */
  unresolved: string[]
  /** How many roster ids resolved through the identity map rather than being CFBD ids themselves. */
  viaIdentity: number
}

const NUMERIC = /^\d+$/

export async function bridgeNcaafRosterIdsToCfbdIds(db: NcaafBridgeDb, rosterIds: string[]): Promise<NcaafGameLogIdBridge> {
  const ids = [...new Set(rosterIds.filter(Boolean))]
  const numeric = ids.filter((id) => NUMERIC.test(id))

  const [cfbdPool, byRi, byIdentityId] = await Promise.all([
    numeric.length
      ? db.sportsPlayer.findMany({
          where: { sport: { in: NCAAF_SPORT_KEYS }, source: 'cfbd', externalId: { in: numeric } },
          select: { externalId: true },
        })
      : Promise.resolve([]),
    numeric.length
      ? db.playerIdentityMap.findMany({
          where: { sport: { in: NCAAF_SPORT_KEYS }, rollingInsightsId: { in: numeric }, cfbdId: { not: null } },
          select: { id: true, rollingInsightsId: true, cfbdId: true },
        })
      : Promise.resolve([]),
    db.playerIdentityMap.findMany({
      where: { sport: { in: NCAAF_SPORT_KEYS }, id: { in: ids }, cfbdId: { not: null } },
      select: { id: true, rollingInsightsId: true, cfbdId: true },
    }),
  ])

  const candidates = new Map<string, Set<string>>()
  const viaIdentityIds = new Set<string>()
  const add = (rosterId: string, cfbdId: string | null, viaIdentity: boolean) => {
    if (!cfbdId) return
    const set = candidates.get(rosterId) ?? new Set<string>()
    set.add(cfbdId)
    candidates.set(rosterId, set)
    if (viaIdentity) viaIdentityIds.add(rosterId)
  }
  for (const row of cfbdPool) add(row.externalId, row.externalId, false)
  for (const row of byRi) if (row.rollingInsightsId) add(row.rollingInsightsId, row.cfbdId, true)
  for (const row of byIdentityId) add(row.id, row.cfbdId, true)

  const ambiguous = new Set<string>()
  const unresolved: string[] = []
  const claimants = new Map<string, string[]>()
  for (const rosterId of ids) {
    const set = candidates.get(rosterId)
    if (!set || set.size === 0) {
      unresolved.push(rosterId)
      continue
    }
    if (set.size > 1) {
      ambiguous.add(rosterId)
      continue
    }
    const cfbdId = [...set][0]!
    claimants.set(cfbdId, [...(claimants.get(cfbdId) ?? []), rosterId])
  }

  const toRoster = new Map<string, string>()
  for (const [cfbdId, rosters] of claimants) {
    if (rosters.length > 1) {
      for (const r of rosters) ambiguous.add(r)
      continue
    }
    toRoster.set(cfbdId, rosters[0]!)
  }

  return {
    cfbdIds: [...toRoster.keys()],
    rosterIdFor: (cfbdId) => toRoster.get(cfbdId),
    ambiguous: [...ambiguous].sort(),
    unresolved,
    viaIdentity: [...toRoster.values()].filter((r) => viaIdentityIds.has(r)).length,
  }
}
