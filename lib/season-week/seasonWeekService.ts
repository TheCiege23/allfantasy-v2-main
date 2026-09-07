/**
 * DB-backed entry points for week resolution.
 *
 * Reads Postgres only — `SportsGame` is the schedule table the import crons
 * already keep current (`/api/cron/import-schedules`), so this stays on the
 * DB-first side of `scripts/check-db-first-api-boundary.mjs` with no provider
 * call of its own.
 */

import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { normalizeSeasonType } from '@/lib/scores/gameScoreProviders'
import { mapSportWeekToLeagueWeek } from './leagueSeasonWeek'
import { resolveSportWeekFromSchedule, sportHasWeekSignal, toScheduleSportKey } from './sportWeekSignal'
import type {
  LeagueSeasonWeekResolution,
  ScheduleRow,
  SportWeekResolution,
} from './types'

/**
 * Whether a sport's feed labels its season types, and therefore whether an
 * unlabelled row can be trusted as regular season.
 *
 * ⚠ MEASURED, AND THE TWO CASES ARE GENUINELY DIFFERENT. NFL 2026 carries 288
 * rows explicitly marked `regular` alongside 488 with a NULL `seasonType` that
 * span 2026-08-07 to 2027-02-14 — preseason, regular and postseason mixed, with
 * nothing to separate them. Filing those as regular would put preseason week 1
 * and regular week 1 in the same bucket, which is the exact collision the
 * `seasonType` column was added to prevent.
 *
 * Soccer is the opposite: 408 rows for 2026, every `seasonType` NULL, weeks
 * 1-38. There is no preseason to confuse them with — a matchweek series IS the
 * season — so a null there means regular and dropping it would leave the sport
 * unresolvable.
 */
function requiresExplicitSeasonType(scheduleSport: string): boolean {
  return scheduleSport !== 'SOCCER'
}

/** How far ahead of `now` to read. One week of lookahead names the next slate. */
const LOOKAHEAD_MS = 21 * 24 * 60 * 60 * 1000
/** How far back to read. Enough to keep the whole played season in view. */
const LOOKBACK_MS = 200 * 24 * 60 * 60 * 1000

export type SeasonWeekDeps = {
  prisma?: PrismaClient
  now?: Date
}

/**
 * What week the SPORT is on, from the committed schedule.
 *
 * Returns `{ ok: false }` rather than a number whenever the feed cannot support
 * an answer — an unsupported sport, an empty schedule, or week values that are
 * not weeks. Callers must handle that; there is no fallback week on purpose.
 */
export async function resolveSportWeek(
  sport: string,
  seasonYear: number,
  deps: SeasonWeekDeps = {},
): Promise<SportWeekResolution> {
  const db = deps.prisma ?? defaultPrisma
  const now = deps.now ?? new Date()
  const scheduleSport = toScheduleSportKey(sport)

  if (!sportHasWeekSignal(scheduleSport)) {
    return { ok: false, reason: 'NO_WEEK_SIGNAL' }
  }

  const rows = (await db.sportsGame.findMany({
    where: {
      sport: scheduleSport,
      season: seasonYear,
      startTime: {
        gte: new Date(now.getTime() - LOOKBACK_MS),
        lte: new Date(now.getTime() + LOOKAHEAD_MS),
      },
    },
    select: {
      week: true,
      seasonType: true,
      startTime: true,
      status: true,
      source: true,
      fetchedAt: true,
    },
  })) as ScheduleRow[]

  const strict = requiresExplicitSeasonType(scheduleSport)
  const regularOnly = rows.filter((row) => {
    const type = normalizeSeasonType(row.seasonType)
    if (type === 'regular') return true
    return type == null && !strict
  })

  // Distinguish "no schedule at all" from "a schedule with no regular-season
  // rows we can trust": the first is a data outage, the second is a labelling
  // gap, and a caller chasing one should not be shown the other's reason.
  if (rows.length > 0 && regularOnly.length === 0) {
    return { ok: false, reason: 'NO_DATED_ROWS' }
  }

  return resolveSportWeekFromSchedule(regularOnly, now)
}

/**
 * What week a specific redraft season is on.
 *
 * This is the function the week roller, the guillotine week signal and
 * `processAllActiveLeaguesForWeek` all need and none of them has: a per-league
 * answer derived from that league's own sport, season and shape, rather than one
 * global week applied to every league at once.
 */
export async function resolveSeasonWeekForRedraftSeason(
  seasonId: string,
  deps: SeasonWeekDeps = {},
): Promise<LeagueSeasonWeekResolution | { ok: false; reason: 'SEASON_NOT_FOUND' }> {
  const db = deps.prisma ?? defaultPrisma

  const season = await db.redraftSeason.findUnique({
    where: { id: seasonId },
    select: {
      sport: true,
      season: true,
      totalWeeks: true,
      playoffStartWeek: true,
    },
  })
  if (!season) return { ok: false, reason: 'SEASON_NOT_FOUND' }

  const lastPlayoffWeek = await resolveLastPlayoffWeek(db, seasonId, season.playoffStartWeek)

  const sportWeek = await resolveSportWeek(season.sport, season.season, deps)
  return mapSportWeekToLeagueWeek(sportWeek, {
    sport: season.sport,
    seasonYear: season.season,
    totalWeeks: season.totalWeeks,
    playoffStartWeek: season.playoffStartWeek,
    lastPlayoffWeek: lastPlayoffWeek ?? undefined,
  })
}

/**
 * The league's final playoff week, read from the bracket rather than assumed.
 *
 * ⚠ `RedraftPlayoffRound` HAS NO `week` COLUMN — it stores a 1-based
 * `roundNumber`, and the week is derived. The mapping is
 * `week = playoffStartWeek + roundNumber - 1`, which is the same arithmetic the
 * shipped commissioner control already uses to decide which week to advance
 * (`StandingsView.tsx:122`: `playoffStartWeek + activeRoundIndex`, 0-based
 * there). Deriving it a second, different way here is exactly the "two
 * implementations of one rule" bug, so it matches that one deliberately.
 *
 * Returns null when no bracket has been generated — the normal case before the
 * regular season ends, and why `mapSportWeekToLeagueWeek` will not emit
 * `season_complete` without it.
 */
async function resolveLastPlayoffWeek(
  db: PrismaClient,
  seasonId: string,
  playoffStartWeek: number,
): Promise<number | null> {
  const round = await db.redraftPlayoffRound.findFirst({
    where: { seasonId },
    orderBy: { roundNumber: 'desc' },
    select: { roundNumber: true },
  })
  if (round == null) return null
  return playoffStartWeek + Math.max(1, round.roundNumber) - 1
}
