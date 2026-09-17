/**
 * GET: List the leagues the current user may send an @everyone announcement to — as head
 * commissioner or co-commissioner (`listBroadcastLeagueIds`).
 *
 * Extended for the 10b "@everyone" league picker: each row also carries the platform, whether the
 * league is AllFantasy-hosted, a human subtitle, and its member count. The draft room's broadcast
 * picker reads it too.
 *
 * ⚠ THIS LIST AND `POST /api/commissioner/broadcast` MUST USE THE SAME RULE, or the picker offers
 * leagues the send then rejects one by one and the user watches a broadcast half-fail with no
 * explanation. Both answer through `lib/commissioner/broadcastAccess.ts`. Until 2026-09-17 both
 * were `League.userId` only; co-commissioners were added to both at once, by the user's decision.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { listBroadcastLeagueIds } from '@/lib/commissioner/broadcastAccess'

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

  const ids = await listBroadcastLeagueIds(userId)
  const leagues = await prisma.league.findMany({
    where: { id: { in: ids } },
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
