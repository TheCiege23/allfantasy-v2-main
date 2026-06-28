/**
 * NFL live-stats provider (G11 Phase 3b) — concrete `LiveStatsProvider` for NFL.
 *
 * Sources (the audit's best available):
 *  - active games / status: the `SportsGame` schedule table (homeTeam/awayTeam
 *    abbreviations, status, startTime). Status is COARSE — scheduled/in_progress/
 *    final; suspended/postponed only when the upstream import supplies them.
 *  - team DEF/ST stat lines: Sleeper, via the proven `fetchSleeperTeamDefenseSeason`
 *    + `extractSleeperWeekStats` path, normalized through the G8/G9
 *    `normalizeNflTeamDefenseWeeklyStats` (so the `safe`/return-yard mappings apply).
 *  - offensive player stat lines: Sleeper week-wide stats, normalized through
 *    `normalizeNflWeeklyStats`.
 *
 * DOCUMENTED GAPS (keep the game-clock UI blocked):
 *  - quarter / period and game clock are NOT available from any current source
 *    (`SportsGame` has no such columns; Sleeper stats carry no clock). Live game
 *    state is therefore limited to scheduled/in_progress/final. Phase 4 must not
 *    render a quarter/clock until a play-by-play/scoreboard feed is added.
 *  - offensive `playerId → Sleeper id` mapping assumes rostered ids are Sleeper ids;
 *    this must be validated against a real live league. The provider is injectable,
 *    so production can swap/validate without touching the orchestrator.
 *
 * No fabrication: any fetch failure or missing row yields no entry (never a guess).
 */

import type { PrismaClient } from '@prisma/client'
import {
  extractSleeperWeekStats,
  fetchSleeperTeamDefenseSeason,
} from '@/lib/redraft/teamDefenseProvider'
import {
  normalizeNflWeeklyStats,
  normalizeNflTeamDefenseWeeklyStats,
} from '@/lib/redraft/playerWeeklyScoreService'
import { buildTeamDefensePlayerId } from '@/lib/redraft/teamDefenseStatsIngest'
import { normalizeNflTeam } from '@/lib/redraft/lineupLock'
import { normalizeLiveGameStatus } from '@/lib/live-scoring/cadence'
import { teamsInGames, type LiveGameLite, type LiveStatsProvider, type LiveStatsQuery } from '@/lib/live-scoring/provider'
import type { LiveGameStatus } from '@/lib/live-scoring/types'

export class NflLiveStatsProvider implements LiveStatsProvider {
  constructor(private readonly prisma: PrismaClient) {}

  normalizeGameStatus(raw: string | null | undefined): LiveGameStatus {
    return normalizeLiveGameStatus(raw)
  }

  async fetchActiveGames(query: LiveStatsQuery): Promise<LiveGameLite[]> {
    const rows = await this.prisma.sportsGame.findMany({
      where: { sport: 'NFL', season: query.season, week: query.week },
      select: { externalId: true, homeTeam: true, awayTeam: true, status: true, startTime: true },
    })
    return rows.map((r) => ({
      gameId: r.externalId,
      homeTeam: normalizeNflTeam(r.homeTeam),
      awayTeam: normalizeNflTeam(r.awayTeam),
      status: this.normalizeGameStatus(r.status),
      startTime: r.startTime ?? null,
    }))
  }

  async fetchTeamDefenseStatsForGames(
    query: LiveStatsQuery & { games: readonly LiveGameLite[] },
  ): Promise<Map<string, Record<string, number>>> {
    const out = new Map<string, Record<string, number>>()
    const teams = teamsInGames(query.games)
    for (const team of teams) {
      const payload = await fetchSleeperTeamDefenseSeason(team, query.season, 'regular').catch(() => null)
      if (payload == null) continue
      const weekStats = extractSleeperWeekStats(payload, query.week)
      if (!weekStats) continue
      const normalized = normalizeNflTeamDefenseWeeklyStats(weekStats)
      if (Object.keys(normalized).length === 0) continue
      out.set(buildTeamDefensePlayerId(team), normalized)
    }
    return out
  }

  async fetchPlayerStatsForGames(
    query: LiveStatsQuery & { games: readonly LiveGameLite[]; playerIds: readonly string[] },
  ): Promise<Map<string, Record<string, number>>> {
    const out = new Map<string, Record<string, number>>()
    if (query.playerIds.length === 0) return out
    // Sleeper week-wide stats: one call returns every player's week row keyed by id.
    const url = `https://api.sleeper.com/stats/nfl/${encodeURIComponent(query.season)}/${encodeURIComponent(query.week)}?season_type=regular`
    let payload: unknown = null
    try {
      const { rateLimitManager } = await import('@/lib/workers/rate-limit-manager')
      const endpoint = 'stats/nfl/week'
      const canCall = await rateLimitManager.canCall('sleeper', endpoint).catch(() => true)
      if (!canCall) return out
      const res = await fetch(url, { headers: { accept: 'application/json' } })
      await rateLimitManager.recordCall('sleeper', endpoint, res.ok ? 1 : 0, 0, { cached: false }).catch(() => undefined)
      if (!res.ok) return out
      payload = await res.json()
    } catch {
      return out // no fabrication on failure
    }

    const byId = asPlayerStatMap(payload)
    if (!byId) return out
    const want = new Set(query.playerIds)
    for (const playerId of want) {
      const raw = byId.get(playerId)
      if (!raw) continue
      const normalized = normalizeNflWeeklyStats(raw)
      if (Object.keys(normalized).length > 0) out.set(playerId, normalized)
    }
    return out
  }
}

/** Sleeper week-wide payload may be an object keyed by id, or an array of rows. */
function asPlayerStatMap(payload: unknown): Map<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null
  const map = new Map<string, unknown>()
  if (Array.isArray(payload)) {
    for (const row of payload) {
      const id = row && typeof row === 'object' ? String((row as { player_id?: unknown }).player_id ?? '') : ''
      const stats = row && typeof row === 'object' ? (row as { stats?: unknown }).stats ?? row : row
      if (id) map.set(id, stats)
    }
    return map
  }
  for (const [id, row] of Object.entries(payload as Record<string, unknown>)) {
    const stats = row && typeof row === 'object' ? (row as { stats?: unknown }).stats ?? row : row
    map.set(id, stats)
  }
  return map
}
