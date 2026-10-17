import 'server-only'

import { prisma } from '@/lib/prisma'
import { isSupportedSport, normalizeToSupportedSport } from '@/lib/sport-scope'

/**
 * Who "plays" a sport: everyone who is IN a league of that sport, by the same four-branch
 * membership predicate the dashboard league list uses (lib/dashboard/get-dashboard-league-list.ts):
 * the league's owner, a redraft member, a claimed team, or a roster whose platform user id IS the
 * AllFantasy user id (rewritten on claim). The audience for sport-wide alerts — breaking news and
 * live game moments — that are not tied to one roster or one followed team.
 *
 * 🛑 THIS WAS OWNERS ONLY (`League.userId`), WHICH SKIPS EVERY LEAGUE-MATE WHO JOINED BY INVITE OR
 * CLAIMED A TEAM. Measured on production 2026-10-15: owners-only counts 47 NFL users, membership
 * counts 51 — four people who play NFL here and would never have heard about a trade.
 *
 * The roster branch joins `app_users`, because an unclaimed roster holds the PROVIDER's id (a
 * Sleeper numeric id), which must never be read as one of ours.
 *
 * Cached per process for 10 minutes: a busy night asks this for every close game.
 */
const CACHE_MS = 10 * 60 * 1000
/** A hard ceiling per alert. Dispatch is per-user and sequential; a cron run must stay bounded. */
export const SPORT_AUDIENCE_MAX = 5000

const cache = new Map<string, { at: number; ids: string[] }>()

export async function listUserIdsPlayingSport(sport: string): Promise<string[]> {
  const S = String(sport ?? '').toUpperCase()
  if (!isSupportedSport(S)) return []
  const key = normalizeToSupportedSport(S)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ids
  try {
    const rows = await prisma.$queryRaw<Array<{ uid: string }>>`
      SELECT DISTINCT uid FROM (
        SELECT l."userId" AS uid FROM leagues l WHERE l.sport::text = ${key}
        UNION
        SELECT m."userId" FROM redraft_league_members m JOIN leagues l ON l.id = m."leagueId" WHERE l.sport::text = ${key}
        UNION
        SELECT t."claimedByUserId" FROM league_teams t JOIN leagues l ON l.id = t."leagueId"
          WHERE l.sport::text = ${key} AND t."claimedByUserId" IS NOT NULL
        UNION
        SELECT r."platformUserId" FROM rosters r JOIN leagues l ON l.id = r."leagueId"
          JOIN app_users u ON u.id = r."platformUserId" WHERE l.sport::text = ${key}
      ) members
      WHERE uid IS NOT NULL
      ORDER BY uid
      LIMIT ${SPORT_AUDIENCE_MAX}
    `
    const ids = rows.map((r) => r.uid).filter(Boolean)
    cache.set(key, { at: Date.now(), ids })
    return ids
  } catch (err) {
    console.error('[sportAudience] read failed:', err instanceof Error ? err.message : err)
    return []
  }
}
