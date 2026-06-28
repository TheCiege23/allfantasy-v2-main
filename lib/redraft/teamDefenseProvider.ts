/**
 * NFL Team-Defense box-score PROVIDER (G8 final) — Sleeper weekly stats.
 *
 * Audit result: Sleeper supplies REAL, WEEKLY (not season-aggregate) team-defense
 * stats. A team defense is keyed by its team abbreviation as the "player" id:
 *   GET https://api.sleeper.com/stats/nfl/player/<TEAM>?season_type=regular&season=<YYYY>&grouping=week
 *   → { "1": { sack, int, fum_rec, def_td, blk_kick, safe, def_st_td, pts_allow, yds_allow, ... }, "2": {…} }
 *
 * This module fetches that, extracts a week, and feeds it through the existing
 * `ingestNflTeamDefenseBoxScores` adapter (which normalizes → `def_*`, writes the
 * `nfl:def:<ABBR>` cache, idempotent + stat-correction safe). The fetcher is
 * dependency-injected so tests/E2E use fixtures (deterministic, no live HTTP)
 * while production uses live Sleeper.
 *
 * No fabrication: a team whose week is missing from the provider is skipped with
 * a warning; only stats Sleeper actually returns are ingested.
 */
import type { PrismaClient } from '@prisma/client'
import { normalizeNflTeam } from './lineupLock'
import { ingestNflTeamDefenseBoxScores, type IngestTeamDefenseResult } from './teamDefenseStatsIngest'

/** Returns Sleeper's `grouping=week` payload for one team's season, or null on failure. */
export type SleeperTeamDefenseFetcher = (
  teamAbbr: string,
  season: number,
  seasonType: string,
) => Promise<unknown | null>

const SLEEPER_STATS_BASE = 'https://api.sleeper.com/stats/nfl/player'

/** Live Sleeper fetch for one team defense's weekly stats (rate-limited, timed out). */
export const fetchSleeperTeamDefenseSeason: SleeperTeamDefenseFetcher = async (teamAbbr, season, seasonType) => {
  const team = normalizeNflTeam(teamAbbr)
  if (!team) return null
  const endpoint = 'team-defense:nfl:sleeper'
  // Lazy import: rate-limit-manager pulls in `server-only`, which throws under
  // tsx. Tests/E2E inject a fixture fetcher and never reach this live path.
  const { rateLimitManager } = await import('@/lib/workers/rate-limit-manager')
  const canCall = await rateLimitManager.canCall('sleeper', endpoint).catch(() => true)
  if (!canCall) return null

  const url = `${SLEEPER_STATS_BASE}/${encodeURIComponent(team)}?season_type=${encodeURIComponent(seasonType)}&season=${encodeURIComponent(String(season))}&grouping=week`
  const startedAt = Date.now()
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    await rateLimitManager
      .recordCall('sleeper', endpoint, res.status, Math.max(0, Date.now() - startedAt), { cached: false, error: res.ok ? null : `HTTP ${res.status}` })
      .catch(() => undefined)
    if (!res.ok) return null
    return await res.json()
  } catch {
    await rateLimitManager.recordCall('sleeper', endpoint, 0, Math.max(0, Date.now() - startedAt), { cached: false, error: 'fetch_failed' }).catch(() => undefined)
    return null
  }
}

/**
 * Extract one week's stat object from a Sleeper `grouping=week` payload. Pure.
 * The payload is keyed by week string; the value may be flat stats or carry a
 * nested `stats` object — `normalizeNflTeamDefenseWeeklyStats` handles both, so
 * this just returns the week's object.
 */
export function extractSleeperWeekStats(payload: unknown, week: number): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const row = (payload as Record<string, unknown>)[String(week)]
  if (row && typeof row === 'object' && !Array.isArray(row)) return row as Record<string, unknown>
  return null
}

export type SyncTeamDefenseResult = {
  season: number
  week: number
  teamsRequested: number
  teamsFetched: number
  teamsMissingWeek: number
  ingest: IngestTeamDefenseResult
  warnings: string[]
}

/**
 * Fetch + ingest weekly team-defense box scores for the given teams. Idempotent
 * and stat-correction safe (delegates to `ingestNflTeamDefenseBoxScores`). The
 * `fetcher` defaults to live Sleeper; inject a fixture fetcher in tests/E2E.
 */
export async function syncNflTeamDefenseBoxScores(
  prisma: PrismaClient,
  args: {
    season: number
    week: number
    teams: string[]
    seasonType?: string
    fetcher?: SleeperTeamDefenseFetcher
  },
): Promise<SyncTeamDefenseResult> {
  const season = Number(args.season)
  const week = Number(args.week)
  const seasonType = args.seasonType ?? 'regular'
  const fetcher = args.fetcher ?? fetchSleeperTeamDefenseSeason
  const teams = Array.from(new Set(args.teams.map((t) => normalizeNflTeam(t)).filter(Boolean)))

  const warnings: string[] = []
  const entries: { teamAbbr: string; stats: Record<string, unknown> }[] = []
  let teamsFetched = 0
  let teamsMissingWeek = 0

  for (const team of teams) {
    const payload = await fetcher(team, season, seasonType)
    if (payload == null) {
      warnings.push(`No provider data returned for ${team} (week ${week}).`)
      continue
    }
    teamsFetched += 1
    const weekStats = extractSleeperWeekStats(payload, week)
    if (!weekStats) {
      teamsMissingWeek += 1
      warnings.push(`Provider has no week ${week} row for ${team}; not ingested.`)
      continue
    }
    entries.push({ teamAbbr: team, stats: weekStats })
  }

  const ingest = await ingestNflTeamDefenseBoxScores(prisma, { season, week, entries, seasonType })

  return {
    season,
    week,
    teamsRequested: teams.length,
    teamsFetched,
    teamsMissingWeek,
    ingest,
    warnings: [...warnings, ...ingest.warnings],
  }
}

/**
 * Resolve the set of rostered team-defense abbreviations across the given active
 * NFL redraft seasons (so the cron only fetches defenses that are actually
 * owned). Returns one entry per (season-year, week) with its team set.
 */
export async function resolveRosteredDefenseTeams(
  prisma: PrismaClient,
  seasons: { id: string; season: number; currentWeek: number | null }[],
): Promise<Map<string, { season: number; week: number; teams: Set<string> }>> {
  const buckets = new Map<string, { season: number; week: number; teams: Set<string> }>()
  for (const s of seasons) {
    const week = Math.max(1, Number(s.currentWeek ?? 1) || 1)
    const key = `${s.season}:${week}`
    const bucket = buckets.get(key) ?? { season: s.season, week, teams: new Set<string>() }
    const rosters = await prisma.redraftRoster.findMany({ where: { seasonId: s.id }, select: { id: true } })
    const rosterIds = rosters.map((r) => r.id)
    if (rosterIds.length) {
      const defPlayers = await prisma.redraftRosterPlayer.findMany({
        where: { rosterId: { in: rosterIds }, droppedAt: null, position: { in: ['DEF', 'DST', 'def', 'dst'] } },
        select: { playerId: true, team: true },
      })
      for (const p of defPlayers) {
        const fromId = /^nfl:def:(.+)$/i.exec(p.playerId)?.[1]
        const abbr = normalizeNflTeam(fromId ?? p.team ?? '')
        if (abbr) bucket.teams.add(abbr)
      }
    }
    buckets.set(key, bucket)
  }
  return buckets
}
