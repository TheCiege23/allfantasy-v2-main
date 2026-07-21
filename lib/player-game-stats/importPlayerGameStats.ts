/**
 * Player-game-stat ingestion: provider → normalization → PlayerGameStat → PlayerGameFact.
 *
 * Why this exists: `PlayerGameStat` had ZERO production rows. Its write path
 * (`ingestSportStats`) was fully built but had no caller — the only route that reached it
 * (`/api/internal/schedule-stats/ingest`) is gated on `STATS_INGESTION_API_KEY`, which is
 * unset, undocumented, and called by nothing (a dormant external-push design). Downstream,
 * `best-ball-engine` silently treated the missing table as all-zero stats and
 * `HistoricalFactGenerator` → `/api/warehouse/league-history` → WarehouseHistoryPanel rendered
 * empty history as if it were real.
 *
 * Provider: Sleeper's free week-stats endpoint (`api.sleeper.com/stats/nfl/{season}/{week}`),
 * the same host the live-scoring tick already uses. Player ids in the payload ARE Sleeper ids,
 * which is exactly the id space best-ball roster player ids use for Sleeper-imported leagues —
 * no identity translation layer needed. Raw Sleeper stat keys (pass_yd, rush_yd, rec, …) are
 * the keys `normalizeStatPayload`'s NFL alias map expects, so payloads pass through verbatim.
 *
 * The fetcher is injectable (`WeeklyStatsFetcher`) so tests and seeded proofs can drive the
 * whole pipeline with fixture data and no network, mirroring the LiveStatsProvider seam the
 * live-score-tick proof used.
 */

import { prisma } from '@/lib/prisma'
import { ingestSportStats } from '@/lib/schedule-stats'
import { generateGameFactsFromExistingStats } from '@/lib/data-warehouse/HistoricalFactGenerator'

export interface ProviderWeekStatRow {
  playerId: string
  gameId: string | null
  stats: Record<string, number>
}

export interface WeeklyStatsFetchArgs {
  sport: 'NFL'
  season: number
  week: number
  seasonType: 'regular' | 'post'
}

export interface WeeklyStatsFetcher {
  /** Return null on provider failure (never throw, never fabricate). */
  fetchWeek(args: WeeklyStatsFetchArgs): Promise<ProviderWeekStatRow[] | null>
}

export interface ImportWeekReport {
  season: number
  week: number
  fetched: number
  /** Provider TEAM_* whole-team aggregate rows excluded before persistence. */
  teamRowsFiltered: number
  ingested: number
  matchedPlayers: number
  unresolvedPlayers: number
  playerFactsGenerated: number
  factStatus: string
  dryRun: boolean
}

const SEASON_FALLBACK_MAX_YEARS = 3
const MAX_NFL_WEEK = 18

/** Keep only finite numeric stat values; a row must carry at least one to be ingestible. */
function toNumericStats(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const num = typeof value === 'number' ? value : Number(value)
    if (Number.isFinite(num)) out[key] = num
  }
  return out
}

/** Sleeper week payload is an array of rows or an object keyed by player id. */
export function parseSleeperWeekPayload(payload: unknown): ProviderWeekStatRow[] {
  const rows: ProviderWeekStatRow[] = []
  if (!payload || typeof payload !== 'object') return rows

  const push = (playerId: string, gameId: unknown, statsRaw: unknown) => {
    const stats = toNumericStats(statsRaw)
    if (!playerId || Object.keys(stats).length === 0) return
    const gid = typeof gameId === 'string' && gameId.trim() ? gameId.trim() : null
    rows.push({ playerId, gameId: gid, stats })
  }

  if (Array.isArray(payload)) {
    for (const row of payload) {
      if (!row || typeof row !== 'object') continue
      const rec = row as Record<string, unknown>
      push(String(rec.player_id ?? rec.playerId ?? ''), rec.game_id ?? rec.gameId, rec.stats ?? rec)
    }
    return rows
  }

  for (const [playerId, row] of Object.entries(payload as Record<string, unknown>)) {
    const rec = row && typeof row === 'object' ? (row as Record<string, unknown>) : null
    push(playerId, rec?.game_id ?? rec?.gameId, rec?.stats ?? row)
  }
  return rows
}

/** Production fetcher: Sleeper free stats API (no key, unmetered — same host as live scoring). */
export class SleeperWeeklyStatsFetcher implements WeeklyStatsFetcher {
  async fetchWeek(args: WeeklyStatsFetchArgs): Promise<ProviderWeekStatRow[] | null> {
    const url = `https://api.sleeper.com/stats/nfl/${args.season}/${args.week}?season_type=${args.seasonType}`
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } })
      if (!res.ok) return null
      return parseSleeperWeekPayload(await res.json())
    } catch {
      return null
    }
  }
}

/**
 * Ingest one (season, week). Idempotent: PlayerGameStat's unique key is
 * (playerId, sportType, gameId) and gameId is deterministic, so re-runs update in place.
 */
