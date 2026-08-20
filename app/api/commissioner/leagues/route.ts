/**
 * GET: List leagues the current user is commissioner of (League.userId = session.user.id).
 *
 * Extended for the 10b "@everyone" league picker: each row also carries the platform, whether the
 * league is AllFantasy-hosted, a human subtitle, and its member count.
 *
 * ⚠ THE PREDICATE HERE MUST STAY `League.userId`. `assertCommissioner` (used by
 * `POST /api/commissioner/broadcast`, which is where these ids are sent) resolves commissioner as
 * exactly `League.userId === userId`. If this list ever widened — co-commissioners, claimed teams
 * — the picker would offer leagues the send call then rejects one by one, and the user would watch
 * a broadcast half-fail with no explanation. The two predicates move together or not at all.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/league/isNativeLeague'

export const dynamic = 'force-dynamic'

/** "Dynasty superflex" / "Redraft PPR" — built only from fields that are actually set. */
function describeLeague(l: {
  leagueType: string | null
  scoringPresetId: string | null
  sport: string | null
}): string {
  const type = l.leagueType?.trim()
  // Preset ids look like `fb_half_ppr` / `nba_points`; the trailing segment is the readable part.
  const scoring = l.scoringPresetId?.trim()?.split('_').slice(1).join(' ')
  const parts = [type, scoring].filter((p): p is string => Boolean(p))
  const label = parts.join(' ')
  if (label) return label.charAt(0).toUpperCase() + label.slice(1)
  return l.sport ? String(l.sport) : 'League'
}

export async function GET() {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagues = await prisma.league.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      platform: true,
      sport: true,
      leagueType: true,
      scoringPresetId: true,
    },
    orderBy: { name: 'asc' },
  })

  /*
   * Member counts in ONE grouped query rather than a count per league — this list is small today
   * but it is rendered on a modal open, and a per-row count is the kind of fan-out that only shows
   * up as a problem for the commissioner who runs twelve leagues.
   */
  const counts = await prisma.roster.groupBy({
    by: ['leagueId'],
    where: { leagueId: { in: leagues.map((l) => l.id) } },
    _count: { _all: true },
  })
  const countByLeague = new Map(counts.map((c) => [c.leagueId, c._count._all]))

  return NextResponse.json({
    leagues: leagues.map((l) => ({
      id: l.id,
      name: l.name ?? 'Untitled league',
      platform: l.platform,
      /*
       * Imported leagues are NOT broadcastable: their chat lives on the source platform, and this
       * product never writes there. The picker renders them read-only rather than hiding them, so
       * the commissioner can see why a league is missing from the blast.
       */
      isNative: isNativePlatform(l.platform),
      subtitle: describeLeague(l),
      memberCount: countByLeague.get(l.id) ?? 0,
    })),
  })
}
