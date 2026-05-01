import { prisma } from '@/lib/prisma'
import { getLevelFromXp } from '@/lib/rank/levels'
import {
  RANK_XP_LEAGUE_SIZE_MULTIPLIER,
  RANK_XP_PER_CHAMPIONSHIP,
  RANK_XP_PER_DISTINCT_SEASON,
  RANK_XP_PER_IMPORT_WIN,
  RANK_XP_PER_PLAYOFF_APPEARANCE,
} from '@/lib/rank/rank-xp-constants'

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

/** Uniform shape for a single league-season row used in XP calculation. */
type RankLeagueRow = {
  key: string
  wins: number
  losses: number
  madePlayoffs: boolean
  wonChampionship: boolean
  season: number
  leagueSize: number
}

/**
 * XP from imported `League` rows AND `legacyLeague`/`legacyRoster` rows.
 * Merges both sources (deduplicates by key) so legacy import data is always
 * reflected in the rank card even when `League.import_*` columns are null.
 *
 * IMPORTANT: This does NOT create or modify `League` rows — legacy data stays
 * in the legacy tables and never appears in the My Leagues dashboard.
 */
export async function calculateAndSaveRank(userId: string): Promise<CalculateRankResult | null> {
  try {
    const rows = new Map<string, RankLeagueRow>()

    // ── Source 1: League table (import_* columns) ──────────────────────
    const leagues = await prisma.league.findMany({
      where: {
        userId,
        importWins: { not: null },
      },
      select: {
        importWins: true,
        importLosses: true,
        importMadePlayoffs: true,
        importWonChampionship: true,
        season: true,
        platform: true,
        leagueSize: true,
        platformLeagueId: true,
      },
    })

    for (const l of leagues) {
      const key = `${l.platform ?? 'unknown'}:${l.platformLeagueId ?? ''}:${l.season}`
      rows.set(key, {
        key,
        wins: l.importWins ?? 0,
        losses: l.importLosses ?? 0,
        madePlayoffs: l.importMadePlayoffs === true,
        wonChampionship: l.importWonChampionship === true,
        season: l.season,
        leagueSize: l.leagueSize ?? 12,
      })
    }

    // ── Source 2: Legacy tables (legacyLeague + legacyRoster) ─────────
    const appUser = await prisma.appUser
      .findUnique({
        where: { id: userId },
        select: { legacyUserId: true },
      })
      .catch(() => null)

    if (appUser?.legacyUserId) {
      const legacyLeagues = await prisma.legacyLeague.findMany({
        where: { userId: appUser.legacyUserId },
        select: {
          id: true,
          sleeperLeagueId: true,
          season: true,
          teamCount: true,
          playoffTeams: true,
          rosters: {
            where: { isOwner: true },
            take: 1,
            select: {
              wins: true,
              losses: true,
              isChampion: true,
              finalStanding: true,
              playoffSeed: true,
            },
          },
        },
      })

      for (const ll of legacyLeagues) {
        const roster = ll.rosters[0]
        if (!roster) continue

        // Dedup key matches the League table key so we don't double-count
        const key = `sleeper:${ll.sleeperLeagueId}:${ll.season}`

        // Skip if we already have data from League.import_* (more authoritative)
        if (rows.has(key)) continue

        const playoffCutoff = ll.playoffTeams ?? null
        const madePlayoffs =
          roster.isChampion === true ||
          (playoffCutoff != null && roster.playoffSeed != null
            ? roster.playoffSeed <= playoffCutoff
            : playoffCutoff != null && roster.finalStanding != null
              ? roster.finalStanding <= playoffCutoff
              : false)

        rows.set(key, {
          key,
          wins: roster.wins ?? 0,
          losses: roster.losses ?? 0,
          madePlayoffs,
          wonChampionship: roster.isChampion === true,
          season: ll.season,
          leagueSize: ll.teamCount ?? 12,
        })
      }
    }

    // ── Compute XP from merged rows ──────────────────────────────
    const allRows = Array.from(rows.values())

    if (allRows.length === 0) return null

    const careerWins = allRows.reduce((s, r) => s + r.wins, 0)
    const careerLosses = allRows.reduce((s, r) => s + r.losses, 0)
    const careerChampionships = allRows.filter((r) => r.wonChampionship).length
    const careerPlayoffAppearances = allRows.filter((r) => r.madePlayoffs).length
    const careerSeasonsPlayed = allRows.length
    const careerLeaguesPlayed = new Set(allRows.map((r) => r.season)).size

    const leagueSizeBonus = allRows.reduce((sum, r) => {
      return sum + Math.max(0, r.leagueSize - 10) * RANK_XP_LEAGUE_SIZE_MULTIPLIER
    }, 0)

    const xpNum =
      careerWins * RANK_XP_PER_IMPORT_WIN +
      careerPlayoffAppearances * RANK_XP_PER_PLAYOFF_APPEARANCE +
      careerChampionships * RANK_XP_PER_CHAMPIONSHIP +
      careerLeaguesPlayed * RANK_XP_PER_DISTINCT_SEASON +
      leagueSizeBonus

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
