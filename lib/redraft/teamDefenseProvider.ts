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
import { createTtlMemo } from '@/lib/ttl-memo'
import { normalizeNflTeam } from './lineupLock'
import { ingestNflTeamDefenseBoxScores, type IngestTeamDefenseResult } from './teamDefenseStatsIngest'

/** Returns Sleeper's `grouping=week` payload for one team's season, or null on failure. */
export type SleeperTeamDefenseFetcher = (
  teamAbbr: string,
  season: number,
  seasonType: string,
) => Promise<unknown | null>

const SLEEPER_STATS_BASE = 'https://api.sleeper.com/stats/nfl/player'

/**
 * One in-process entry per (team, season, seasonType).
 *
 * 🛑 THIS CALL BURNED 95% OF THE SLEEPER BUDGET AND STARVED EVERY OTHER CONSUMER.
 *
 * The URL asks for a team's WHOLE SEASON (`grouping=week`) and the caller extracts one week
 * from it — so the identical payload was refetched once per team PER SEASON BEING SCORED, on
 * every tick. Measured on production 2026-09-24, from the minute the first native league
 * advanced to week 2 and gave the live tick a week to score:
 *
 *     01:21Z  128 calls   (32 teams x 4 seasons)
 *     01:23Z  128
 *     ...     every 2 minutes  =  3,840/hour against a 1,000/hour cap
 *     01:35Z   76          budget exhausted
 *
 * ⚠ AND THE DAMAGE LANDED SOMEWHERE ELSE ENTIRELY. The cap is per PROVIDER, so once it was
 * gone `canCall('sleeper', 'stats/nfl/week')` returned false too;
 * `NflLiveStatsProvider.fetchPlayerStatsForGames` returns an EMPTY map when refused, the score
 * sync read that as "these players have no stats", and the week finalizer refused with
 * `stat_coverage_below_floor` — naming the roster when the cause was this function's quota.
 *
 * ⚠ THE TTL IS DELIBERATELY SHORT. The current week's numbers move while games are in play, so
 * this must not outlive a tick by much; it exists to collapse the per-season fanout within and
 * across adjacent ticks, not to serve stale scores. At 4 minutes the same 4-season tick costs
 * 32 calls instead of 128, and the next tick reuses them.
 */
const teamDefenseSeasonMemo = createTtlMemo<unknown>({
  ttlMs: () => Number(process.env.AF_TEAM_DEFENSE_MEMO_MS ?? 4 * 60 * 1000),
  maxEntries: 256,
})

/**
 * Calls that have not answered yet, so concurrent askers share one request.
 *
 * ⚠ THE VALUE MEMO ALONE DOES NOT STOP A STAMPEDE — it only fills once a call RETURNS, so
 * every caller that arrives before the first response still issues its own. The production
 * pattern is sequential, but nothing enforces that, and coalescing costs one Map.
 */
const teamDefenseInFlight = new Map<string, Promise<unknown | null>>()

/** Live Sleeper fetch for one team defense's weekly stats (rate-limited, timed out). */
export const fetchSleeperTeamDefenseSeason: SleeperTeamDefenseFetcher = async (teamAbbr, season, seasonType) => {
  const team = normalizeNflTeam(teamAbbr)
  if (!team) return null
  const memoKey = `${team}|${season}|${seasonType}`
  const memoised = teamDefenseSeasonMemo.get(memoKey)
  if (memoised !== undefined) return memoised
  const pending = teamDefenseInFlight.get(memoKey)
  if (pending) return pending

  const request = fetchTeamDefenseSeasonUncached(team, season, seasonType, memoKey)
  teamDefenseInFlight.set(memoKey, request)
  try {
    return await request
  } finally {
    teamDefenseInFlight.delete(memoKey)
  }
}

async function fetchTeamDefenseSeasonUncached(
  team: string,
  season: number,
  seasonType: string,
  memoKey: string,
): Promise<unknown | null> {
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
    const payload = await res.json()
    // ⚠ ONLY A SUCCESS IS CACHED. Storing a miss would turn one transient outage into four
    // minutes of "this team has no defence" for every league — the weather-geocode precedent.
    teamDefenseSeasonMemo.set(memoKey, payload)
    return payload
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
