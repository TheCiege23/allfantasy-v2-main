import { prisma } from '@/lib/prisma'

/**
 * Leagues the signed-in user can value players against, gathered from BOTH league
 * id spaces and returned in one typed list.
 *
 * The two spaces hold very different volumes in production — the modern `leagues`
 * table has 66 rows while `LegacyLeague` has 859 — so a selector that read only the
 * modern space would be empty for most real users.
 *
 * Rows already migrated from `LegacyLeague` into a native `League` are excluded from
 * the legacy half, matching the rule the dashboard board uses, so an actively
 * imported league is not offered twice under two different ids.
 */

export interface ValuationLeague {
  /** Either a `League.id` uuid or a `LegacyLeague.sleeperLeagueId`. The consumer
   *  passes this straight back; `resolveLeagueMarketSettings` detects the space. */
  id: string
  name: string
  platform: string | null
  sport: string
  season: number | null
}

export async function getValuationLeagues(userId: string): Promise<ValuationLeague[]> {
  const [modern, appUser] = await Promise.all([
    prisma.league.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        platform: true,
        sport: true,
        season: true,
        legacyLeagueId: true,
      },
      orderBy: [{ season: 'desc' }, { name: 'asc' }],
      take: 100,
    }),
    prisma.appUser.findUnique({
      where: { id: userId },
      select: { legacyUserId: true },
    }),
  ])

  const leagues: ValuationLeague[] = modern.map((row) => ({
    id: row.id,
    name: row.name ?? 'Untitled league',
    platform: row.platform,
    // `League.sport` is an enum, unlike the free-text `LegacyLeague.sport`.
    sport: String(row.sport),
    season: row.season,
  }))

  if (!appUser?.legacyUserId) return leagues

  const legacy = await prisma.legacyLeague.findMany({
    where: {
      userId: appUser.legacyUserId,
      // Exclude rows that already surfaced above as a native league.
      activeLeague: { is: null },
    },
    select: {
      sleeperLeagueId: true,
      name: true,
      sport: true,
      season: true,
    },
    orderBy: [{ season: 'desc' }, { name: 'asc' }],
    take: 100,
  })

  for (const row of legacy) {
    leagues.push({
      id: row.sleeperLeagueId,
      name: row.name,
      platform: 'Sleeper',
      sport: row.sport.toUpperCase(),
      season: row.season,
    })
  }

  return leagues
}
