/**
 * Which `player_game_stats.playerId` belongs to which ROSTER player, for the daily sports.
 *
 * 🛑 THE TWO ARE DIFFERENT ID SPACES, AND NOTHING TRANSLATED BETWEEN THEM. Measured on production
 * 2026-09-24 (read-only):
 *
 *   - A native roster stores whatever id the draft pool handed out: `external_source_id`, which is
 *     `SportsPlayer.sleeperId ?? externalId` (getResolvedDraftPoolForLeague.ts). For NHL, NBA and
 *     NCAAB no `SportsPlayer` row has a `sleeperId`, so that id is the Rolling Insights id ("16158").
 *   - `player_game_stats` rows for those sports are keyed on `PlayerIdentityMap.id` — the RI ingest
 *     resolves the provider id through `rollingInsightsId` and refuses to write provider-keyed rows.
 *
 *   sport   pool ids that find game logs directly   the same players via PlayerIdentityMap
 *   NCAAB   0                                        4,898  (every player with logs)
 *   NHL     0                                          693  (every player with logs)
 *
 * So every drafted NHL player — a sport already switched on for fantasy seasons (#1195), opening
 * 2026-09-29 — would have scored ZERO, with no error anywhere: an empty stat window reads exactly
 * like a player who did not play.
 *
 * THE RULE: every roster id maps to itself (a roster that already holds identity ids keeps
 * working), and a NUMERIC roster id is also mapped through `PlayerIdentityMap.rollingInsightsId`
 * WITHIN THE SPORT (unique per sport since 2026-09-22).
 *
 * ⚠ THE NUMERIC ID SPACES COLLIDE IN THIS REPO (Sleeper 5850 and RI 5850 are different NFL
 * players — memory draft-pool-id-spaces-collide). Today no daily-sport `SportsPlayer` carries a
 * `sleeperId`, so a numeric pool id in these sports IS an RI id. Should that change, an id that is
 * ALSO some player's `sleeperId` in the sport is ambiguous: it is NOT bridged, and is reported, so a
 * roster slot is never scored from another man's games.
 *
 * 🛑 A `tsdb_…` ROSTER ID IS BRIDGED BY NAME, AND ONLY WHEN THE NAME IS ONE MAN (2026-10-25). Leagues
 * drafted before the pool stopped handing out TheSportsDB ids (`isScorablePoolId`) still hold them, and
 * nothing mapped them: in the one live NHL redraft season 21 of 72 roster players were `tsdb_…`, and
 * Adam Fox, Adam Fantilli, Aaron Ekblad, Adin Hill and four other STARTERS scored 0 every week with
 * 7-13 games each in `player_game_stats`. PlayerIdentityMap has no TheSportsDB column, so the roster
 * row's own name is the only link. The rule is the one `collapseSamePersonRows` already uses: exactly
 * one identity carries that normalized name in the sport, else nothing. And an identity another roster
 * id of this league already reaches is REFUSED, not shared — the old pool listed one man under both ids,
 * and that league drafted Aatu Raty twice (`3020` on one team, `tsdb_34184761` on another). Crediting
 * both would score one man's games for two teams.
 */
import { normalizePlayerName } from '@/lib/team-abbrev'

type IdentityRow = {
  id: string
  rollingInsightsId: string | null
  sleeperId: string | null
  normalizedName?: string | null
}

export type IdentityDb = {
  playerIdentityMap: {
    findMany(args: {
      where: Record<string, unknown>
      select: { id: true; rollingInsightsId: true; sleeperId: true; normalizedName?: true }
    }): Promise<IdentityRow[]>
  }
}

