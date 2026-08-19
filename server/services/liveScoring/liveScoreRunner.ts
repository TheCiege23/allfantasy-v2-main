/**
 * Live scoring scheduled runner (G11 Phase 3b).
 *
 * Ties the reusable Phase 3 orchestrator to real data: for each active redraft
 * season it builds `LiveTickDeps` from the injected `LiveStatsProvider` + Prisma +
 * the canonical engine, then runs ONE `runLiveScoringTick`. Provider and broadcast
 * are injected so the cron uses the real NFL provider while staging/tests use a
 * fixture — no network, no production writes.
 *
 * Honors every Phase 3 guarantee: skip weeks with no active games (cadence), fetch
 * only active games, persist only changed stat lines, rescore only affected
 * matchups/standings, broadcast only affected entities.
 */

import type { PrismaClient } from '@prisma/client'
import { recalculateMatchupsForSeasonWeek, isScoringStarterSlot } from '@/lib/redraft/scoringEngine'
import { updateStandings } from '@/lib/redraft/standingsEngine'
import { leagueRealtimeStore } from '@/lib/league-events/realtime-store'
import { runLiveScoringTick, type LiveBroadcastEvent, type LiveTickResult } from '@/lib/live-scoring/orchestrator'
import { gamesToSnapshots, type LiveStatsProvider } from '@/lib/live-scoring/provider'
import { NflLiveStatsProvider } from '@/lib/live-scoring/nflLiveStatsProvider'
import type { RescoreRosterInput, RescoreMatchupInput } from '@/lib/live-scoring/rescorePlan'

export type ActiveSeasonForTick = {
  id: string
  leagueId: string
  sport: string
  season: number
  currentWeek: number
}

export type LiveScoreRunnerDeps = {
  /** Defaults to the real NFL provider; tests/staging inject a fixture. */
  provider?: LiveStatsProvider
  /** Defaults to the SSE store; tests inject a collector. */
  broadcast?: (leagueId: string, events: readonly LiveBroadcastEvent[]) => void
  now?: Date
}

export type SeasonTickSummary = {
  seasonId: string
  leagueId: string
  week: number
  polled: boolean
  changedPlayers: number
  affectedMatchups: number
  broadcastEvents: number
  /** This season's own next-poll cadence (ms); 0 = nothing active. */
  nextPollDelayMs: number
  reason: string
}

function asNumberStats(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(v)
    if (Number.isFinite(n)) out[k] = n
  }
  return out
}

/** Default broadcaster: publish each affected-entity event to the league SSE stream. */
function publishToSse(leagueId: string, events: readonly LiveBroadcastEvent[]): void {
  for (const e of events) leagueRealtimeStore.publish(leagueId, { eventType: e.eventType, meta: e.meta })
}

/**
 * Run one live tick for a single active season. Returns the orchestrator result.
 * Exported so the cron and the staging E2E share the exact same path.
 */