export async function importPlayerGameStatsForWeek(args: {
  season: number
  week: number
  seasonType?: 'regular' | 'post'
  fetcher: WeeklyStatsFetcher
  knownPlayerIds?: ReadonlySet<string>
  dryRun?: boolean
  limit?: number
  generateFacts?: boolean
}): Promise<ImportWeekReport | null> {
  const seasonType = args.seasonType ?? 'regular'
  const rows = await args.fetcher.fetchWeek({ sport: 'NFL', season: args.season, week: args.week, seasonType })
  if (rows == null) return null

  // Sleeper's week payload includes TEAM_* whole-team aggregate rows (e.g. TEAM_BUF) alongside
  // players. Scored under player rules they produce absurd values (~110 fantasy points) and
  // would pollute PlayerGameStat, PlayerGameFact, and every aggregate built on them. They are
  // NOT the same as team-DST rows (plain codes like "SF"), which are legitimate roster player
  // ids and are kept. Team-level statistics belong in TeamGameStat via a dedicated pipeline.
  const playerRows = rows.filter((row) => !row.playerId.startsWith('TEAM_'))
  const teamRowsFiltered = rows.length - playerRows.length

  const bounded = typeof args.limit === 'number' && args.limit > 0 ? playerRows.slice(0, args.limit) : playerRows
  let matchedPlayers = 0
  let unresolvedPlayers = 0
  const playerStats = bounded.map((row) => {
    if (args.knownPlayerIds) {
      if (args.knownPlayerIds.has(row.playerId)) matchedPlayers += 1
      else unresolvedPlayers += 1
    }
    return {
      playerId: row.playerId,
      // Deterministic per-week gameId keeps re-imports idempotent when the provider omits one.
      gameId: row.gameId ?? `NFL-${args.season}-W${String(args.week).padStart(2, '0')}`,
      statPayload: row.stats,
    }
  })

  let ingested = 0
  let playerFactsGenerated = 0
  let factStatus = 'skipped'

  if (!args.dryRun && playerStats.length > 0) {
    const result = await ingestSportStats({
      sportType: 'NFL',
      season: args.season,
      weekOrRound: args.week,
      source: 'sleeper',
      playerStats,
    })
    ingested = result.playerStatCount

    if (args.generateFacts !== false) {
      const facts = await generateGameFactsFromExistingStats('NFL', args.season, args.week)
      playerFactsGenerated = facts.playerFacts
      factStatus = facts.status
    }
  }

  return {
    season: args.season,
    week: args.week,
    fetched: rows.length,
    teamRowsFiltered,
    ingested,
    matchedPlayers,
    unresolvedPlayers,
    playerFactsGenerated,
    factStatus,
    dryRun: Boolean(args.dryRun),
  }
}

/**
 * Schema preflight: true only when prod's player_game_stats table carries the
 * provider-telemetry columns the Prisma client's upsert RETURNING requires.
 *
 * This is the deploy-ordering safety gate: the cron route refuses to run (clean 200
 * `migration_pending` skip, ZERO writes — not even a lock row) until the additive migration
 * has been applied, so merging code before the migration is completely inert instead of a
 * recorded failure. Pure information_schema read; self-arms the moment the migration lands,
 * no second deploy or env toggle needed.
 */
export async function isPlayerGameStatsSchemaReady(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ ok: number }>>`
    SELECT 1 AS ok FROM information_schema.columns
    WHERE table_name = 'player_game_stats' AND column_name = 'provider_player_id'
    LIMIT 1`
  return rows.length > 0
}

/**
 * Resolve which season actually has data: providers 400/empty on a season that hasn't started
 * (it is July — the current year has no completed weeks), so walk back up to
 * SEASON_FALLBACK_MAX_YEARS until week 1 returns rows. Same bounded-loop pattern as the
 * season-stats cron (#310).
 */
export async function resolveIngestableSeason(
  requestedSeason: number,
  fetcher: WeeklyStatsFetcher
): Promise<{ season: number; fallbackUsed: boolean } | null> {
  for (let back = 0; back <= SEASON_FALLBACK_MAX_YEARS; back += 1) {
    const candidate = requestedSeason - back
    if (candidate <= 2000) break
    const probe = await fetcher.fetchWeek({ sport: 'NFL', season: candidate, week: 1, seasonType: 'regular' })
    if (probe != null && probe.length > 0) return { season: candidate, fallbackUsed: back > 0 }
  }
  return null
}

/** Weeks of `season` with no PlayerGameStat rows yet, ascending. */
export async function findMissingWeeks(season: number): Promise<number[]> {
  const present = await prisma.playerGameStat.groupBy({
    by: ['weekOrRound'],
    where: { sportType: 'NFL', season },
    _count: { _all: true },
  })
  const covered = new Set(present.filter((row) => row._count._all > 0).map((row) => row.weekOrRound))
  const missing: number[] = []
  for (let week = 1; week <= MAX_NFL_WEEK; week += 1) {
    if (!covered.has(week)) missing.push(week)
  }
  return missing
}

/** Sleeper-id universe for matched/unresolved reporting (team-DST codes like "SF" are legit ids). */
export async function loadKnownNflPlayerIds(): Promise<Set<string>> {
  const players = await prisma.sportsPlayer.findMany({
    where: { sport: 'NFL', sleeperId: { not: null } },
    select: { sleeperId: true },
  })
  const known = new Set<string>()
  for (const player of players) {
    if (player.sleeperId) known.add(player.sleeperId)
  }
  return known
}
