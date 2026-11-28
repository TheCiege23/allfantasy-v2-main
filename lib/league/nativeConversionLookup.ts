import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Has this provider league been switched to AllFantasy in place? Then importing or re-syncing it must not make a second
 * copy beside it — docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md §6.2, step 5.
 *
 * WHY EVERY IMPORT DOOR NEEDS IT. The switch rewrites `League.platform` to 'manual', so the row no longer matches the
 * `(userId, platform, platformLeagueId, season)` key an import writes by. Without this check, any member importing the
 * old Sleeper/ESPN/… league gets a brand-new imported copy, which is the duplicate the owner rejected.
 * `LeagueNativeConversion` remembers the provider identity the switch overwrote; this reads it.
 *
 * ⚠ A SLEEPER RENEWAL IS A NEW LEAGUE ID. Next season's Sleeper league points back at the switched one through
 * `previous_league_id`, so callers pass the whole chain they know (`normalized.previous_seasons`), not only the id.
 *
 * ⚠ FAILS OPEN, like the deleted-league check beside it (lib/league-delete/leagueTombstones.ts): a read that errors
 * answers "not converted" with a warning. A database hiccup must not block every import in the app; the cost of that
 * rare miss is one duplicate the merge script can fold back.
 *
 * Dependency-light on purpose: the import commit service imports this, so this must not import it back.
 */

type Db = Pick<Prisma.TransactionClient, 'leagueNativeConversion'>

export type ConvertedLeague = { leagueId: string; leagueName: string }

/** Thrown by the legacy re-sync paths (`league-sync-core`, `sleeper-sync`), whose routes pass the message through. */
export class ConvertedLeagueError extends Error {
  constructor(readonly converted: ConvertedLeague) {
    super(convertedLeagueMessage(converted.leagueName))
  }
}

export function convertedLeagueMessage(leagueName: string): string {
  return `This league now runs on AllFantasy as "${leagueName}". Ask its commissioner for an invite link to join it there.`
}

export async function findConvertedLeague(
  args: { platform: string; platformLeagueIds: ReadonlyArray<string | null | undefined> },
  db: Db = prisma,
): Promise<ConvertedLeague | null> {
  const ids = [...new Set(args.platformLeagueIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
  const platform = String(args.platform ?? '').trim()
  if (!ids.length || !platform) return null
  try {
    const row = await db.leagueNativeConversion.findFirst({
      where: { fromPlatform: { equals: platform, mode: 'insensitive' }, fromPlatformLeagueId: { in: ids }, status: 'applied' },
      select: { leagueId: true, league: { select: { name: true } } },
    })
    return row ? { leagueId: row.leagueId, leagueName: row.league.name ?? 'your league' } : null
  } catch (error) {
    console.warn('[native-conversion] converted-league lookup failed; allowing the import', JSON.stringify({
      platform, ids: ids.length, error: error instanceof Error ? error.message : String(error),
    }))
    return null
  }
}