export async function runLiveScoringTickForSeason(
  prisma: PrismaClient,
  season: ActiveSeasonForTick,
  deps: LiveScoreRunnerDeps = {},
): Promise<LiveTickResult> {
  const provider = deps.provider ?? new NflLiveStatsProvider(prisma)
  const broadcast = deps.broadcast ?? publishToSse
  const week = Math.max(1, season.currentWeek || 1)
  const query = { sport: season.sport, season: season.season, week }

  const games = await provider.fetchActiveGames(query)
  const snapshots = gamesToSnapshots(games)

  return runLiveScoringTick(snapshots, {
    fetchActiveStats: async () => {
      // Only rostered starters are worth fetching (matchup-affecting players).
      const starters = await prisma.redraftRosterPlayer.findMany({
        where: { droppedAt: null, roster: { seasonId: season.id } },
        select: { playerId: true, slotType: true },
      })
      const offensiveIds: string[] = []
      for (const s of starters) {
        if (!isScoringStarterSlot(s.slotType)) continue
        if (!String(s.playerId).startsWith('nfl:def:')) offensiveIds.push(s.playerId)
      }
      const [playerStats, defStats] = await Promise.all([
        provider.fetchPlayerStatsForGames({ ...query, games, playerIds: offensiveIds }),
        provider.fetchTeamDefenseStatsForGames({ ...query, games }),
      ])
      const merged = new Map<string, Record<string, number>>()
      for (const [id, st] of playerStats) merged.set(id, st)
      for (const [id, st] of defStats) merged.set(id, st)
      return merged
    },
    loadPreviousStats: async () => {
      const rows = await prisma.playerWeeklyScore.findMany({
        where: { week, season: season.season, sport: season.sport },
        select: { playerId: true, stats: true },
      })
      return new Map(rows.map((r: { playerId: string; stats: unknown }) => [r.playerId, asNumberStats(r.stats)]))
    },
    loadTopology: async () => {
      const rosters = await prisma.redraftRoster.findMany({
        where: { seasonId: season.id },
        select: { id: true, players: { where: { droppedAt: null }, select: { playerId: true, slotType: true } } },
      })
      const matchups = await prisma.redraftMatchup.findMany({
        where: { seasonId: season.id, week },
        select: { id: true, homeRosterId: true, awayRosterId: true, status: true },
      })
      const matchupByRoster = new Map<string, string>()
      const matchupInputs: RescoreMatchupInput[] = []
      for (const m of matchups) {
        const status = m.status === 'final' || m.status === 'completed' ? 'final' : m.status === 'in_progress' || m.status === 'live' ? 'live' : 'upcoming'
        matchupInputs.push({ matchupId: m.id, status })
        matchupByRoster.set(m.homeRosterId, m.id)
        if (m.awayRosterId) matchupByRoster.set(m.awayRosterId, m.id)
      }
      const rosterInputs: RescoreRosterInput[] = rosters.map(
        (r: { id: string; players: Array<{ playerId: string; slotType: string }> }) => ({
          rosterId: r.id,
          matchupId: matchupByRoster.get(r.id) ?? null,
          scoringPlayerIds: r.players.filter((p) => isScoringStarterSlot(p.slotType)).map((p) => p.playerId),
        }),
      )
      return { rosters: rosterInputs, matchups: matchupInputs }
    },
    persistChangedStats: async (changed) => {
      for (const [playerId, stats] of changed) {
        await prisma.playerWeeklyScore.upsert({
          where: { playerId_week_season_sport: { playerId, week, season: season.season, sport: season.sport } },
          update: { stats, isFinalized: false },
          create: { playerId, week, season: season.season, sport: season.sport, fantasyPts: 0, isFinalized: false, stats },
        })
      }
    },
    applyRescore: async (plan) => {
      await recalculateMatchupsForSeasonWeek(season.id, week)
      if (plan.standingsImpacted) await updateStandings(season.id, week).catch(() => undefined)
    },
    broadcast: (events) => broadcast(season.leagueId, events),
  }, deps.now ?? new Date())
}

/**
 * Run a live tick for every active redraft season. Idempotent + production-safe.
 * Skips seasons with no active games (the orchestrator's cadence short-circuits the
 * fetch). Failures are isolated per season.
 */
export async function runLiveScoringForActiveSeasons(
  prisma: PrismaClient,
  deps: LiveScoreRunnerDeps = {},
): Promise<{ ticked: number; polled: number; nextPollDelayMs: number; summaries: SeasonTickSummary[] }> {
  const seasons = (await prisma.redraftSeason.findMany({
    where: { status: 'active' },
    select: { id: true, leagueId: true, sport: true, season: true, currentWeek: true },
  })) as ActiveSeasonForTick[]

  const summaries: SeasonTickSummary[] = []
  let polled = 0
  for (const season of seasons) {
    try {
      const res = await runLiveScoringTickForSeason(prisma, season, deps)
      if (res.polled) polled += 1
      summaries.push({
        seasonId: season.id,
        leagueId: season.leagueId,
        week: Math.max(1, season.currentWeek || 1),
        polled: res.polled,
        changedPlayers: res.changedPlayerIds.length,
        affectedMatchups: res.plan.affectedMatchupIds.length,
        broadcastEvents: res.events.length,
        nextPollDelayMs: res.nextPollDelayMs,
        reason: res.reason,
      })
    } catch (err) {
      summaries.push({
        seasonId: season.id,
        leagueId: season.leagueId,
        week: Math.max(1, season.currentWeek || 1),
        polled: false,
        changedPlayers: 0,
        affectedMatchups: 0,
        broadcastEvents: 0,
        nextPollDelayMs: 0,
        reason: `error: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }
  // Aggregate cadence for a long-running worker: the tightest positive cadence
  // across seasons (30s if any game is live), or 0 when nothing is active.
  const positive = summaries.map((s) => s.nextPollDelayMs).filter((ms) => ms > 0)
  const nextPollDelayMs = positive.length > 0 ? Math.min(...positive) : 0
  return { ticked: seasons.length, polled, nextPollDelayMs, summaries }
}
