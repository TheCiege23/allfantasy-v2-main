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
 */

type IdentityRow = { id: string; rollingInsightsId: string | null; sleeperId: string | null }

export type IdentityDb = {
  playerIdentityMap: {
    findMany(args: {
      where: Record<string, unknown>
      select: { id: true; rollingInsightsId: true; sleeperId: true }
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
}

const NUMERIC = /^\d+$/

export async function bridgeRosterIdsToGameLogIds(
  db: IdentityDb,
  sportKeys: string[],
  rosterIds: string[],
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

  return {
    gameLogIds: [...toRoster.keys()],
    rosterIdFor: (gameLogId) => toRoster.get(gameLogId),
    ambiguous: [...new Set(ambiguous)],
    bridged,
  }
}
