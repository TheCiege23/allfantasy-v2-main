import 'server-only'
import { Prisma, type PrismaClient } from '@prisma/client'
import { buildNextGameMap } from '@/lib/core-app/nextGameMap'
import { rosterIdSpaceOf } from '@/lib/core-app/rosterIdSpace'
import { teamLogoUrl } from '@/lib/core-app/teamLogo'
import { loadMatchupAfProjections } from '@/lib/matchup-center/afProjections'
import { buildHeadshotUrl } from '@/lib/player-media-urls'
import { getTeamInfo, normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { getGameWeather } from '@/lib/core-app/gameWeather'
import { byeWeeksFromSchedule, rankDefensesVsPosition, type AllowedRow, type NflPlayerOutlook, type OpponentRank, type RosterGameWeather, type SeasonFixture } from './nflRosterOutlookModel'

/**
 * The week's outlook for the NFL players on a roster, read from what is already stored. No provider
 * is called: projections from `fantasy_projections` (the AF engine, in this league's scoring), the
 * fixture from `SportsGame`, defense-versus-position from `player_game_stats`.
 *
 * Returns an empty map, never throws, for any league that is not NFL in Sleeper's id space, and for
 * any part that fails: a roster with no outlook is the screen as it was.
 */

type Db = Pick<PrismaClient, 'redraftSeason' | 'sportsGame' | 'sportsPlayerRecord' | '$queryRaw'>

export type NflRosterOutlookArgs = {
  league: { id: string; sport: string | null; season: number | null; platform: string | null; settings: unknown }
  players: ReadonlyArray<{ id: string; team: string | null; position: string | null }>
  /** The week to show. Defaults to the week the league's own season is on. */
  week?: number | null
}

const RANKS_TTL_MS = 30 * 60_000
const OFF_SEASON_TYPES = ['pre', 'preseason', 'post', 'postseason']
const ranksCache = new Map<string, { at: number; ranks: Map<string, OpponentRank> }>()

/** Every defense's rank against every position, from the season's games before `week`. Cached 30 min. */
export async function loadDefenseVsPositionRanks(db: Pick<Db, '$queryRaw'>, season: number, week: number, now = Date.now()): Promise<Map<string, OpponentRank>> {
  const key = `${season}:${week}`
  const hit = ranksCache.get(key)
  if (hit && now - hit.at < RANKS_TTL_MS) return hit.ranks
  // A stored player row is keyed "NFL:<id>"; a game line carries the bare id.
  const rows = await db.$queryRaw<Array<{ defense: string | null; position: string | null; week: number; points: number | null }>>(Prisma.sql`
    select upper(g.opponent) as defense, upper(p.position) as position, g."weekOrRound" as week, sum(g."fantasyPoints")::float8 as points
    from player_game_stats g
    join sports_players p on p.id = 'NFL:' || g."playerId" and p.sport = 'NFL'
    where g."sportType" = 'NFL' and g.season = ${season} and g."weekOrRound" < ${week}
      and g.opponent is not null and upper(p.position) in ('QB', 'RB', 'WR', 'TE', 'K')
    group by 1, 2, 3`)
  const allowed: AllowedRow[] = []
  for (const r of rows) {
    const defense = normalizeTeamAbbrev(r.defense)
    if (!defense || !getTeamInfo(defense) || !r.position || r.points == null) continue
    allowed.push({ defense, position: r.position, week: Number(r.week), points: Number(r.points) })
  }
  const ranks = rankDefensesVsPosition(allowed)
  ranksCache.set(key, { at: now, ranks })
  return ranks
}

const byeCache = new Map<number, { at: number; byes: Map<string, number> }>()

/** Each club's bye week this season, from the stored regular-season schedule. Cached 30 min. */
export async function loadNflByeWeeks(db: Pick<Db, 'sportsGame'>, season: number, now = Date.now()): Promise<Map<string, number>> {
  const hit = byeCache.get(season)
  if (hit && now - hit.at < RANKS_TTL_MS) return hit.byes
  const rows = await db.sportsGame.findMany({
    where: { sport: 'NFL', season, week: { gte: 1, lte: 18 }, OR: [{ seasonType: null }, { seasonType: { notIn: OFF_SEASON_TYPES } }] },
    select: { homeTeam: true, awayTeam: true, week: true },
  })
  const fixtures: SeasonFixture[] = []
  for (const r of rows) {
    const home = normalizeTeamAbbrev(r.homeTeam)
    const away = normalizeTeamAbbrev(r.awayTeam)
    if (r.week == null || !home || !away || !getTeamInfo(home) || !getTeamInfo(away)) continue
    fixtures.push({ week: r.week, home, away })
  }
  const byes = byeWeeksFromSchedule(fixtures)
  // An empty answer is not kept: the schedule may simply not be stored yet.
  if (byes.size > 0) byeCache.set(season, { at: now, byes })
  return byes
}

export function clearNflRosterOutlookCache(): void {
  ranksCache.clear()
  byeCache.clear()
}

export async function loadNflRosterOutlook(db: Db, args: NflRosterOutlookArgs): Promise<Map<string, NflPlayerOutlook>> {
  const out = new Map<string, NflPlayerOutlook>()
  const sport = String(args.league.sport ?? '').toUpperCase()
  const season = Number(args.league.season)
  if (sport !== 'NFL' || !Number.isInteger(season) || args.players.length === 0) return out
  if (rosterIdSpaceOf(args.league.platform, sport) !== 'sleeper') return out

  let week = args.week ?? null
  if (week == null) {
    const own = await db.redraftSeason
      .findFirst({ where: { leagueId: args.league.id, season }, select: { currentWeek: true } })
      .catch(() => null)
    week = own?.currentWeek ?? null
  }
  if (week == null || !Number.isInteger(week) || week < 1) return out

  const ids = args.players.map((p) => p.id)
  // The stored row is the fresher word on a player's club and position (a traded player's roster row is not).
  const stored = await db.sportsPlayerRecord
    .findMany({ where: { sport: 'NFL', id: { in: ids.map((id) => `NFL:${id}`) } }, select: { id: true, team: true, position: true } })
    .catch(() => [] as Array<{ id: string; team: string | null; position: string | null }>)
  const storedById = new Map(stored.map((r) => [r.id.slice(4), r]))
  const facts = args.players.map((p) => {
    const s = storedById.get(p.id)
    // A team defense's id is its club code.
    const isDefense = /^[A-Z]{2,3}$/.test(p.id) && Boolean(getTeamInfo(p.id))
    const team = normalizeTeamAbbrev(isDefense ? p.id : s?.team ?? p.team)
    return { id: p.id, team: team && getTeamInfo(team) ? team : null, position: String(isDefense ? 'DEF' : s?.position ?? p.position ?? '').toUpperCase() }
  })

  const teams = new Set(facts.map((f) => f.team).filter((t): t is string => Boolean(t)))
  const [games, projections, ranks, byes] = await Promise.all([
    db.sportsGame
      .findMany({
        where: { sport: 'NFL', season, week, OR: [{ seasonType: null }, { seasonType: { notIn: OFF_SEASON_TYPES } }] },
        select: { homeTeam: true, awayTeam: true, startTime: true, seasonType: true, venue: true },
      })
      .catch(() => []),
    loadMatchupAfProjections({ leagueId: args.league.id, playerIds: ids, season, week, sport, platform: args.league.platform, leagueSettings: args.league.settings }),
    loadDefenseVsPositionRanks(db, season, week).catch(() => new Map<string, OpponentRank>()),
    loadNflByeWeeks(db, season).catch(() => new Map<string, number>()),
  ])
  const nextGame = buildNextGameMap(games, teams)
  // "Bye" is said only of a week whose schedule is stored; an empty week says nothing.
  const weekHasGames = games.some((g) => g.startTime)

  // Forecasts come from the weather cache only (a roofed stadium needs none); no provider is called.
  const hosts = new Map<string, { hostTeam: string | null; kickoff: Date | null }>()
  for (const f of facts) {
    const g = f.team ? nextGame.get(f.team) : undefined
    if (g) hosts.set(f.id, { hostTeam: g.home ? f.team : g.opponent, kickoff: g.at })
  }
  const weather: Map<string, RosterGameWeather> = await getGameWeather({ sport: 'NFL', games: hosts }).catch(() => new Map())

  for (const f of facts) {
    const game = f.team ? nextGame.get(f.team) : undefined
    const projected = projections.get(f.id)
    out.set(f.id, {
      projectedPoints: projected != null && Number.isFinite(projected) ? Math.round(projected * 100) / 100 : null,
      opponent: game ? game.opponent : f.team && weekHasGames ? 'BYE' : null,
      homeAway: game ? (game.home ? 'home' : 'away') : null,
      kickoffTimeIso: game ? game.at.toISOString() : null,
      opponentRank: game ? ranks.get(`${game.opponent}|${f.position}`) ?? null : null,
      headshotUrl: buildHeadshotUrl(f.id, 'nfl'),
      teamLogoUrl: teamLogoUrl('NFL', f.team),
      opponentLogoUrl: game ? teamLogoUrl('NFL', game.opponent) : null,
      byeWeek: f.team ? byes.get(f.team) ?? null : null,
      weather: weather.get(f.id) ?? null,
    })
  }
  return out
}
