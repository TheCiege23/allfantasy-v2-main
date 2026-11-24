/**
 * What the Matchup tab shows beside an NBA player for the fantasy week: who his club plays next and
 * when, home or away, how many games it has in the week, his club's crest and how the next opponent
 * has fared against his position this season. The NFL has `loadNflRosterOutlook`; an NBA league
 * showed none of it (owner report, 2026-11-24, on an NBA Survivor and an NBA zombie league).
 *
 * Returns the NFL outlook's shape so the screen draws both the same way. Projection, headshot, bye
 * week and weather are left empty: the matchup has its own projection and photo reads, and the NBA
 * has no byes or weather.
 *
 * Every part is best-effort; a failed part leaves that part empty and the rest standing.
 */
import 'server-only'
import { Prisma, type PrismaClient } from '@prisma/client'
import { readWeekGames } from '@/lib/redraft/weekGames'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { getStoredTeamLogoResolver } from '@/lib/sport-teams/storedTeamLogos'
import { nbaTeamKey } from '@/lib/roster-lineup-engine/lineupLockService'
import { rankDefensesVsPosition, type AllowedRow, type NflPlayerOutlook, type OpponentRank } from './nflRosterOutlookModel'
import { NBA_RANKED_POSITIONS, nbaNextGame, nbaPrimaryPosition, nbaRankingPoints } from './nbaRosterOutlookModel'

type Db = Pick<PrismaClient, '$queryRaw'> & Parameters<typeof readWeekGames>[0]

const RANKS_TTL_MS = 30 * 60_000
const ranksCache = new Map<string, { at: number; ranks: Map<string, OpponentRank> }>()

/**
 * Each NBA defense's rank against each position, from this season's games before `before` (an Eastern
 * calendar day, the key `player_game_stats.game_date` is stored in). Cached 30 minutes.
 *
 * Box scores carry the Rolling Insights player id (`provider_player_id`); the position comes from that
 * player's Rolling Insights row. One line per player per game (`distinct on`), as the live sync can
 * write a game more than once.
 */
export async function loadNbaDefenseVsPositionRanks(db: Pick<PrismaClient, '$queryRaw'>, season: number, before: Date, now = Date.now()): Promise<Map<string, OpponentRank>> {
  const day = before.toISOString().slice(0, 10)
  const key = `${season}:${day}`
  const hit = ranksCache.get(key)
  if (hit && now - hit.at < RANKS_TTL_MS) return hit.ranks
  const rows = await db.$queryRaw<Array<{ defense: string | null; position: string | null; gameDate: string; stats: Record<string, unknown> | null }>>(Prisma.sql`
    select distinct on (g.provider_player_id, g.game_date)
      upper(g.opponent) as defense, sp.position as position, g.game_date::text as "gameDate", g.normalized_stat_map->'stats' as stats
    from player_game_stats g
    join "SportsPlayer" sp on sp.sport = 'NBA' and sp.source = 'rolling_insights' and sp."externalId" = g.provider_player_id
    where g."sportType" = 'NBA' and g.season = ${season} and g.game_date < ${day}::date
      and g.opponent is not null and g.provider_player_id is not null
    order by g.provider_player_id, g.game_date, g.fetched_at desc nulls last`)
  const allowed: AllowedRow[] = []
  for (const r of rows) {
    const points = nbaRankingPoints(r.stats)
    const defense = nbaTeamKey(r.defense)
    const position = nbaPrimaryPosition(r.position)
    if (points == null || !defense || !position) continue
    // A game is identified by its day: the ranker counts distinct `week`s as games.
    allowed.push({ defense, position, week: Math.floor(Date.parse(`${r.gameDate}T00:00:00Z`) / 86_400_000), points })
  }
  const ranks = rankDefensesVsPosition(allowed, NBA_RANKED_POSITIONS)
  ranksCache.set(key, { at: now, ranks })
  return ranks
}

export function clearNbaRosterOutlookCache(): void {
  ranksCache.clear()
}

export async function loadNbaRosterOutlook(
  db: Db,
  args: {
    league: { sport: string | null; season: number | null }
    players: ReadonlyArray<{ id: string; team: string | null; position: string | null }>
    week: number
    now?: Date
  },
): Promise<Map<string, NflPlayerOutlook>> {
  const out = new Map<string, NflPlayerOutlook>()
  const sport = String(args.league.sport ?? '').toUpperCase()
  const season = Number(args.league.season)
  if (sport !== 'NBA' || !Number.isInteger(season) || args.players.length === 0) return out
  const window = resolveDailySportWeekWindow('NBA', season, args.week)
  if (!window) return out
  const now = args.now ?? new Date()

  const [games, logoOf, ranks] = await Promise.all([
    readWeekGames(db, { sport: 'NBA', season, week: args.week, seasonType: 'regular', dateWindow: window, now }).catch(() => []),
    getStoredTeamLogoResolver('NBA').catch(() => (() => null) as (t: string | null | undefined) => string | null),
    loadNbaDefenseVsPositionRanks(db, season, window.start).catch(() => new Map<string, OpponentRank>()),
  ])

  for (const p of args.players) {
    const next = nbaNextGame(games, p.team, now)
    const position = nbaPrimaryPosition(p.position)
    const crest = logoOf(p.team)
    // Nothing known about him (no schedule stored, no crest): no outlook, rather than an empty one.
    if (!next && !crest && games.length === 0) continue
    out.set(p.id, {
      projectedPoints: null,
      projectionSource: null,
      opponent: next?.opponent ?? null,
      homeAway: next ? (next.home ? 'home' : 'away') : null,
      kickoffTimeIso: next ? next.at.toISOString() : null,
      opponentRank: next ? ranks.get(`${next.opponent}|${position}`) ?? null : null,
      headshotUrl: null,
      teamLogoUrl: crest,
      opponentLogoUrl: next ? logoOf(next.opponentName) : null,
      byeWeek: null,
      gamesThisWeek: next?.gamesThisWeek ?? (games.length > 0 ? 0 : null),
      weather: null,
    })
  }
  return out
}
