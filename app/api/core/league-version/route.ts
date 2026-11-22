import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }

/**
 * A fingerprint of what the /core screens show about the signed-in user's leagues, so the shell
 * rebuilds the page only when it moved (lib/core-app/coreRefreshPolicy.ts, `decideCoreRefresh`).
 *
 * ⚠ CONTENT, NEVER TIMESTAMPS. Every sync rewrites `updatedAt` on leagues, teams and rosters
 * whether or not anything changed (prod, 2026-11-19: all 103 of one user's leagues "updated" in an
 * hour), and its own `imported` count re-counts the same completed trades every run. Hashing the
 * columns the screens render is the only signal that stays still when nothing changed.
 *
 * Hashed inside Postgres, so one row comes back however many rosters a user has (1,358 for the
 * largest account). The leagues are the same set as /api/core/trade-version: owned or claimed.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  try {
    const rows = await prisma.$queryRaw<{ version: string | null }[]>`
      WITH lg AS (
        SELECT l.id, l.name, l.status, l.season, l."leagueType", l."isDynasty" FROM leagues l WHERE l."userId" = ${userId}
        UNION
        SELECT l.id, l.name, l.status, l.season, l."leagueType", l."isDynasty"
          FROM leagues l JOIN league_teams t ON t."leagueId" = l.id WHERE t."claimedByUserId" = ${userId}
      )
      SELECT md5(concat_ws(':',
        (SELECT md5(string_agg(concat_ws('|', id, name, status, season, "leagueType", "isDynasty"), ',' ORDER BY id)) FROM lg),
        (SELECT md5(string_agg(concat_ws('|', t.id, t."teamName", t.wins, t.losses, t.ties,
                  round(t."pointsFor"::numeric, 1), round(t."pointsAgainst"::numeric, 1), t."currentRank",
                  t."isOrphan", t."archivedAt", t."eliminatedAt", t."claimedByUserId"), ',' ORDER BY t.id))
           FROM league_teams t WHERE t."leagueId" IN (SELECT id FROM lg)),
        (SELECT md5(string_agg(concat_ws('|', r.id, md5(r."playerData"::text), r."faabRemaining", r."waiverPriority"), ',' ORDER BY r.id))
           FROM rosters r WHERE r."leagueId" IN (SELECT id FROM lg))
      )) AS version`
    const version = rows[0]?.version ?? null
    if (!version) return NextResponse.json({ error: 'League updates unavailable' }, { status: 503, headers })
    return NextResponse.json({ version }, { headers })
  } catch {
    // The shell treats an unavailable fingerprint as "rebuild", so a failure here costs freshness nothing.
    return NextResponse.json({ error: 'League updates unavailable' }, { status: 503, headers })
  }
}
