/**
 * XPEventAggregator — collect XP from season outcomes, trades, draft grades, participation,
 * and commissioner activity.
 * Emits XPEvent records and computes total XP per manager.
 */

import { prisma } from '@/lib/prisma'
import { getMergedHistoricalSeasonResultsForManager } from '@/lib/season-results/HistoricalSeasonResultService'
import { resolveSeasonResultRosterIds } from '@/lib/season-results/SeasonResultRosterIdentity'
import {
  GENERATED_XP_EVENT_TYPES,
  XP_VALUES,
  type GeneratedXPEventType,
} from './types'
import {
  DEFAULT_SPORT,
  isSupportedSport,
  normalizeToSupportedSport,
  type SupportedSport,
} from '@/lib/sport-scope'

const XP_WIN_MATCHUP = XP_VALUES.win_matchup ?? 10
const XP_MAKE_PLAYOFFS = XP_VALUES.make_playoffs ?? 50
const XP_CHAMPIONSHIP = XP_VALUES.championship ?? 200
const XP_SEASON_COMPLETION = XP_VALUES.season_completion ?? 25
const XP_SUCCESSFUL_TRADE = XP_VALUES.successful_trade ?? 10
const XP_DRAFT_ACCURACY = XP_VALUES.draft_accuracy ?? 15
const XP_LEAGUE_PARTICIPATION = XP_VALUES.league_participation ?? 5
const XP_COMMISSIONER_SERVICE = XP_VALUES.commissioner_service ?? 25
interface AggregatedXPResult {
  managerId: string
  totalXP: number
  eventsCreated: number
}

type XPEventSeed = {
  managerId: string
  eventType: GeneratedXPEventType
  xpValue: number
  sport: SupportedSport
  createdAt: Date
}

function buildSeasonDate(season: string | null | undefined): Date {
  const parsed = Number.parseInt(season ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 1970 || parsed > 2200) return new Date()
  return new Date(Date.UTC(parsed, 11, 31, 0, 0, 0, 0))
}

function isDraftGradeAccurate(grade: string, score: number): boolean {
  const normalizedGrade = grade.trim().toUpperCase()
  if (score >= 75) return true
  return normalizedGrade.startsWith('A') || normalizedGrade.startsWith('B')
}

/**
 * Aggregate XP for one manager from SeasonResult (wins → matchup wins, champion → championship,
 * completed season → season completion + playoffs) and additional progression signals.
 */
