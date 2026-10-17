import 'server-only'

import { subHours } from 'date-fns'
import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import { getServerNowUTC } from '@/lib/time-engine/serverClock'

export type PlayerGameLockResult = {
  /** True when this player's team has a game that has already kicked off (pre-lock window ended). */
  lockedBecauseGameStarted: boolean
  /** Next scheduled kickoff for this team when found in `SportsGame` (may be null if schedule missing). */
  nextKickoffUtc: Date | null
  /** We found at least one schedule row for this team in the relevant window. */
  scheduleKnown: boolean
  reason: string
}

function weekFromLeagueSettings(settings: unknown): number {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return 1
  const o = settings as Record<string, unknown>
  const w = o.currentWeek ?? o.current_week ?? o.week
  if (typeof w === 'number' && Number.isFinite(w)) return Math.max(1, w)
  if (typeof w === 'string') {
    const n = parseInt(w, 10)
    return Number.isFinite(n) ? Math.max(1, n) : 1
  }
  return 1
}

/**
 * Per-player / per-game lock: a starter is locked for AutoCoach once their **team's** next game
 * has started (server UTC). This replaces slate-wide “first game locked everyone” behavior.
 */
export async function getPlayerGameLockStateForAutoCoach(args: {
  sport: string
  teamAbbr: string | null | undefined
  leagueSeason: number
  leagueSettings: unknown
  db?: Pick<Prisma.TransactionClient, 'sportsGame'>
  nowUtc?: Date
}): Promise<PlayerGameLockResult> {
  const now = args.nowUtc ?? getServerNowUTC()
  const sk = normalizeToSupportedSport(args.sport) as SupportedSport
  const team = args.teamAbbr?.trim()
  if (!team) {
    return {
      lockedBecauseGameStarted: false,
      nextKickoffUtc: null,
      scheduleKnown: false,
      reason: 'no_team_on_player_row',
    }
  }

  const leagueWeek = weekFromLeagueSettings(args.leagueSettings)
  const isWeeklyFootball = sk === 'NFL' || sk === 'NCAAF'

  const teamOr: Prisma.SportsGameWhereInput[] = [
    { homeTeam: { equals: team, mode: 'insensitive' } },
    { awayTeam: { equals: team, mode: 'insensitive' } },
  ]

  const weeklyWhere = isWeeklyFootball
    ? {
        sport: sk,
        OR: teamOr,
        season: args.leagueSeason,
        week: leagueWeek,
        startTime: { lte: now, not: null },
      }
    : null

  const recent = weeklyWhere
    ? await (args.db ?? prisma).sportsGame.findFirst({
        where: weeklyWhere,
        orderBy: { startTime: 'desc' },
        select: { startTime: true },
      })
    : await (args.db ?? prisma).sportsGame.findFirst({
        where: {
          sport: sk,
          OR: teamOr,
          startTime: { lte: now, gte: subHours(now, 12) },
        },
        orderBy: { startTime: 'desc' },
        select: { startTime: true },
      })

  if (recent?.startTime && recent.startTime <= now) {
    return {
      lockedBecauseGameStarted: true,
      nextKickoffUtc: recent.startTime,
      scheduleKnown: true,
      reason: 'team_game_started',
    }
  }

  const nextWhere = isWeeklyFootball
    ? {
        sport: sk,
        OR: teamOr,
        season: args.leagueSeason,
        week: leagueWeek,
        startTime: { gt: now },
      }
    : {
        sport: sk,
        OR: teamOr,
        startTime: { gt: now },
      }

  const next = await (args.db ?? prisma).sportsGame.findFirst({
    where: nextWhere,
    orderBy: { startTime: 'asc' },
    select: { startTime: true },
  })

  if (next?.startTime) {
    return {
      lockedBecauseGameStarted: false,
      nextKickoffUtc: next.startTime,
      scheduleKnown: true,
      reason: 'before_team_kickoff',
    }
  }

  // Daily sports: broaden search if week/season filter yielded nothing
  if (!isWeeklyFootball) {
    const nextBroad = await (args.db ?? prisma).sportsGame.findFirst({
      where: {
        sport: sk,
        OR: teamOr,
        startTime: { gt: now },
      },
      orderBy: { startTime: 'asc' },
      select: { startTime: true },
    })
    const pastBroad = await (args.db ?? prisma).sportsGame.findFirst({
      where: {
        sport: sk,
        OR: teamOr,
        startTime: { lte: now, gte: subHours(now, 12) },
      },
      orderBy: { startTime: 'desc' },
      select: { startTime: true },
    })
    if (pastBroad?.startTime) {
      return {
        lockedBecauseGameStarted: true,
        nextKickoffUtc: pastBroad.startTime,
        scheduleKnown: true,
        reason: 'team_game_in_recent_window',
      }
    }
    if (nextBroad?.startTime) {
      return {
        lockedBecauseGameStarted: false,
        nextKickoffUtc: nextBroad.startTime,
        scheduleKnown: true,
        reason: 'before_team_kickoff_broad',
      }
    }
  }

  return {
    lockedBecauseGameStarted: false,
    nextKickoffUtc: null,
    scheduleKnown: false,
    reason: 'schedule_not_in_db',
  }
}
