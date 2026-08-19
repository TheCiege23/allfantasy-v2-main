import 'server-only'

import { prisma } from '@/lib/prisma'
import { describeAge, availableFor, type DataClass } from './freshnessPolicy'

/**
 * The read side of the sports data boundary.
 *
 * Every surface reads sports data through here, and here reads only the database.
 * No function in this file calls a provider — that is the whole point. Ingestion
 * (lib/sports-data/theSportsDbIngest.ts, the ESPN injury writer, the score
 * collectors) writes to sports_teams / sports_games / sports_players /
 * player_season_stats on a schedule set by freshnessPolicy; surfaces read what is
 * there.
 *
 * Why this matters beyond tidiness: a page that calls TheSportsDB itself inherits
 * the provider's latency and rate limit on the request path, and renders blank
 * when the provider blips. It also silently bypasses everything the ingester
 * normalises — dead endpoints, per-league season formats, coaches filed as
 * players.
 *
 * Every result carries `freshness`, because the design handoff requires the
 * last-sync age to be shown and to warn when stale "rather than silently showing
 * old numbers". A caller cannot render this data without being handed its age.
 */

export type Freshness = {
  label: string
  stale: boolean
  fetchedAt: Date | null
}

export type Sourced<T> = {
  data: T
  freshness: Freshness
  /** False when the provider does not serve this class for this sport at all. */
  supported: boolean
}

function freshnessOf(dataClass: DataClass, fetchedAt: Date | null): Freshness {
  const d = describeAge(dataClass, fetchedAt)
  return { label: d.label, stale: d.stale, fetchedAt: fetchedAt ?? null }
}

function newest(rows: Array<{ fetchedAt: Date | null }>): Date | null {
  let latest: Date | null = null
  for (const r of rows) {
    if (r.fetchedAt && (!latest || r.fetchedAt > latest)) latest = r.fetchedAt
  }
  return latest
}

// ── Teams ──────────────────────────────────────────────────────────────

export type TeamView = {
  id: string
  externalId: string
  name: string
  shortName: string | null
  city: string | null
  division: string | null
  logo: string | null
  primaryColor: string | null
}

export async function getTeams(sport: string): Promise<Sourced<TeamView[]>> {
  const rows = await prisma.sportsTeam.findMany({
    where: { sport },
    orderBy: { name: 'asc' },
    select: {
      id: true, externalId: true, name: true, shortName: true,
      city: true, division: true, logo: true, primaryColor: true, fetchedAt: true,
    },
  })
  return {
    data: rows.map(({ fetchedAt: _f, ...t }) => t),
    freshness: freshnessOf('team_identity', newest(rows)),
    supported: availableFor(sport).team_identity,
  }
}

// ── Games ──────────────────────────────────────────────────────────────

export type GameView = {
  externalId: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: string | null
  startTime: Date | null
  venue: string | null
  week: number | null
  season: number | null
}

export type GameQuery = {
  sport: string
  season?: number
  /** Only games kicking off from this instant onward. */
  from?: Date
  /** Only games kicking off up to this instant. */
  to?: Date
  limit?: number
}

export async function getGames(q: GameQuery): Promise<Sourced<GameView[]>> {
  const rows = await prisma.sportsGame.findMany({
    where: {
      sport: q.sport,
      ...(q.season != null ? { season: q.season } : {}),
      ...(q.from || q.to
        ? { startTime: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
        : {}),
    },
    orderBy: { startTime: 'asc' },
    take: q.limit ?? 500,
    select: {
      externalId: true, homeTeam: true, awayTeam: true, homeScore: true, awayScore: true,
      status: true, startTime: true, venue: true, week: true, season: true, fetchedAt: true,
    },
  })
  return {
    data: rows.map(({ fetchedAt: _f, ...g }) => g),
    freshness: freshnessOf('current_schedule', newest(rows)),
    supported: true,
  }
}

/**
 * Games currently in progress.
 *
 * Derived from stored status rather than by asking the provider, so a surface
 * showing "live" is showing what the last live-score ingest actually recorded —
 * and its age is attached so a stalled poller reads as stale rather than as a
 * game frozen at 0-0.
 */
export async function getLiveGames(sport: string): Promise<Sourced<GameView[]>> {
  const rows = await prisma.sportsGame.findMany({
    where: {
      sport,
      status: { notIn: ['Not Started', 'Match Finished', 'Final', 'FT', 'Postponed', 'Cancelled'] },
      startTime: { lte: new Date() },
    },
    orderBy: { startTime: 'asc' },
    take: 100,
    select: {
      externalId: true, homeTeam: true, awayTeam: true, homeScore: true, awayScore: true,
      status: true, startTime: true, venue: true, week: true, season: true, fetchedAt: true,
    },
  })
  return {
    data: rows.map(({ fetchedAt: _f, ...g }) => g),
    freshness: freshnessOf('live_scores', newest(rows)),
    supported: availableFor(sport).live_scores,
  }
}

// ── Players ────────────────────────────────────────────────────────────

export type PlayerView = {
  externalId: string
  name: string
  position: string | null
  team: string | null
  number: number | null
  age: number | null
  height: string | null
  weight: string | null
  imageUrl: string | null
  status: string | null
}

export async function getPlayers(
  sport: string,
  opts?: { team?: string; search?: string; limit?: number }
): Promise<Sourced<PlayerView[]>> {
  const rows = await prisma.sportsPlayer.findMany({
    where: {
      sport,
      ...(opts?.team ? { team: opts.team } : {}),
      ...(opts?.search ? { name: { contains: opts.search, mode: 'insensitive' as const } } : {}),
    },
    orderBy: { name: 'asc' },
    take: opts?.limit ?? 200,
    select: {
      externalId: true, name: true, position: true, team: true, number: true,
      age: true, height: true, weight: true, imageUrl: true, status: true, fetchedAt: true,
    },
  })
  return {
    data: rows.map(({ fetchedAt: _f, ...p }) => p),
    // College rosters are not real depth charts (20 players across 231 NCAAF
    // teams), so `supported` is false there and a caller can say so rather than
    // rendering a near-empty roster as if it were complete.
    freshness: freshnessOf('roster', newest(rows)),
    supported: availableFor(sport).roster,
  }
}

export type SeasonStatLine = {
  season: string
  team: string | null
  position: string | null
  stats: Record<string, string>
}

export async function getPlayerSeasonStats(
  sport: string,
  playerExternalId: string
): Promise<Sourced<SeasonStatLine[]>> {
  const rows = await prisma.playerSeasonStats.findMany({
    where: { sport, playerId: playerExternalId },
    orderBy: { season: 'desc' },
    select: { season: true, team: true, position: true, stats: true, fetchedAt: true },
  })
  return {
    data: rows.map((r) => ({
      season: r.season,
      team: r.team,
      position: r.position,
      stats: (r.stats ?? {}) as Record<string, string>,
    })),
    freshness: freshnessOf('player_season_stats', newest(rows)),
    supported: availableFor(sport).player_season_stats,
  }
}

// ── Coverage, for surfaces that must not promise what is absent ────────

export type SportCoverage = {
  sport: string
  teams: number
  games: number
  players: number
  /** Data classes this sport genuinely has, from the freshness policy. */
  available: ReturnType<typeof availableFor>
}

export async function getCoverage(sport: string): Promise<SportCoverage> {
  const [teams, games, players] = await Promise.all([
    prisma.sportsTeam.count({ where: { sport } }),
    prisma.sportsGame.count({ where: { sport } }),
    prisma.sportsPlayer.count({ where: { sport } }),
  ])
  return { sport, teams, games, players, available: availableFor(sport) }
}
