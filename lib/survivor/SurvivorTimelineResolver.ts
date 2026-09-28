import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

function toPositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return null
}

function readWeekFromLeagueSettings(settings: unknown): number | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return null
  }
  const record = settings as Record<string, unknown>
  const candidates = [
    record.currentWeek,
    record.current_week,
    record.week,
    record.scoringPeriodId,
    record.scoring_period_id,
    record.matchupPeriod,
    record.matchup_period,
    record.leg,
  ]
  for (const candidate of candidates) {
    const value = toPositiveInt(candidate)
    if (value != null) return value
  }
  return null
}

export async function getLeagueSeasonForSurvivor(leagueId: string): Promise<number> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { season: true },
  })
  const parsedSeason = toPositiveInt(league?.season)
  return parsedSeason ?? new Date().getFullYear()
}

export async function resolveSurvivorCurrentWeek(
  leagueId: string,
  requestedWeek?: number | null
): Promise<number> {
  const explicitWeek = toPositiveInt(requestedWeek)
  if (explicitWeek != null) return explicitWeek

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      season: true,
      settings: true,
    },
  })
  if (!league) return 1

  const settingsWeek = readWeekFromLeagueSettings(league.settings)
  if (settingsWeek != null) return settingsWeek

  const season = toPositiveInt(league.season) ?? new Date().getFullYear()

  const teamIds = await prisma.leagueTeam.findMany({
    where: { leagueId },
    select: { id: true },
  })
  const latestPerformance = teamIds.length
    ? await prisma.teamPerformance.findFirst({
        where: {
          teamId: { in: teamIds.map((team) => team.id) },
          season,
        },
        orderBy: [{ week: 'desc' }],
        select: { week: true },
      })
    : null
  if (latestPerformance?.week != null && latestPerformance.week > 0) {
    return latestPerformance.week
  }

  const latestMatchupFact = await prisma.matchupFact.findFirst({
    where: {
      leagueId,
      season,
    },
    orderBy: [{ weekOrPeriod: 'desc' }, { createdAt: 'desc' }],
    select: { weekOrPeriod: true },
  })
  if (latestMatchupFact?.weekOrPeriod != null && latestMatchupFact.weekOrPeriod > 0) {
    return latestMatchupFact.weekOrPeriod
  }

  const draftSession = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { status: true },
  })
  if (draftSession?.status === 'completed') {
    return 1
  }

  return 1
}
