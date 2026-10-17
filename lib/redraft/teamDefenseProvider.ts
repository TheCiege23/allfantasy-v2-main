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
import { canonicalTeamDefenseId, findCachedWeekPayload } from '@/lib/scoring-runtime/nflStatNormalization'
import type { SportWeekResolution } from '@/lib/season-week/types'
import { nflTeamCodeOf } from '@/lib/core-app/teamDefenseCrosswalk'
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
        // `D/ST` is how ESPN and Fleaflicker rosters spell it (136 production slots, 2026-10-13).
        where: { rosterId: { in: rosterIds }, droppedAt: null, position: { in: ['DEF', 'DST', 'D/ST', 'def', 'dst', 'd/st'] } },
        select: { playerId: true, position: true, team: true },
      })
      for (const p of defPlayers) {
        /*
         * The club from the id when the id names one (`nfl:def:KC`, Sleeper's bare `KC`), else from the
         * team label — through `nflTeamCodeOf`, because a Sleeper DEF row's team can read "Arizona
         * Cardinals" and a Fleaflicker one "Chiefs": upper-cased raw, each was a "team" the box-score fetch
         * asked the provider for and could never match. A label that names no club adds nothing.
         */
        const fromId = canonicalTeamDefenseId(p.playerId, p.position)?.slice('nfl:def:'.length)
        const abbr = fromId ?? nflTeamCodeOf(p.team)
        if (abbr) bucket.teams.add(normalizeNflTeam(abbr))
      }
    }
    buckets.set(key, bucket)
  }
  return buckets
}

/** Earlier weeks one cron run may fill, newest first. The daily run has a 60 s ceiling. */
export const TEAM_DEFENSE_BACKFILL_WEEKS_PER_RUN = 3

export type TeamDefenseImportBucket = {
  season: number
  week: number
  teams: string[]
  reason: 'current' | 'backfill'
}

/**
 * Which (season, week, clubs) the defence box-score cron should fetch this run.
 *
 * 🛑 THE CRON FETCHED `RedraftSeason.currentWeek`, AND NOTHING KEEPS THAT ON THE NFL'S WEEK. A
 * native season advances only when every matchup is finalized; an import is written at 1 and never
 * moves. So the cache held whichever week each season happened to be parked on: on production
 * 2026-10-13 all 8 defence cache rows carried weeks 1 and 3 only, while weeks 1-5 had final scores.
 * The week now comes from the committed NFL schedule (`resolveSportWeek`, the resolver the score
 * jobs use), falling back to the stored week — the old behaviour — only when the schedule declines.
 *
 * Earlier weeks of the season are filled too: any week with finished regular-season games in which a
 * rostered club played and has no cached line — newest first, at most
 * `TEAM_DEFENSE_BACKFILL_WEEKS_PER_RUN` weeks, only the clubs missing. ⚠ THIS COSTS NO EXTRA PROVIDER
 * CALLS ON A GOOD RUN: Sleeper answers with the club's whole season and `fetchSleeperTeamDefenseSeason`
 * memoises it, so every bucket after the first reads the same payload. Only a failed fetch (never
 * memoised) is retried per bucket, which the per-run cap bounds.
 */
export async function planTeamDefenseImport(
  prisma: PrismaClient,
  seasons: { id: string; season: number; currentWeek: number | null }[],
  deps: { resolveWeek?: (season: number) => Promise<SportWeekResolution>; maxBackfillWeeks?: number } = {},
): Promise<{ buckets: TeamDefenseImportBucket[]; warnings: string[] }> {
  const maxBackfill = Math.max(0, deps.maxBackfillWeeks ?? TEAM_DEFENSE_BACKFILL_WEEKS_PER_RUN)
  const resolveWeek =
    deps.resolveWeek ??
    (async (season: number) => {
      const { resolveSportWeek } = await import('@/lib/season-week/seasonWeekService')
      return resolveSportWeek('NFL', season, { prisma })
    })

  // Rostered clubs per season YEAR — the box score belongs to the NFL week, not to any one league.
  const rostered = await resolveRosteredDefenseTeams(prisma, seasons)
  const byYear = new Map<number, { teams: Set<string>; storedWeek: number }>()
  for (const bucket of rostered.values()) {
    const entry = byYear.get(bucket.season) ?? { teams: new Set<string>(), storedWeek: bucket.week }
    for (const team of bucket.teams) entry.teams.add(team)
    entry.storedWeek = Math.max(entry.storedWeek, bucket.week)
    byYear.set(bucket.season, entry)
  }

  const buckets: TeamDefenseImportBucket[] = []
  const warnings: string[] = []
  for (const [season, { teams, storedWeek }] of byYear) {
    if (teams.size === 0) continue
    const resolved = await resolveWeek(season).catch(() => null)
    const fromSchedule = resolved?.ok === true && resolved.seasonType === 'regular' ? resolved.sportWeek : null
    if (fromSchedule == null) {
      warnings.push(`NFL ${season}: the schedule named no regular-season week; using the stored week ${storedWeek}.`)
    }
    const currentWeek = Math.max(1, fromSchedule ?? storedWeek)
    const clubs = [...teams].sort()
    buckets.push({ season, week: currentWeek, teams: clubs, reason: 'current' })

    if (maxBackfill === 0 || currentWeek <= 1) continue
    const games = await prisma.sportsGame.findMany({
      where: { sport: { in: ['NFL', 'nfl'] }, season, seasonType: 'regular', week: { gte: 1, lt: currentWeek }, homeScore: { not: null } },
      select: { week: true, homeTeam: true, awayTeam: true },
    })
    const playedByWeek = new Map<number, Set<string>>()
    for (const g of games as Array<{ week: number | null; homeTeam: string | null; awayTeam: string | null }>) {
      if (g.week == null) continue
      const played = playedByWeek.get(g.week) ?? new Set<string>()
      for (const side of [g.homeTeam, g.awayTeam]) {
        const club = normalizeNflTeam(side)
        if (club) played.add(club)
      }
      playedByWeek.set(g.week, played)
    }
    const cacheRows = await prisma.playerGameLogCache.findMany({
      where: { playerId: { in: clubs.map((club) => `nfl:def:${club}`) }, season: String(season), seasonType: 'regular' },
      select: { playerId: true, payload: true },
    })
    const payloadByClub = new Map(
      (cacheRows as Array<{ playerId: string; payload: unknown }>).map((row) => [row.playerId.slice('nfl:def:'.length).toUpperCase(), row.payload]),
    )
    let filled = 0
    for (let week = currentWeek - 1; week >= 1 && filled < maxBackfill; week -= 1) {
      const played = playedByWeek.get(week)
      if (!played) continue
      const missing = clubs.filter((club) => played.has(club) && findCachedWeekPayload(payloadByClub.get(club), week) == null)
      if (missing.length === 0) continue
      buckets.push({ season, week, teams: missing, reason: 'backfill' })
      filled += 1
    }
  }
  return { buckets, warnings }
}
