/**
 * Record Book reads for the League Settings hub — player high scores and the stat-correction
 * status of each week. Postgres only (scripts/check-db-first-api-boundary.mjs): no provider call.
 *
 * PLAYER HIGH SCORES come from `loadStoryData`, NOT from a second reader of
 * `league_player_weekly_scores`. That loader already solves the parts that are easy to get wrong —
 * imported rows keyed on each season's PROVIDER league id with historical roster ids remapped onto
 * today's teams, native rows keyed on our League.id with a hashed roster seat, ambiguous mappings
 * dropped rather than guessed, finalized weeks only, and player names. Two implementations of that
 * mapping is the bug; reusing it is the fix. Its window is this season and last, so the card says so.
 *
 * STAT CORRECTIONS: no table records a player's points BEFORE a correction — the weekly score rows
 * are overwritten in place and `stat_reprocess_logs` only marks that a week was rescored. So this
 * reports what IS stored: per week, whether its scores are final (past the correction window) and
 * when it was rescored after corrections. A per-player old → new log needs a new table, which is a
 * migration, which is the owner's decision — not something to approximate here.
 */

import type { PrismaClient } from '@prisma/client'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { NATIVE_PLAYER_SCORE_SOURCE } from '@/lib/redraft/nativePlayerWeeklyScores'
import { loadStoryData } from '@/lib/storyline-studio/loadStoryData'
import { summarizeCorrectionWeeks, topPlayerScores, type CorrectionWeek, type PlayerHighScoreRow } from './recordBookModel'

export async function loadPlayerHighScores(
  prisma: PrismaClient,
  leagueId: string,
  limit = 10,
): Promise<{ seasons: number[]; rows: PlayerHighScoreRow[] } | null> {
  const loaded = await loadStoryData(prisma, leagueId)
  if (!loaded) return null
  const seasons = [...new Set(loaded.data.playerWeeks.map((w) => w.season))].sort((a, b) => b - a)
  return { seasons, rows: topPlayerScores(loaded.data, limit) }
}

export async function loadCorrectionWeeks(
  prisma: PrismaClient,
  leagueId: string,
): Promise<{ season: number; weeks: CorrectionWeek[] } | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { platform: true, platformLeagueId: true, season: true },
  })
  if (!league) return null
  const season = league.season
  const native = isNativePlatform(league.platform)
  // Same keys the writers use: native rows on OUR id with the 'allfantasy' source, imported rows on
  // the provider's league id for this season (lib/redraft/nativePlayerWeeklyScores.ts).
  const scoreWhere = native
    ? { leagueId, source: NATIVE_PLAYER_SCORE_SOURCE, seasonYear: season }
    : league.platformLeagueId
      ? { leagueId: league.platformLeagueId, seasonYear: season }
      : null
  const [groups, reprocessed] = await Promise.all([
    scoreWhere
      ? prisma.leaguePlayerWeeklyScore.groupBy({ by: ['week', 'isFinalized'], where: scoreWhere, _count: { _all: true } })
      : Promise.resolve([] as Array<{ week: number; isFinalized: boolean; _count: { _all: number } }>),
    prisma.statReprocessLog.findMany({ where: { leagueId, season }, select: { week: true, createdAt: true } }),
  ])
  return {
    season,
    weeks: summarizeCorrectionWeeks(
      groups.map((g) => ({ week: g.week, isFinalized: g.isFinalized, count: g._count._all })),
      reprocessed,
    ),
  }
}
