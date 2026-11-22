import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { WaiverCrowd } from './waiverCrowdLine'

export type { WaiverCrowd } from './waiverCrowdLine'
export { CROWD_MIN_LEAGUES, crowdLine } from './waiverCrowdLine'

/**
 * How the rest of AllFantasy's synced Sleeper leagues see a Worth adding candidate (NFL only): how
 * many roster him, and how many added him this week. Both are read from Postgres — no provider call.
 *
 *   - Rostered: `rosters."playerData"->'players'`, the array the redraft sync keeps current (the
 *     same path `lib/live/bigPlayNotifier.ts` reads). ONE SLEEPER LEAGUE IS SEVERAL AF LEAGUE ROWS
 *     (one per importer), each with its own rosters synced at its own time, so each Sleeper league
 *     is read from the copy whose rosters were written most recently — counting any copy would let a
 *     stale importer's roster keep a dropped player "rostered".
 *   - Added: `dw_transaction_facts`, read by the rules `lib/core-app/trendingAdds.ts` measured on
 *     2026-09-29 — the added player is `payload.adds`, the time is `payload.createdAt`, and a league
 *     is counted once per (platform league, Sleeper transaction).
 *
 * ⚠ THE POPULATION IS "SLEEPER LEAGUES SYNCED TO ALLFANTASY", NOT SLEEPER. The surface must say so,
 * and below `CROWD_MIN_LEAGUES` it shows nothing: "100% rostered" out of two leagues is not a fact
 * about the player.
 */

const CROWD_WINDOW_DAYS = 7
const TTL_MS = 15 * 60_000
const MAX_IDS = 40


type RosterRow = { sid: string; leagues: number; total: number }
type AddRow = { sid: string | null; leagues: number; active_leagues: number; newest: Date | null }

const cache = new Map<string, { at: number; value: Promise<WaiverCrowd | null> }>()

/** Tests only. */
export function clearWaiverCrowdCache(): void {
  cache.clear()
}

export function loadWaiverCrowd(sleeperIds: string[], season: number, now: Date = new Date()): Promise<WaiverCrowd | null> {
  const ids = [...new Set(sleeperIds.filter((id) => /^[A-Za-z0-9_-]{1,32}$/.test(id)))].sort().slice(0, MAX_IDS)
  if (ids.length === 0 || !Number.isInteger(season)) return Promise.resolve(null)
  const key = `${season}:${ids.join(',')}`
  const hit = cache.get(key)
  if (hit && now.getTime() - hit.at < TTL_MS) return hit.value
  const value = read(ids, season, now).catch(() => {
    cache.delete(key) // a failed read is not cached as "nobody rosters anyone"
    return null
  })
  cache.set(key, { at: now.getTime(), value })
  return value
}

async function read(ids: string[], season: number, now: Date): Promise<WaiverCrowd> {
  const since = new Date(now.getTime() - CROWD_WINDOW_DAYS * 86_400_000)
  const [rostered, added] = await Promise.all([
    prisma.$queryRaw<RosterRow[]>(Prisma.sql`
      WITH lg AS (
        SELECT DISTINCT ON (l."platformLeagueId") l.id, l."platformLeagueId" AS league
        FROM leagues l
        JOIN rosters r ON r."leagueId" = l.id
        WHERE lower(l.platform) = 'sleeper'
          AND l."platformLeagueId" IS NOT NULL
          AND l.sport::text = 'NFL'
          AND l.season = ${season}
        GROUP BY l.id, l."platformLeagueId"
        ORDER BY l."platformLeagueId", max(r."updatedAt") DESC
      ),
      ro AS (
        SELECT lg.league, r."playerData"->'players' AS players
        FROM rosters r
        JOIN lg ON lg.id = r."leagueId"
        WHERE jsonb_typeof(r."playerData"->'players') = 'array'
      )
      SELECT s.sid,
             (SELECT count(DISTINCT ro.league) FROM ro WHERE ro.players @> jsonb_build_array(s.sid))::int AS leagues,
             (SELECT count(DISTINCT ro.league) FROM ro)::int AS total
      FROM unnest(${ids}::text[]) AS s(sid)
    `),
    prisma.$queryRaw<AddRow[]>(Prisma.sql`
      WITH tx AS (
        SELECT DISTINCT ON (lower(l.platform), l."platformLeagueId", t.payload->>'sleeperTransactionId')
               l."platformLeagueId" AS league, t.payload->'adds' AS adds,
               (t.payload->>'createdAt')::timestamptz AS happened
        FROM dw_transaction_facts t
        JOIN leagues l ON l.id = t."leagueId"
        WHERE t.type IN ('free_agent', 'waiver')
          AND lower(l.platform) = 'sleeper'
          AND l."platformLeagueId" IS NOT NULL
          AND l.sport::text = 'NFL'
          AND coalesce(t.payload->>'status', 'complete') = 'complete'
          AND t.payload->>'createdAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
          AND jsonb_typeof(t.payload->'adds') = 'array'
          AND (t.payload->>'createdAt')::timestamptz >= ${since}
          AND (t.payload->>'createdAt')::timestamptz <= ${now}
      ),
      adds AS (SELECT tx.league, tx.happened, a.sid FROM tx, jsonb_array_elements_text(tx.adds) AS a(sid))
      SELECT s.sid,
             (SELECT count(DISTINCT adds.league) FROM adds WHERE adds.sid = s.sid)::int AS leagues,
             (SELECT count(DISTINCT adds.league) FROM adds)::int AS active_leagues,
             (SELECT max(adds.happened) FROM adds) AS newest
      FROM unnest(${ids}::text[]) AS s(sid)
    `),
  ])
  const players: WaiverCrowd['players'] = {}
  for (const id of ids) players[id] = { rosteredIn: 0, addedIn: 0 }
  for (const r of rostered) if (r.sid in players) players[r.sid].rosteredIn = Number(r.leagues) || 0
  for (const a of added) if (a.sid && a.sid in players) players[a.sid].addedIn = Number(a.leagues) || 0
  return {
    syncedLeagues: Number(rostered[0]?.total) || 0,
    activeLeagues: Number(added[0]?.active_leagues) || 0,
    through: added[0]?.newest ? new Date(added[0].newest).toISOString() : null,
    players,
  }
}
