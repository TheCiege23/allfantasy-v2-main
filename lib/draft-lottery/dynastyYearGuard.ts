import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveLeagueCreationSeason } from '@/lib/season-week/leagueCreationSeason'

export type DynastyLotteryEligibility = {
  eligible: boolean
  reason: string
  currentSeason: number | null
  isStartupLeague: boolean
}

/** Exported so a caller holding the league row can skip the guard's own read for a non-dynasty league. */
export function isDynastyLeagueRow(league: {
  isDynasty: boolean
  leagueVariant: string | null
}): boolean {
  return (
    league.isDynasty ||
    (league.leagueVariant != null &&
      ['devy_dynasty', 'merged_devy_c2c'].includes(String(league.leagueVariant).toLowerCase()))
  )
}

/**
 * Weighted rookie draft lottery is only valid for dynasty leagues in year 2+
 * (established league with prior season / completed draft data — not the founding startup year).
 */
export async function checkDynastyLotteryEligibility(leagueId: string): Promise<DynastyLotteryEligibility> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      isDynasty: true,
      leagueVariant: true,
      sport: true,
      season: true,
      createdAt: true,
      settings: true,
      // The league's FIRST season — see `foundingSeason` below.
      redraftSeasons: { select: { season: true }, orderBy: { season: 'asc' }, take: 1 },
      _count: {
        select: {
          redraftDrafts: { where: { status: 'completed' } },
        },
      },
    },
  })

  if (!league) {
    return {
      eligible: false,
      reason: 'League not found',
      currentSeason: null,
      isStartupLeague: false,
    }
  }

  if (!isDynastyLeagueRow(league)) {
    return {
      eligible: false,
      reason: 'Weighted lottery is only available for dynasty leagues.',
      currentSeason: null,
      isStartupLeague: false,
    }
  }

  const settings = (league.settings as Record<string, unknown>) ?? {}
  const currentSeason = typeof league.season === 'number' ? league.season : null
  const startupSeason =
    typeof settings.startup_season === 'number' ? settings.startup_season : undefined
  const completedDrafts = league._count.redraftDrafts
  /*
   * 🛑 THE FOUNDING SEASON, NOT THE YEAR THE ROW WAS CREATED. This compared against
   * `createdAt.getFullYear()`, but a league is stamped with the season it will PLAY
   * (`resolveLeagueCreationSeason`): an MLB league created in November 2026 is season 2027, so in
   * its startup year `2027 <= 2026` was false and the weighted lottery was allowed in a startup
   * league. The mirror case: an NBA league created in February 2027 joins the in-progress season
   * 2026, so the createdAt year (2027) would stretch its "startup" into year 2 and refuse the lottery
   * there. The league's earliest RedraftSeason IS its first season, however it was stamped; without
   * one, re-derive what creation stamps from `createdAt`.
   */
  const foundingSeason =
    league.redraftSeasons?.[0]?.season ??
    resolveLeagueCreationSeason(String(league.sport ?? ''), new Date(league.createdAt))

  let isStartupLeague = false
  if (startupSeason != null && currentSeason != null && currentSeason === startupSeason) {
    isStartupLeague = true
  } else if (completedDrafts === 0 && currentSeason != null) {
    if (startupSeason == null) {
      isStartupLeague = currentSeason <= foundingSeason
    } else {
      isStartupLeague = currentSeason <= startupSeason
    }
  }

  if (isStartupLeague) {
    return {
      eligible: false,
      reason:
        'Weighted lottery is only available in year 2+ dynasty leagues. Startup leagues must use reverse standings, Max PF, or commissioner order.',
      currentSeason,
      isStartupLeague: true,
    }
  }

  return {
    eligible: true,
    reason: 'Weighted lottery is available for this established dynasty league.',
    currentSeason,
    isStartupLeague: false,
  }
}