export async function aggregateXPForManager(
  managerId: string,
  options?: { sport?: string | null; writeEvents?: boolean }
): Promise<AggregatedXPResult> {
  const targetSport =
    options?.sport && isSupportedSport(options.sport)
      ? normalizeToSupportedSport(options.sport)
      : null
  const writeEvents = options?.writeEvents !== false

  const rosters = await prisma.roster.findMany({
    where: {
      platformUserId: managerId,
      ...(targetSport ? { league: { sport: targetSport } } : {}),
    },
    select: {
      id: true,
      leagueId: true,
      platformUserId: true,
      playerData: true,
      createdAt: true,
      league: { select: { id: true, sport: true } },
    },
  })
  const leagueIds = [...new Set(rosters.map((roster) => roster.leagueId).filter(Boolean))]
  const leagueSportById = new Map<string, SupportedSport>(
    rosters.map((roster) => [
      roster.leagueId,
      normalizeToSupportedSport(roster.league?.sport ?? targetSport ?? DEFAULT_SPORT),
    ])
  )

  const combinedSeasonRows = await getMergedHistoricalSeasonResultsForManager({
    managerId,
    rosters,
  })
  const eventSeeds: XPEventSeed[] = []

  for (const row of combinedSeasonRows) {
    const sport = leagueSportById.get(row.leagueId) ?? targetSport ?? DEFAULT_SPORT
    const eventDate = buildSeasonDate(row.season)
    const wins = Math.max(0, row.wins ?? 0)
    if (wins > 0) {
      eventSeeds.push({
        managerId,
        eventType: 'win_matchup',
        xpValue: wins * XP_WIN_MATCHUP,
        sport,
        createdAt: eventDate,
      })
    }

    eventSeeds.push({
      managerId,
      eventType: 'season_completion',
      xpValue: XP_SEASON_COMPLETION,
      sport,
      createdAt: eventDate,
    })

    if (row.madePlayoffs || row.champion) {
      eventSeeds.push({
        managerId,
        eventType: 'make_playoffs',
        xpValue: XP_MAKE_PLAYOFFS,
        sport,
        createdAt: eventDate,
      })
    }

    if (row.champion) {
      eventSeeds.push({
        managerId,
        eventType: 'championship',
        xpValue: XP_CHAMPIONSHIP,
        sport,
        createdAt: eventDate,
      })
    }
  }

  const earliestRosterByLeague = new Map<string, Date>()
  for (const roster of rosters) {
    const existing = earliestRosterByLeague.get(roster.leagueId)
    if (!existing || roster.createdAt < existing) {
      earliestRosterByLeague.set(roster.leagueId, roster.createdAt)
    }
  }
  for (const leagueId of leagueIds) {
    eventSeeds.push({
      managerId,
      eventType: 'league_participation',
      xpValue: XP_LEAGUE_PARTICIPATION,
      sport: leagueSportById.get(leagueId) ?? targetSport ?? DEFAULT_SPORT,
      createdAt: earliestRosterByLeague.get(leagueId) ?? new Date(),
    })
  }

  if (leagueIds.length > 0) {
    const resolvedRosterIds = resolveSeasonResultRosterIds(rosters)
    const rosterIdSet = new Set<string>(resolvedRosterIds.rosterIds)
    const draftGrades = await prisma.draftGrade.findMany({
      where: {
        leagueId: { in: leagueIds },
      },
      select: {
        leagueId: true,
        season: true,
        rosterId: true,
        grade: true,
        score: true,
      },
    })
    for (const grade of draftGrades) {
      if (!rosterIdSet.has(grade.rosterId)) continue
      const score = Number(grade.score ?? 0)
      if (!isDraftGradeAccurate(grade.grade, score)) continue
      eventSeeds.push({
        managerId,
        eventType: 'draft_accuracy',
        xpValue: XP_DRAFT_ACCURACY,
        sport: leagueSportById.get(grade.leagueId) ?? targetSport ?? DEFAULT_SPORT,
        createdAt: buildSeasonDate(grade.season),
      })
    }
  }

  const tradeOffers = await prisma.tradeOfferEvent.findMany({
    where: { senderUserId: managerId },
    select: {
      id: true,
      leagueId: true,
      verdict: true,
      createdAt: true,
    },
  })
  const unresolvedTradeLeagueIds = [
    ...new Set(
      tradeOffers
        .map((offer) => offer.leagueId)
        .filter((leagueId): leagueId is string => !!leagueId && !leagueSportById.has(leagueId))
    ),
  ]
  if (unresolvedTradeLeagueIds.length > 0) {
    const tradeLeagues = await prisma.league.findMany({
      where: { id: { in: unresolvedTradeLeagueIds } },
      select: { id: true, sport: true },
    })
    for (const league of tradeLeagues) {
      leagueSportById.set(league.id, normalizeToSupportedSport(league.sport))
    }
  }

  const acceptedOutcomes = await prisma.tradeOutcomeEvent.findMany({
    where: {
      outcome: 'ACCEPTED',
      offerEventId: { in: tradeOffers.map((offer) => offer.id) },
    },
    select: { offerEventId: true },
  })
  const acceptedOfferIds = new Set(
    acceptedOutcomes.map((row) => row.offerEventId).filter((value): value is string => !!value)
  )
  for (const offer of tradeOffers) {
    const verdict = offer.verdict.toLowerCase()
    const accepted = acceptedOfferIds.has(offer.id) || verdict.includes('accept')
    if (!accepted) continue
    if (targetSport && offer.leagueId && leagueSportById.get(offer.leagueId) !== targetSport) {
      continue
    }
    eventSeeds.push({
      managerId,
      eventType: 'successful_trade',
      xpValue: XP_SUCCESSFUL_TRADE,
      sport: offer.leagueId
        ? leagueSportById.get(offer.leagueId) ?? targetSport ?? DEFAULT_SPORT
        : targetSport ?? DEFAULT_SPORT,
      createdAt: offer.createdAt,
    })
  }

  const commissionerLeagues = await prisma.league.findMany({
    where: {
      userId: managerId,
      ...(targetSport ? { sport: targetSport } : {}),
    },
    select: { id: true, sport: true, createdAt: true },
  })
  if (commissionerLeagues.length > 0) {
    const commissionerLeagueIds = commissionerLeagues.map((league) => league.id)
    const commissionerSeasons = await prisma.seasonResult.findMany({
      where: {
        leagueId: { in: commissionerLeagueIds },
      },
      select: { leagueId: true, season: true },
      distinct: ['leagueId', 'season'],
    })
    for (const season of commissionerSeasons) {
      const league = commissionerLeagues.find((row) => row.id === season.leagueId)
      eventSeeds.push({
        managerId,
        eventType: 'commissioner_service',
        xpValue: XP_COMMISSIONER_SERVICE,
        sport: normalizeToSupportedSport(league?.sport ?? targetSport ?? DEFAULT_SPORT),
        createdAt: buildSeasonDate(season.season),
      })
    }
  }

  const totalXP = eventSeeds.reduce((sum, event) => sum + event.xpValue, 0)
  const eventsToCreate = eventSeeds

  if (writeEvents) {
    await prisma.$transaction(async (tx) => {
      await tx.xPEvent.deleteMany({
        where: {
          managerId,
          ...(targetSport ? { sport: targetSport } : {}),
          eventType: { in: [...GENERATED_XP_EVENT_TYPES] },
        },
      })

      if (eventsToCreate.length === 0) {
        return
      }

      await tx.xPEvent.createMany({
        data: eventsToCreate.map((e) => ({
          managerId: e.managerId,
          eventType: e.eventType,
          xpValue: e.xpValue,
          sport: e.sport,
          createdAt: e.createdAt,
        })),
      })
    })
  }

  return {
    managerId,
    totalXP,
    eventsCreated: eventsToCreate.length,
  }
}
