import { prisma } from '@/lib/prisma'
import { getLevelFromXp } from '@/lib/rank/levels'
import { loadCareerLedger } from '@/lib/rank/careerLedger'
import { careerXp } from '@/lib/rank/careerXp'

export {
  RANK_XP_LEAGUE_SIZE_MULTIPLIER,
  RANK_XP_PER_CHAMPIONSHIP,
  RANK_XP_PER_DISTINCT_SEASON,
  RANK_XP_PER_IMPORT_WIN,
  RANK_XP_PER_PLAYOFF_APPEARANCE,
} from '@/lib/rank/rank-xp-constants'

/** Returned `xpTotal` is the numeric XP total (same value persisted as BigInt on `user_profiles`). */
export type CalculateRankResult = {
  rankTier: string
  xpTotal: number
  xpLevel: number
  careerWins: number
  careerLosses: number
  careerChampionships: number
  careerPlayoffAppearances: number
  careerSeasonsPlayed: number
  careerLeaguesPlayed: number
}

/**
 * XP from every recorded league-season: imported `League` rows, legacy
 * `legacyLeague`/`legacyRoster` rows and native `franchise_seasons`, merged and
 * deduplicated by `loadCareerLedger`.
 *
 * ⚠ THE ROWS COME FROM THE SHARED LEDGER, WHICH `/core/rankings` ALSO READS.
 * Source precedence, the dedup key and the berth rule used to live inline here;
 * they moved to `lib/rank/careerLedger.ts` verbatim so the XP writer and the
 * rankings screen cannot describe one career two ways. One behaviour changed
 * with the move and it is deliberate: imported rows now carry the same
 * played-games gate on a playoff berth that legacy rows already had, because
 * production held four 0-0 in-season imports each credited with a berth.
 *
 * IMPORTANT: This does NOT create or modify `League` rows — legacy data stays
 * in the legacy tables and never appears in the My Leagues dashboard.
 */
export async function calculateAndSaveRank(userId: string): Promise<CalculateRankResult | null> {
  try {
    const allRows = await loadCareerLedger([userId])

    if (allRows.length === 0) return null

    const xp = careerXp(allRows)
    const careerWins = xp.wins
    const careerLosses = xp.losses
    const careerChampionships = xp.championships
    const careerPlayoffAppearances = xp.playoffAppearances
    /*
     * ⚠ THESE TWO WERE SWAPPED ONCE (fixed in 0e8b9de5b). `careerSeasonsPlayed` is
     * the number of DISTINCT years and `careerLeaguesPlayed` the number of
     * league-season rows. `/core/rankings` no longer reads either — it reads the
     * ledger — but `/api/user/rank` and settings still do, in this orientation.
     */
    const careerSeasonsPlayed = xp.distinctSeasons
    const careerLeaguesPlayed = xp.leagueSeasons
    const xpNum = xp.total

    const xpTotal = BigInt(xpNum)
    const levelResult = getLevelFromXp(xpNum)
    const rankTier = levelResult.tier
    const xpLevel = levelResult.level

    await prisma.userProfile.upsert({
      where: { userId },
      update: {
        rankTier,
        xpTotal,
        xpLevel,
        careerWins,
        careerLosses,
        careerChampionships,
        careerPlayoffAppearances,
        careerSeasonsPlayed,
        careerLeaguesPlayed,
        rankCalculatedAt: new Date(),
      },
      create: {
        userId,
        rankTier,
        xpTotal,
        xpLevel,
        careerWins,
        careerLosses,
        careerChampionships,
        careerPlayoffAppearances,
        careerSeasonsPlayed,
        careerLeaguesPlayed,
        rankCalculatedAt: new Date(),
      },
    })

    return {
      rankTier,
      xpTotal: xpNum,
      xpLevel,
      careerWins,
      careerLosses,
      careerChampionships,
      careerPlayoffAppearances,
      careerSeasonsPlayed,
      careerLeaguesPlayed,
    }
  } catch (err: unknown) {
    console.error('[calculateAndSaveRank] error:', err)
    return null
  }
}
