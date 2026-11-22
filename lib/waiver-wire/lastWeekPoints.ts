import type { PrismaClient } from '@prisma/client'

import { loadActualWeeklyPoints } from '@/lib/idp-projections/actualWeeklyPoints'
import { extractScoringSettings } from '@/lib/projections/leagueScoring'
import { resolveSportWeek } from '@/lib/season-week/seasonWeekService'
import { dailySportWeekForInstant, resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { ensureDailySportSeasonStart } from '@/lib/season-week/deriveDailySportSeasonStart'
import { loadDailyWeekStats } from '@/lib/stat-corrections/dailyWeekStats'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { isDailyStatSport } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { aggregateNcaafWeek, isNcaafSport } from '@/lib/scoring-runtime/ncaafStatNormalization'
import { bridgeNcaafRosterIdsToCfbdIds } from '@/lib/redraft/ncaafGameLogIdBridge'
import { readScoringType } from '@/lib/category-scoring/leagueScoringType'

/**
 * The last completed week for a league's Players list, or null when there is none to show.
 *
 * `upcoming` is the week a projection would be for: the week in progress, or the next one once
 * this week's games are all played. The week before it is the last one whose scores are whole.
 */
export function lastCompletedWeek(upcoming: number | null | undefined): number | null {
  if (upcoming == null || !Number.isInteger(upcoming) || upcoming < 2) return null
  return upcoming - 1
}

/** A listed player, as the last-week reader needs him: the id his roster carries, and his position. */
export type LastWeekRow = { id: string; position?: string | null; name?: string | null }

/**
 * What each listed player scored in the last completed week under THIS league's scoring (owner
 * ask, 2026-11-22: Sleeper's Players list shows last week's points; ours had no such figure).
 *
 * Two readers, because the game lines are stored two ways (production, 2026-11-22):
 *
 *  - NFL: `player_game_stats` holds a line per week under the id a roster carries (the Sleeper id).
 *    Scored by `loadActualWeeklyPoints`, the same arithmetic the projection uses.
 *  - NBA, NHL, MLB, college basketball, soccer: a line per GAME, week 0, under an identity id.
 *    `loadDailyWeekStats` is the weekly score sync's own reader (week window, roster-id bridge,
 *    preseason filter, weekly sum), and the league's scorer prices the sum, so the figure is the one
 *    the matchup would have credited. Soccer's weeks are gameweeks with gaps between them, so its
 *    last week is the latest gameweek that has ended, not "this week minus one".
 *  - College football: a line per game under a CFBD athlete id, with a real week number. Read the
 *    way the weekly sync reads it (the CFBD bridge, then `aggregateNcaafWeek`). A roster id the
 *    bridge cannot place, or places on two athletes, gets no figure.
 *
 * A categories league gets no figure rather than a wrong one. A player with no line that week (bye, inactive, no game, not yet ingested) is absent from the
 * map: the screen shows a dash, never 0.0. Any failure returns null and the list is served without it.
 */
export async function loadLastWeekPoints(
  prisma: PrismaClient,
  league: { sport: string | null; season: number | null; settings: unknown },
  rows: readonly LastWeekRow[],
  now: Date = new Date(),
): Promise<{ week: number; points: Map<string, number> } | null> {
  try {
    const sport = String(league.sport ?? '').toUpperCase()
    const ids = [...new Set(rows.map((row) => row.id).filter(Boolean))]
    if (!league.season || ids.length === 0) return null
    if (sport === 'NFL') {
      const scoring = extractScoringSettings(league.settings)
      if (!scoring) return null
      const resolution = await resolveSportWeek('NFL', league.season, { now })
      if (!resolution.ok || resolution.seasonType !== 'regular') return null
      const upcoming = resolution.state === 'played' ? resolution.nextSportWeek : resolution.sportWeek
      const week = lastCompletedWeek(upcoming)
      if (week == null) return null
      const outcomes = await loadActualWeeklyPoints({ prisma, sport: 'NFL', season: league.season, week, playerIds: ids, scoring })
      const points = new Map<string, number>()
      for (const [id, outcome] of outcomes) if (outcome.scored) points.set(id, outcome.points)
      return { week, points }
    }
    if (readScoringType(league.settings).mode !== 'points') return null
    const scorer = buildLeagueStatScorer({ sport, settings: league.settings })
    if (!scorer) return null
    const positionById = new Map(rows.map((row) => [row.id, row.position ?? null]))
    if (isNcaafSport(sport)) {
      const resolution = await resolveSportWeek('NCAAF', league.season, { now })
      if (!resolution.ok || resolution.seasonType !== 'regular') return null
      const week = lastCompletedWeek(resolution.state === 'played' ? resolution.nextSportWeek : resolution.sportWeek)
      if (week == null) return null
      // The list's ids are pool ids, whatever platform the league came from.
      const bridge = await bridgeNcaafRosterIdsToCfbdIds(prisma as never, ids, 'pool')
      if (bridge.cfbdIds.length === 0) return { week, points: new Map() }
      const gameRows = await prisma.playerGameStat.findMany({
        where: { playerId: { in: bridge.cfbdIds }, sportType: { in: ['NCAAF', 'ncaaf'] }, season: league.season, weekOrRound: week },
        select: { playerId: true, normalizedStatMap: true },
      })
      const linesByRosterId = new Map<string, unknown[]>()
      for (const row of gameRows) {
        const rosterId = bridge.rosterIdFor(row.playerId)
        if (!rosterId) continue
        linesByRosterId.set(rosterId, [...(linesByRosterId.get(rosterId) ?? []), row.normalizedStatMap])
      }
      const stats = new Map<string, Record<string, number>>()
      for (const [rosterId, lines] of linesByRosterId) {
        const aggregate = aggregateNcaafWeek(lines)
        if (aggregate.gamesCounted > 0) stats.set(rosterId, aggregate.stats)
      }
      return { week, points: scoreWeekLines(stats, positionById, scorer) }
    }
    if (!isDailyStatSport(sport)) return null
    await ensureDailySportSeasonStart(sport, league.season, { db: prisma as never })
    // The week in progress is the one a manager is setting a lineup for; the one before it is whole.
    // Between soccer gameweeks there is no week in progress, so the last one that ended is found directly.
    const season = league.season
    const week =
      lastCompletedWeek(dailySportWeekForInstant(sport, season, now)) ??
      lastEndedWeek((w) => resolveDailySportWeekWindow(sport, season, w), now)
    if (week == null) return null
    const stats = await loadDailyWeekStats({
      sport,
      season: league.season,
      week,
      players: ids.map((id) => ({ playerId: id, playerName: rows.find((row) => row.id === id)?.name ?? null })),
    })
    return { week, points: scoreWeekLines(stats, positionById, scorer) }
  } catch {
    return null
  }
}

/**
 * The latest week whose window has fully ended by `now`, or null when none has. For a calendar with
 * gaps (soccer gameweeks), where "the week in progress, minus one" has no answer during a gap.
 * Stops at the first week that has not started, or that the calendar does not define.
 */
export function lastEndedWeek(windowFor: (week: number) => { start: Date; end: Date } | null, now: Date, maxWeeks = 80): number | null {
  let last: number | null = null
  for (let week = 1; week <= maxWeeks; week++) {
    const window = windowFor(week)
    if (!window || window.start.getTime() > now.getTime()) break
    if (window.end.getTime() <= now.getTime()) last = week
  }
  return last
}

/** A week's summed stat lines, priced by the league's scorer and rounded as scores are shown. */
export function scoreWeekLines(
  stats: ReadonlyMap<string, Record<string, number>>,
  positionById: ReadonlyMap<string, string | null>,
  scorer: (stats: Record<string, number>, position?: string | null) => number,
): Map<string, number> {
  const points = new Map<string, number>()
  for (const [id, line] of stats) {
    const value = scorer(line, positionById.get(id) ?? null)
    if (Number.isFinite(value)) points.set(id, Math.round(value * 100) / 100)
  }
  return points
}

/** Whose roster a listed player is on. `mine` is the viewer's own team. */
export type RosteredBy = { mine: boolean; team: string | null; rosterId: string }

/**
 * Every rostered player id in a league, mapped to the team that holds it.
 *
 * A team's name is its `LeagueTeam` row, joined the way the waiver run does it (the roster's
 * `platformUserId` is that row's `externalId`). A team with no such row is named null and the
 * screen says "Rostered".
 */
export function rosterOwnership(
  rosters: ReadonlyArray<{ id: string; platformUserId?: string | null; playerIds: readonly string[] }>,
  teams: ReadonlyArray<{ externalId: string; teamName?: string | null; ownerName?: string | null }>,
  myRosterId: string | null,
): Map<string, RosteredBy> {
  const nameByExternalId = new Map<string, string>()
  for (const team of teams) {
    const name = String(team.teamName ?? '').trim() || String(team.ownerName ?? '').trim()
    if (name) nameByExternalId.set(team.externalId, name)
  }
  const out = new Map<string, RosteredBy>()
  for (const roster of rosters) {
    const by: RosteredBy = {
      mine: myRosterId != null && roster.id === myRosterId,
      team: (roster.platformUserId ? nameByExternalId.get(roster.platformUserId) : undefined) ?? null,
      rosterId: roster.id,
    }
    for (const id of roster.playerIds) if (!out.has(id)) out.set(id, by)
  }
  return out
}
