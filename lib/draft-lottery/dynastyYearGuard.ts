import 'server-only'

import { prisma } from '@/lib/prisma'

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
      season: true,
      createdAt: true,
      settings: true,
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
  const createdYear = new Date(league.createdAt).getFullYear()

  let isStartupLeague = false
  if (startupSeason != null && currentSeason != null && currentSeason === startupSeason) {
    isStartupLeague = true
  } else if (completedDrafts === 0 && currentSeason != null) {
    if (startupSeason == null) {
      isStartupLeague = currentSeason <= createdYear
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