export type GameLogIdBridge = {
  /** Every id to query `player_game_stats` with. */
  gameLogIds: string[]
  /** A game-log row's playerId -> the roster playerId it belongs to. */
  rosterIdFor: (gameLogId: string) => string | undefined
  /** Numeric roster ids that are ALSO a sleeperId in the sport — refused, never guessed. */
  ambiguous: string[]
  /** How many roster ids were translated through the identity map. */
  bridged: number
  /** How many of those were `tsdb_…` ids matched by name (already counted in `bridged`). */
  bridgedByName: number
  /** `tsdb_…` ids whose name is another roster id's identity, or more than one man — refused. */
  nameRefused: string[]
}

const NUMERIC = /^\d+$/
const TSDB = /^tsdb_/

/** The form `PlayerIdentityMap.normalizedName` holds: accents folded first ("Räty" -> "raty"). */
export function identityNameKey(name: string | null | undefined): string {
  return normalizePlayerName(String(name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
}

export async function bridgeRosterIdsToGameLogIds(
  db: IdentityDb,
  sportKeys: string[],
  rosterIds: string[],
  /** Roster id -> the roster row's player name. Only `tsdb_…` ids read it. */
  namesById?: ReadonlyMap<string, string | null | undefined>,
): Promise<GameLogIdBridge> {
  const toRoster = new Map<string, string>(rosterIds.map((id) => [id, id]))
  const numeric = rosterIds.filter((id) => NUMERIC.test(id))
  const ambiguous: string[] = []
  let bridged = 0

  if (numeric.length > 0) {
    const [byRi, bySleeper] = await Promise.all([
      db.playerIdentityMap.findMany({
        where: { sport: { in: sportKeys }, rollingInsightsId: { in: numeric } },
        select: { id: true, rollingInsightsId: true, sleeperId: true },
      }),
      db.playerIdentityMap.findMany({
        where: { sport: { in: sportKeys }, sleeperId: { in: numeric } },
        select: { id: true, rollingInsightsId: true, sleeperId: true },
      }),
    ])
    const sleeperIds = new Set(bySleeper.map((r) => r.sleeperId).filter((v): v is string => Boolean(v)))
    for (const row of byRi) {
      const rosterId = row.rollingInsightsId
      if (!rosterId) continue
      // Also a Sleeper id for SOMEONE in this sport — unless it is this same person's own.
      const clash = sleeperIds.has(rosterId) && bySleeper.some((s) => s.sleeperId === rosterId && s.id !== row.id)
      if (clash) {
        ambiguous.push(rosterId)
        continue
      }
      if (!toRoster.has(row.id)) {
        toRoster.set(row.id, rosterId)
        bridged += 1
      }
    }
  }

  // After the numeric pass, so an identity a Rolling Insights id already reaches is seen as claimed.
  let bridgedByName = 0
  const nameRefused: string[] = []
  const byName = new Map<string, string[]>()
  for (const id of rosterIds) {
    if (!TSDB.test(id)) continue
    const key = identityNameKey(namesById?.get(id))
    if (key) byName.set(key, [...(byName.get(key) ?? []), id])
  }
  if (byName.size > 0) {
    const rows = await db.playerIdentityMap.findMany({
      where: { sport: { in: sportKeys }, normalizedName: { in: [...byName.keys()] } },
      select: { id: true, rollingInsightsId: true, sleeperId: true, normalizedName: true },
    })
    const people = new Map<string, Set<string>>()
    for (const row of rows) {
      const key = String(row.normalizedName ?? '')
      people.set(key, (people.get(key) ?? new Set()).add(row.id))
    }
    for (const [key, ids] of byName) {
      const identities = [...(people.get(key) ?? [])]
      if (identities.length === 0) continue
      if (identities.length > 1 || ids.length > 1 || toRoster.has(identities[0])) {
        nameRefused.push(...ids)
        continue
      }
      toRoster.set(identities[0], ids[0])
      bridged += 1
      bridgedByName += 1
    }
  }

  return {
    gameLogIds: [...toRoster.keys()],
    rosterIdFor: (gameLogId) => toRoster.get(gameLogId),
    ambiguous: [...new Set(ambiguous)],
    bridged,
    bridgedByName,
    nameRefused,
  }
}
