import type { PrismaClient } from '@prisma/client'

/**
 * Per-player weekly FANTASY points for NATIVE (AllFantasy-hosted) leagues, as our own scoring engine
 * scored them, written into the same `league_player_weekly_scores` table the Sleeper/Fantrax imports
 * use. Storyline Studio's player hooks (revenge game, one-man army) read it; before this the engine
 * computed every player's points on each rescore and threw them away (`lineupSnapshots` keeps team
 * totals only).
 *
 * THE KEYS, AND WHY EACH IS WHAT IT IS:
 *
 * - `source` = 'allfantasy'. Every existing reader means "the platform's own points" and keys its
 *   reads on a PLATFORM league id; this source string is how a human (or a later reader) tells our
 *   numbers apart from a provider's.
 *
 * - `leagueId` = OUR `League.id` (a uuid), NOT `League.platformLeagueId`. A native league has no
 *   platform league: its platformLeagueId is a synthetic `manual-<ms>` / `tournament-…` string that
 *   nothing else joins on and that is not guaranteed unique. Using the uuid also keeps native rows out
 *   of every existing reader by construction — they all query `leagueId: league.platformLeagueId`
 *   (Sleeper/Fantrax ids), and no platform id is ever a League uuid. The unique key
 *   (leagueId, seasonYear, week, playerId) therefore cannot collide with an import's row.
 *
 * - `rosterId` = `nativeRosterSeat(RedraftRoster.id)`. The column is `Int?` and a native team has no
 *   integer id anywhere (`RedraftRoster.id` is a cuid, `Roster.id` a uuid, no slot number exists).
 *   So it is a deterministic 31-bit hash of the redraft roster id: stable forever, needs no lookup
 *   table, and a reader maps it back by hashing that season's rosters. Two rosters of one season
 *   hashing to the same seat is ~1 in 4 million for a 32-team league; a reader that sees it drops both
 *   (`nativeSeatMap`) rather than guessing whose week it was.
 *
 * - `isFinalized` mirrors the matchup's own `final` decision in `updateMatchupScores`, which is driven
 *   by the week finalizer's seal on `PlayerWeeklyScore` (past the stat-correction grace window). It is
 *   never set from the game clock here.
 *
 * - `points` are the points the engine COUNTED for that player that week (games-count / games-limits
 *   rules applied); bench rows carry what he scored on the bench. Reserve slots (IR/taxi/devy) are not
 *   written: those players count for neither side of the lineup.
 */

export const NATIVE_PLAYER_SCORE_SOURCE = 'allfantasy'

export type NativePlayerPoints = { playerId: string; points: number; isStarter: boolean }

/** FNV-1a over the roster id, folded to a positive 31-bit integer (Postgres `integer`). */
export function nativeRosterSeat(redraftRosterId: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < redraftRosterId.length; i++) {
    h ^= redraftRosterId.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) & 0x7fffffff
}

/** seat → redraft roster id for one season's rosters, with any colliding seat removed. */
export function nativeSeatMap(redraftRosterIds: readonly string[]): Map<number, string> {
  const out = new Map<number, string>()
  const collided = new Set<number>()
  for (const id of redraftRosterIds) {
    const seat = nativeRosterSeat(id)
    if (out.has(seat) && out.get(seat) !== id) collided.add(seat)
    else out.set(seat, id)
  }
  for (const seat of collided) out.delete(seat)
  return out
}

/** One row per player: a duplicate keeps the starter row (it is the one that counted). */
function dedupe(players: readonly NativePlayerPoints[]): NativePlayerPoints[] {
  const by = new Map<string, NativePlayerPoints>()
  for (const p of players) {
    if (!p.playerId) continue
    const cur = by.get(p.playerId)
    if (!cur || (p.isStarter && !cur.isStarter)) by.set(p.playerId, p)
  }
  return [...by.values()]
}

type Db = Pick<PrismaClient, 'leaguePlayerWeeklyScore' | '$transaction'>

/**
 * Replace one native roster-week's player rows with `players`. Idempotent: re-scoring a week upserts on
 * the table's unique key (so it overwrites, never duplicates) and deletes this roster-week's rows for
 * players the new scoring no longer lists (a dropped or re-slotted player). One transaction.
 */
export async function writeNativePlayerWeeklyScores(
  db: Db,
  args: {
    leagueId: string
    seasonYear: number
    week: number
    redraftRosterId: string
    players: readonly NativePlayerPoints[]
    isFinalized: boolean
  },
): Promise<{ written: number }> {
  const rosterId = nativeRosterSeat(args.redraftRosterId)
  const rows = dedupe(args.players)
  const key = { leagueId: args.leagueId, seasonYear: args.seasonYear, week: args.week }
  await db.$transaction([
    db.leaguePlayerWeeklyScore.deleteMany({
      where: { ...key, rosterId, source: NATIVE_PLAYER_SCORE_SOURCE, playerId: { notIn: rows.map((r) => r.playerId) } },
    }),
    ...rows.map((r) => {
      const data = {
        rosterId,
        isStarter: r.isStarter,
        points: Math.round(r.points * 100) / 100,
        isFinalized: args.isFinalized,
        source: NATIVE_PLAYER_SCORE_SOURCE,
      }
      return db.leaguePlayerWeeklyScore.upsert({
        where: { leagueId_seasonYear_week_playerId: { ...key, playerId: r.playerId } },
        create: { ...key, playerId: r.playerId, ...data },
        update: data,
      })
    }),
  ])
  return { written: rows.length }
}
