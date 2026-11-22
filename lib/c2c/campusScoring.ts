/**
 * Campus points for a native C2C league. Football first; basketball (NBA C2C) at the end of the file.
 *
 * Football: each team's CAMPUS starters (lib/c2c/campusLineup.ts)
 * scored from the college games played in this NFL week's calendar window (lib/c2c/campusWeeks.ts), and
 * ADDED to the team's pro score — one total, one result per week (owner's decision, 2026-10-29: the
 * league's default "unified" standings model).
 *
 * The points come from the same evidence the NCAAF weekly sync reads: CFBD game rows
 * (`player_game_stats`, through the roster-id → CFBD-id bridge) aggregated by `aggregateNcaafWeek` and
 * scored with the college football defaults (PPR, the C2C config's default `collegeScoringSystem`). They
 * are computed here rather than written to `player_weekly_scores`, whose (player, week, season, sport) row
 * is shared by every league: an NCAAF league writes it under the COLLEGE week, and a C2C league counts a
 * college week inside a different NFL week.
 *
 * A campus starter with no game row scores 0 (a bye, a quiet game, the season over), and after the
 * college season every NFL week has no college weeks, so the pro lineup decides the matchup.
 */
import type { PrismaClient } from '@prisma/client'
import { aggregateNcaafWeek } from '@/lib/scoring-runtime/ncaafStatNormalization'
import { bridgeNcaafRosterIdsToCfbdIds, type NcaafBridgeDb } from '@/lib/redraft/ncaafGameLogIdBridge'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { bridgeRosterIdsToGameLogIds, type IdentityDb } from '@/lib/redraft/rosterGameLogIdBridge'
import { aggregateWeeklyStats, getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { ensureDailySportSeasonStart } from '@/lib/season-week/deriveDailySportSeasonStart'
import { resolveStoredSeasonType } from '@/lib/sports-data/riSeasonType'
import { campusStarterIds } from './campusLineup'
import { loadCfbWeeksForNflWeek } from './campusWeeks'

export { campusSport, isBasketballC2CLeague, isFootballC2CLeague } from './campusLineup'

export type CampusTeamPoints = { points: number; players: Array<{ playerId: string; points: number }> }
export type CampusMatchupPoints = { cfbWeeks: number[]; home: CampusTeamPoints; away: CampusTeamPoints }

type CampusDb = Pick<PrismaClient, 'roster' | 'redraftRosterPlayer' | 'playerGameStat' | 'sportsGame'> & NcaafBridgeDb
type CampusBasketballDb = Pick<PrismaClient, 'roster' | 'redraftRosterPlayer' | 'playerGameStat' | 'sportsGame' | 'sportsDataCache'> & IdentityDb

const round2 = (n: number) => Math.round(n * 100) / 100

type Starters = { home: string[]; away: string[]; positionOf: Map<string, string | null>; nameOf: Map<string, string | null> }

/**
 * Each team's campus starters still on the team (a stale campus id left by another writer does not
 * count), or null when neither team starts a college player.
 */
async function loadCampusStarters(
  db: Pick<PrismaClient, 'roster' | 'redraftRosterPlayer'>,
  args: { homeRosterId: string; awayRosterId: string },
): Promise<Starters | null> {
  const rosters = await db.roster.findMany({
    where: { redraftRosterId: { in: [args.homeRosterId, args.awayRosterId] } },
    select: { redraftRosterId: true, playerData: true },
  })
  const saved = (id: string) => campusStarterIds(rosters.find((r) => r.redraftRosterId === id)?.playerData ?? null)
  if (saved(args.homeRosterId).length === 0 && saved(args.awayRosterId).length === 0) return null

  const rows = await db.redraftRosterPlayer.findMany({
    where: { rosterId: { in: [args.homeRosterId, args.awayRosterId] }, droppedAt: null, slotType: { equals: 'devy', mode: 'insensitive' } },
    select: { rosterId: true, playerId: true, position: true, playerName: true },
  })
  const onTeam = (rosterId: string) => {
    const held = new Set(rows.filter((r) => r.rosterId === rosterId).map((r) => r.playerId))
    return saved(rosterId).filter((id) => held.has(id))
  }
  return {
    home: onTeam(args.homeRosterId),
    away: onTeam(args.awayRosterId),
    positionOf: new Map(rows.map((r) => [r.playerId, r.position])),
    nameOf: new Map(rows.map((r) => [r.playerId, r.playerName ?? null])),
  }
}

const zeroTeam = (ids: string[]): CampusTeamPoints => ({ points: 0, players: ids.map((playerId) => ({ playerId, points: 0 })) })

function teamPoints(ids: string[], pointsFor: (playerId: string) => number): CampusTeamPoints {
  const players = ids.map((playerId) => ({ playerId, points: pointsFor(playerId) }))
  return { points: round2(players.reduce((sum, p) => sum + p.points, 0)), players }
}

/**
 * Both teams' campus points for one football matchup, or null when neither team starts a college
 * player (so a C2C league that never set a campus lineup scores exactly as before).
 */
export async function campusPointsForMatchup(
  db: CampusDb,
  args: { season: number; nflWeek: number; homeRosterId: string; awayRosterId: string },
): Promise<CampusMatchupPoints | null> {
  const starters = await loadCampusStarters(db, args)
  if (!starters) return null
  const { home, away, positionOf } = starters

  const cfbWeeks = await loadCfbWeeksForNflWeek(db, { season: args.season, nflWeek: args.nflWeek })
  const all = [...new Set([...home, ...away])]
  if (cfbWeeks.length === 0 || all.length === 0) return { cfbWeeks, home: zeroTeam(home), away: zeroTeam(away) }

  const bridge = await bridgeNcaafRosterIdsToCfbdIds(db, all, 'pool')
  const gameRows = bridge.cfbdIds.length
    ? await db.playerGameStat.findMany({
        where: { playerId: { in: bridge.cfbdIds }, sportType: { in: ['NCAAF', 'ncaaf'] }, season: args.season, weekOrRound: { in: cfbWeeks } },
        select: { playerId: true, weekOrRound: true, normalizedStatMap: true },
      })
    : []
  // roster id → college week → that week's game rows
  const byPlayer = new Map<string, Map<number, unknown[]>>()
  for (const row of gameRows) {
    const rosterId = bridge.rosterIdFor(row.playerId)
    if (!rosterId || row.weekOrRound == null) continue
    const weeks = byPlayer.get(rosterId) ?? new Map<number, unknown[]>()
    weeks.set(row.weekOrRound, [...(weeks.get(row.weekOrRound) ?? []), row.normalizedStatMap])
    byPlayer.set(rosterId, weeks)
  }

  const scorer = buildLeagueStatScorer({ sport: 'NCAAF', settings: null })
  const pointsFor = (playerId: string): number => {
    if (!scorer) return 0
    let total = 0
    for (const weekRows of byPlayer.get(playerId)?.values() ?? []) {
      const week = aggregateNcaafWeek(weekRows)
      if (week.gamesCounted > 0) total += scorer(week.stats, positionOf.get(playerId) ?? null)
    }
    return round2(total)
  }
  return { cfbWeeks, home: teamPoints(home, pointsFor), away: teamPoints(away, pointsFor) }
}

export type CampusBasketballMatchupPoints = {
  /** The NBA week's `[start, end)` dates (ISO) the college games were read from; null when it cannot be told. Stored on the matchup snapshot. */
  window: { start: string; end: string } | null
  home: CampusTeamPoints
  away: CampusTeamPoints
}

const NCAAB_KEYS = ['NCAAB', 'ncaab']

/**
 * Both teams' campus points for one NBA C2C matchup: each campus starter's college games played inside
 * the NBA week's dates (`resolveDailySportWeekWindow`, the window NBA box scores are scored over), from
 * the NCAAB `player_game_stats` rows the Rolling Insights live ingest writes. Roster ids reach those rows
 * through the identity bridge every daily sport uses (lib/redraft/rosterGameLogIdBridge.ts). Scored with
 * the college basketball defaults. A preseason row does not count; neither does a starter with no game.
 * Null when neither team starts a college player.
 */
export async function campusBasketballPointsForMatchup(
  db: CampusBasketballDb,
  args: { season: number; week: number; homeRosterId: string; awayRosterId: string },
): Promise<CampusBasketballMatchupPoints | null> {
  const starters = await loadCampusStarters(db, args)
  if (!starters) return null
  const { home, away, positionOf, nameOf } = starters

  await ensureDailySportSeasonStart('NBA', args.season, { db: db as never }).catch(() => null)
  const dates = resolveDailySportWeekWindow('NBA', args.season, args.week)
  const window = dates ? { start: dates.start.toISOString(), end: dates.end.toISOString() } : null
  const all = [...new Set([...home, ...away])]
  if (!dates || all.length === 0) return { window, home: zeroTeam(home), away: zeroTeam(away) }

  const bridge = await bridgeRosterIdsToGameLogIds(db, NCAAB_KEYS, all, nameOf)
  const gameRows = bridge.gameLogIds.length
    ? await db.playerGameStat.findMany({
        where: { playerId: { in: bridge.gameLogIds }, sportType: { in: NCAAB_KEYS }, gameDate: { gte: dates.start, lt: dates.end } },
        select: { playerId: true, normalizedStatMap: true, sportType: true, season: true, gameDate: true },
      })
    : []
  const byPlayer = new Map<string, unknown[]>()
  for (const row of gameRows) {
    if (resolveStoredSeasonType({ normalizedStatMap: row.normalizedStatMap, sport: row.sportType, season: row.season, gameDate: row.gameDate }) === 'pre') continue
    const rosterId = bridge.rosterIdFor(row.playerId)
    if (!rosterId) continue
    byPlayer.set(rosterId, [...(byPlayer.get(rosterId) ?? []), row.normalizedStatMap])
  }

  const normalizer = getDailySportNormalizer('NCAAB')
  const scorer = buildLeagueStatScorer({ sport: 'NCAAB', settings: null })
  const pointsFor = (playerId: string): number => {
    const rows = byPlayer.get(playerId)
    if (!scorer || !normalizer || !rows?.length) return 0
    const week = aggregateWeeklyStats(rows, normalizer)
    return week.gamesCounted > 0 ? round2(scorer(week.stats, positionOf.get(playerId) ?? null)) : 0
  }
  return { window, home: teamPoints(home, pointsFor), away: teamPoints(away, pointsFor) }
}
