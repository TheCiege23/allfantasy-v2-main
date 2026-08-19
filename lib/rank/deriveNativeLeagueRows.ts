import { prisma } from '@/lib/prisma'

/**
 * Native-league career rows for the global rank calculation.
 *
 * Mirrors the `RankLeagueRow` shape used inside `calculateAndSaveRank` so these
 * rows merge into the SAME career-XP math as imported (`League.import_*`) and
 * legacy (`legacyLeague`/`legacyRoster`) history. This is what makes leagues
 * *created in AllFantasy* actually count toward a user's rank/XP — previously
 * only imported/legacy history did.
 *
 * Source of truth: `franchise_seasons` (model `FranchiseSeason`) — documented in
 * the schema as "the canonical per-franchise per-season outcome record … wins,
 * losses, playoffs, championship", one row per (leagueId, rosterId, season), with
 * a `userId` column. Because that table is written at season finalization, only
 * COMPLETED native seasons are credited — which matches how imported leagues only
 * credit finalized standings. In-progress native seasons start counting once they
 * finalize into `franchise_seasons`.
 */

export type NativeRankRow = {
  key: string
  wins: number
  losses: number
  madePlayoffs: boolean
  wonChampionship: boolean
  season: number
  leagueSize: number
}

/** Platform tags used for native AllFantasy leagues (see computeUserRole in get-dashboard-league-list). */
const NATIVE_PLATFORMS = ['allfantasy', 'af', 'manual', 'native']

export async function getNativeLeagueRankRows(userId: string): Promise<NativeRankRow[]> {
  const seasons = await prisma.franchiseSeason
    .findMany({
      where: {
        userId,
        league: { platform: { in: NATIVE_PLATFORMS } },
      },
      select: {
        wins: true,
        losses: true,
        madePlayoffs: true,
        wonChampionship: true,
        season: true,
        league: {
          select: { id: true, platform: true, platformLeagueId: true, leagueSize: true },
        },
      },
    })
    .catch((err: unknown) => {
      console.error('[getNativeLeagueRankRows] query failed', err)
      return [] as Array<{
        wins: number
        losses: number
        madePlayoffs: boolean
        wonChampionship: boolean
        season: number
        league: { id: string; platform: string | null; platformLeagueId: string | null; leagueSize: number | null } | null
      }>
    })

  return seasons.map((s) => {
    const platform = s.league?.platform ?? 'allfantasy'
    // Native leagues have no external platformLeagueId — key on the AF league id.
    const leagueRef = s.league?.platformLeagueId ?? s.league?.id ?? 'unknown'
    return {
      key: `${platform}:${leagueRef}:${s.season}`,
      wins: s.wins ?? 0,
      losses: s.losses ?? 0,
      madePlayoffs: s.madePlayoffs === true,
      wonChampionship: s.wonChampionship === true,
      season: s.season,
      leagueSize: s.league?.leagueSize ?? 12,
    }
  })
}
