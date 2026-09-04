import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { League } from '@prisma/client'

/**
 * Resolves the current commissioner's league via the same session call and
 * "most recent non-archived" rule `app/api/user/active-league/route.ts`
 * intends — but querying `Roster` by `platformUserId`, not that route's own
 * `prisma.leagueMember` (there is no `LeagueMember` model in schema.prisma
 * at all; that route's `as any`-cast query does not correspond to any real
 * model and cannot work as written — a pre-existing bug in a route outside
 * Commissioner OS, out of scope to fix here). `Roster.platformUserId`
 * matched against the session's `user.id` is the real, already-established
 * pattern elsewhere in this app (e.g. `app/api/idp/scores/route.ts`).
 *
 * Established in Mission Control's `live.ts` (Phase 3.2) and duplicated
 * verbatim across League Health (3.5), Manager Intelligence (3.6),
 * Recommendations Center (3.7), and League Analytics (3.10) — each copy
 * flagged as a candidate for extraction, more urgently each time. Extracted
 * here in Phase 3.11 once a sixth module (Reports) turned out not to need
 * it at all, making this a clean, zero-risk moment to pay down the
 * duplication before some future module needs a sixth copy.
 */
export async function resolveActiveLeagueId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  if (!userId) return null

  const rosters = await prisma.roster.findMany({
    where: { platformUserId: userId },
    include: { league: true },
    orderBy: { createdAt: 'desc' },
  })

  const activeLeague = rosters
    .map((r: { league: League | null }) => r.league)
    .find((league: League | null): league is League => {
      if (!league) return false
      const status = String(league.status ?? '').trim().toUpperCase()
      return !status || !['ARCHIVED', 'COMPLETE', 'COMPLETED', 'CLOSED'].includes(status)
    })

  return activeLeague?.id ? String(activeLeague.id) : null
}
