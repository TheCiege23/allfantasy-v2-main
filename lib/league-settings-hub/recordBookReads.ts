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
 * STAT CORRECTIONS: per week, whether its scores are final (past the correction window), when it
 * was rescored, and — for native leagues in the sports the check covers — WHICH players changed and
 * by how much. That last part is the stat-correction detector's own stored review
 * (lib/stat-corrections/statCorrectionDetector, a `sportsDataCache` row per sealed week holding each
 * changed starter's before / after points), the same record the commissioner's Apply card reads.
 *
 * ⚠ This module once said no per-player before/after record existed and that showing one needed a
 * migration. That was wrong: the detector had been storing it all along. The weekly score rows are
 * still overwritten in place — the review is the only "before", which is why it is read here rather
 * than reconstructed.
 */

import type { PrismaClient } from '@prisma/client'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { NATIVE_PLAYER_SCORE_SOURCE } from '@/lib/redraft/nativePlayerWeeklyScores'
import { loadStoryData } from '@/lib/storyline-studio/loadStoryData'
import { readStoredReview, STAT_CORRECTION_SPORTS, statCorrectionCacheKeyPrefix } from '@/lib/stat-corrections/statCorrectionDetector'
import {
  attachCorrectionChanges,
  summarizeCorrectionWeeks,
  type CorrectionChange,
  topPlayerScores,
  topTeamScores,
  type CorrectionWeek,
  type PlayerHighScoreRow,
  type TeamHighScoreRow,
} from './recordBookModel'

/**
 * Player AND team high scores from one `loadStoryData` read. Team rows come from final
 * head-to-head results (the same fixtures Storyline Studio reads), so a league whose record-book
 * engine has not run still has team highs. Each list carries the seasons it actually covers.
 */
export async function loadPlayerHighScores(
  prisma: PrismaClient,
  leagueId: string,
  limit = 10,
): Promise<{ seasons: number[]; rows: PlayerHighScoreRow[]; teamSeasons: number[]; teamRows: TeamHighScoreRow[] } | null> {
  const loaded = await loadStoryData(prisma, leagueId)
  if (!loaded) return null
  const desc = (xs: number[]) => [...new Set(xs)].sort((a, b) => b - a)
  return {
    seasons: desc(loaded.data.playerWeeks.map((w) => w.season)),
    rows: topPlayerScores(loaded.data, limit),
    teamSeasons: desc(loaded.data.fixtures.filter((f) => f.final).map((f) => f.season)),
    teamRows: topTeamScores(loaded.data, limit),
  }
}

export async function loadCorrectionWeeks(
  prisma: PrismaClient,
  leagueId: string,
): Promise<{ season: number; weeks: CorrectionWeek[] } | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { platform: true, platformLeagueId: true, season: true, sport: true },
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
  const covered = native && STAT_CORRECTION_SPORTS.has(String(league.sport ?? '').toUpperCase())
  const [groups, reprocessed, reviews] = await Promise.all([
    scoreWhere
      ? prisma.leaguePlayerWeeklyScore.groupBy({ by: ['week', 'isFinalized'], where: scoreWhere, _count: { _all: true } })
      : Promise.resolve([] as Array<{ week: number; isFinalized: boolean; _count: { _all: number } }>),
    prisma.statReprocessLog.findMany({ where: { leagueId, season }, select: { week: true, createdAt: true } }),
    covered ? loadCorrectionReviews(prisma, leagueId, season) : Promise.resolve([]),
  ])
  const weeks = summarizeCorrectionWeeks(
    groups.map((g) => ({ week: g.week, isFinalized: g.isFinalized, count: g._count._all })),
    reprocessed,
  )
  return { season, weeks: attachCorrectionChanges(weeks, reviews) }
}

/**
 * The detector's stored review for each checked week of this season, with team names. Keyed on the
 * league's RedraftSeason id exactly as statCorrectionDetector writes it, and filtered to this league
 * as statCorrectionService.readStatCorrections does — the two readers of one record must agree.
 */
async function loadCorrectionReviews(
  prisma: PrismaClient,
  leagueId: string,
  season: number,
): Promise<Array<{ week: number; changes: CorrectionChange[] }>> {
  const seasonRow = await prisma.redraftSeason.findFirst({ where: { leagueId, season }, select: { id: true } })
  if (!seasonRow) return []
  const rows = await prisma.sportsDataCache.findMany({
    where: { cacheKey: { startsWith: statCorrectionCacheKeyPrefix(seasonRow.id) } },
    select: { data: true },
  })
  const stored = rows
    .map((r) => readStoredReview(r.data))
    .filter((r): r is NonNullable<typeof r> => r !== null && r.leagueId === leagueId)
  if (!stored.length) return []
  const rosterIds = [...new Set(stored.flatMap((s) => s.review.changes.map((c) => c.rosterId)))]
  const rosters = rosterIds.length
    ? await prisma.redraftRoster.findMany({ where: { id: { in: rosterIds }, leagueId }, select: { id: true, teamName: true, ownerName: true } })
    : []
  const names = new Map(rosters.map((r) => [r.id, r.teamName?.trim() || r.ownerName || 'Team']))
  return stored.map((s) => ({
    week: s.week,
    changes: s.review.changes.map((c) => ({
      player: c.playerName,
      position: c.position,
      team: names.get(c.rosterId) ?? 'Team',
      before: c.before,
      after: c.after,
      delta: c.delta,
    })),
  }))
}
