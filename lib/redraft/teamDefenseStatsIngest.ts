/**
 * NFL Team Defense / Special-Teams (DST) box-score INGESTION (gap G8 residual).
 *
 * The G8 engine made DEF starters scoreable and derives points-allowed from the
 * real game result (`SportsGame`). This module wires the *box-score* feed for the
 * remaining DST categories (sacks/INT/FR/def TD/safeties/blocked kicks/return
 * TDs/yards-allowed): it takes a provider's per-team defensive payload and writes
 * it into the cache the existing DEF score-sync already reads
 * (`player_game_log_cache` for the synthetic `nfl:def:<ABBR>` player), so there is
 * exactly ONE writer of the DEF `PlayerWeeklyScore` (the sync) and no clobbering.
 *
 * Guarantees:
 *  - **No fabrication.** Only stats the provider supplies are written; an entry
 *    with no recognized DST keys is skipped (not zero-filled).
 *  - **Idempotent.** Re-ingesting the same week replaces that week's entry in the
 *    cached game-log array — never appends duplicates.
 *  - **Stat corrections.** Re-ingesting a week with updated numbers overwrites it,
 *    so the next score-sync re-scores from the corrected stats.
 *  - **Offense-safe.** Only `nfl:def:<ABBR>` rows are touched; offensive player
 *    caches and scoring are never modified.
 *  - **Commissioner overrides** still apply — scoring happens later through
 *    `calculateScoreFromSportConfig`, which honors per-league `categoryPoints`.
 *
 * NOTE: this is the INGESTION side. No live NFL provider currently supplies
 * per-team weekly defensive box scores into the DB (team_game_stats is empty,
 * SportsGame.raw is null) — a provider cron/worker must call this with real
 * payloads. Until then, production DEF scores points-allowed only.
 */
import type { PrismaClient } from '@prisma/client'
import { normalizeNflTeamDefenseWeeklyStats } from './playerWeeklyScoreService'
import { normalizeNflTeam } from './lineupLock'

/** Synthetic weekly-score / cache player id for a team defense, e.g. `nfl:def:KC`. */
export function buildTeamDefensePlayerId(teamAbbr: string): string {
  return `nfl:def:${normalizeNflTeam(teamAbbr)}`
}

export type TeamDefenseBoxScoreEntry = {
  /** Team abbreviation (any common variant; normalized, e.g. JAC→JAX). */
  teamAbbr: string
  /** Raw provider defensive payload (canonical or aliased keys). */
  stats: Record<string, unknown>
}

export type TeamDefGameLogEntry = { week: number } & Record<string, number>

/**
 * Merge one week's normalized DST stats into an existing cached game-log payload,
 * replacing any existing entry for that week (idempotent + stat-correction safe).
 * Pure so the merge contract is unit-tested without a database.
 */
export function mergeWeekIntoTeamDefenseGameLog(
  existingPayload: unknown,
  week: number,
  normalizedStats: Record<string, number>,
): TeamDefGameLogEntry[] {
  const prior: TeamDefGameLogEntry[] = Array.isArray(existingPayload)
    ? (existingPayload as TeamDefGameLogEntry[]).filter((row) => row && typeof row === 'object' && Number(row.week) !== week)
    : []
  const next: TeamDefGameLogEntry = { week, ...normalizedStats }
  return [...prior, next].sort((a, b) => Number(a.week) - Number(b.week))
}

export type IngestTeamDefenseResult = {
  season: number
  week: number
  upserted: number
  skippedNoStats: number
  teams: string[]
  warnings: string[]
}

/**
 * Ingest per-team NFL defensive box scores for one week into the DEF game-log
 * cache. Idempotent; safe to re-run for stat corrections. Returns a summary.
 */
export async function ingestNflTeamDefenseBoxScores(
  prisma: PrismaClient,
  args: {
    season: number
    week: number
    entries: TeamDefenseBoxScoreEntry[]
    seasonType?: string
    /** Cache TTL in days (default 14). */
    ttlDays?: number
  },
): Promise<IngestTeamDefenseResult> {
  const season = Number(args.season)
  const week = Number(args.week)
  const seasonType = args.seasonType ?? 'regular'
  const expiresAt = new Date(Date.now() + (args.ttlDays ?? 14) * 86_400_000)

  const result: IngestTeamDefenseResult = {
    season,
    week,
    upserted: 0,
    skippedNoStats: 0,
    teams: [],
    warnings: [],
  }

  for (const entry of args.entries) {
    const teamAbbr = normalizeNflTeam(entry.teamAbbr)
    if (!teamAbbr) {
      result.warnings.push('Skipped a team-defense entry with no team abbreviation.')
      continue
    }
    const normalized = normalizeNflTeamDefenseWeeklyStats(entry.stats)
    if (Object.keys(normalized).length === 0) {
      // No recognized DST stat keys — do NOT write a zero-filled row (no fabrication).
      result.skippedNoStats += 1
      result.warnings.push(`No recognized team-defense stats for ${teamAbbr} (week ${week}); not ingested.`)
      continue
    }

    const playerId = buildTeamDefensePlayerId(teamAbbr)
    const existing = await prisma.playerGameLogCache.findUnique({
      where: { uniq_player_game_log_cache: { playerId, sport: 'NFL', season: String(season), seasonType } },
      select: { payload: true },
    })
    const payload = mergeWeekIntoTeamDefenseGameLog(existing?.payload ?? null, week, normalized)

    await prisma.playerGameLogCache.upsert({
      where: { uniq_player_game_log_cache: { playerId, sport: 'NFL', season: String(season), seasonType } },
      update: { payload, expiresAt, syncedAt: new Date() },
      create: { playerId, sport: 'NFL', season: String(season), seasonType, payload, expiresAt },
    })
    result.upserted += 1
    result.teams.push(teamAbbr)
  }

  return result
}
