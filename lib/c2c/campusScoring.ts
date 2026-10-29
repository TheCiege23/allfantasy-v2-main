/**
 * Campus points for a native C2C football league: each team's CAMPUS starters (lib/c2c/campusLineup.ts)
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
import { campusStarterIds } from './campusLineup'
import { loadCfbWeeksForNflWeek } from './campusWeeks'

export { isFootballC2CLeague } from './campusLineup'

export type CampusTeamPoints = { points: number; players: Array<{ playerId: string; points: number }> }
export type CampusMatchupPoints = { cfbWeeks: number[]; home: CampusTeamPoints; away: CampusTeamPoints }

type CampusDb = Pick<PrismaClient, 'roster' | 'redraftRosterPlayer' | 'playerGameStat' | 'sportsGame'> & NcaafBridgeDb

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Both teams' campus points for one matchup, or null when neither team starts a college player (so a
 * C2C league that never set a campus lineup scores exactly as before).
 */
export async function campusPointsForMatchup(
  db: CampusDb,
  args: { season: number; nflWeek: number; homeRosterId: string; awayRosterId: string },
): Promise<CampusMatchupPoints | null> {
  const rosters = await db.roster.findMany({
    where: { redraftRosterId: { in: [args.homeRosterId, args.awayRosterId] } },
    select: { redraftRosterId: true, playerData: true },
  })
  const saved = (id: string) => campusStarterIds(rosters.find((r) => r.redraftRosterId === id)?.playerData ?? null)
  if (saved(args.homeRosterId).length === 0 && saved(args.awayRosterId).length === 0) return null

  // Only a college player still on the team counts (a stale campus id left by another writer does not).
  const rows = await db.redraftRosterPlayer.findMany({
    where: { rosterId: { in: [args.homeRosterId, args.awayRosterId] }, droppedAt: null, slotType: { equals: 'devy', mode: 'insensitive' } },
    select: { rosterId: true, playerId: true, position: true },
  })
  const onTeam = (rosterId: string) => {
    const held = new Set(rows.filter((r) => r.rosterId === rosterId).map((r) => r.playerId))
    return saved(rosterId).filter((id) => held.has(id))
  }
  const home = onTeam(args.homeRosterId)
  const away = onTeam(args.awayRosterId)
  const positionOf = new Map(rows.map((r) => [r.playerId, r.position]))

  const empty = (ids: string[]): CampusTeamPoints => ({ points: 0, players: ids.map((playerId) => ({ playerId, points: 0 })) })
  const cfbWeeks = await loadCfbWeeksForNflWeek(db, { season: args.season, nflWeek: args.nflWeek })
  const all = [...new Set([...home, ...away])]
  if (cfbWeeks.length === 0 || all.length === 0) return { cfbWeeks, home: empty(home), away: empty(away) }

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
  const team = (ids: string[]): CampusTeamPoints => {
    const players = ids.map((playerId) => ({ playerId, points: pointsFor(playerId) }))
    return { points: round2(players.reduce((s, p) => s + p.points, 0)), players }
  }
  return { cfbWeeks, home: team(home), away: team(away) }
}
