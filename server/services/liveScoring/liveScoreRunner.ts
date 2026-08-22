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
import { gamesToSnapshots, type LiveSeasonType, type LiveStatsProvider } from '@/lib/live-scoring/provider'
import { normalizeLiveGameStatus } from '@/lib/live-scoring/cadence'
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
  /** Overrides the resolved season type. Tests and manual backfills pass this. */
  seasonType?: LiveSeasonType
  now?: Date
}

/**
 * Which NFL slate `now` falls in.
 *
 * ⚠ THIS IS A DATE HEURISTIC, AND A DATE HEURISTIC IS THE WEAKER ANSWER. The
 * feeds themselves carry the truth — Rolling Insights returns `season_type`
 * verbatim per game — but the incumbent path reads `prisma.sportsGame`, which has
 * no season-type column and stores preseason week 1 and regular week 1 under the
 * same `week` value. Until that column exists, the calendar is the only signal
 * available here, so it is used deliberately and kept narrow.
 *
 * ⚠ ONLY 'pre' IS INFERRED. July–August is unambiguously preseason for the NFL
 * (the Hall of Fame game through the final tune-up; the opener is the Thursday
 * after Labor Day). Everything else returns 'regular' — including January, which
 * is regular-season weeks 17–18 before it is ever the playoffs. Inferring 'post'
 * from a month would misfile those weeks, and a wrong season type fetches the
 * wrong slate entirely rather than failing loudly.
 */
export function resolveNflSeasonType(now: Date): LiveSeasonType {
  const month = now.getMonth() + 1
  return month === 7 || month === 8 ? 'pre' : 'regular'
}

/** One scheduled game, reduced to what slate resolution needs. */
export type SlateCandidate = {
  seasonType: string | null
  week: number | null
  startTime: Date | null
  status: string | null
}

export type ResolvedSlate = {
  seasonType: LiveSeasonType
  /** Null when the schedule could not name a week; caller keeps its own. */
  week: number | null
  /** How this was decided — surfaced in telemetry so a wrong slate is diagnosable. */
  source: 'schedule' | 'calendar-fallback'
}

/** Rows this close to `now` are candidates for "which slate is on right now". */
const SLATE_WINDOW_BEFORE_MS = 6 * 60 * 60 * 1000
const SLATE_WINDOW_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Which slate and week are actually being played, decided from the schedule.
 *
 * ⚠ THIS REPLACES A MONTH CHECK, AND THAT MATTERS MOST FOR THE WEEK. The runner
 * used `RedraftSeason.currentWeek` for both, which is a FANTASY week: it is 0 or 1
 * for a season that has not kicked off, so an August tick asked for preseason
 * week 1 while the league was actually playing preseason week 3. Asking the
 * schedule what is on right now answers both questions from the same evidence.
 *
 * The in-flight game wins over the nearest kickoff, because a game being played
 * IS the current slate no matter what else is on the calendar. Ties fall to the
 * closest start time.
 *
 * ⚠ RETURNS THE CALENDAR FALLBACK RATHER THAN GUESSING A WEEK. If no row in the
 * window carries a season type, `week` comes back null and the caller keeps the
 * week it already had — a wrong week fetches a real but irrelevant slate, which
 * is far harder to notice than no change at all.
 */
export function pickSlate(rows: readonly SlateCandidate[], now: Date): ResolvedSlate | null {
  let best: { row: SlateCandidate; live: boolean; distance: number } | null = null

  for (const row of rows) {
    const seasonType = normalizeLiveSeasonType(row.seasonType)
    if (seasonType == null) continue
    if (row.startTime == null) continue
    const distance = Math.abs(row.startTime.getTime() - now.getTime())
    if (distance > SLATE_WINDOW_AFTER_MS) continue
    const live = isLivePlayStatus(row.status)
    if (
      best == null ||
      (live && !best.live) ||
      (live === best.live && distance < best.distance)
    ) {
      best = { row, live, distance }
    }
  }

  if (best == null) return null
  return {
    seasonType: normalizeLiveSeasonType(best.row.seasonType)!,
    week: best.row.week ?? null,
    source: 'schedule',
  }
}

/** Canonical-vocabulary check; the column is written by normalizeSeasonType. */
function normalizeLiveSeasonType(raw: string | null | undefined): LiveSeasonType | null {
  const v = String(raw ?? '').trim().toLowerCase()
  return v === 'pre' || v === 'regular' || v === 'post' ? v : null
}

function isLivePlayStatus(raw: string | null | undefined): boolean {
  const status = normalizeLiveGameStatus(raw)
  return status === 'in_progress' || status === 'halftime' || status === 'overtime'
}

/**
 * Read the schedule and decide the slate, falling back to the calendar.
 *
 * Scoped to a window around `now` rather than the whole season: a season's worth
 * of rows would let a January playoff game outvote tonight's game.
 */
export async function resolveSlate(
  prisma: PrismaClient,
  sport: string,
  season: number,
  now: Date,
): Promise<ResolvedSlate> {
  const fallback: ResolvedSlate = {
    seasonType:
      String(sport).toUpperCase() === 'NFL' ? resolveNflSeasonType(now) : 'regular',
    week: null,
    source: 'calendar-fallback',
  }

  try {
    const rows = await prisma.sportsGame.findMany({
      where: {
        sport,
        season,
        startTime: {
          gte: new Date(now.getTime() - SLATE_WINDOW_BEFORE_MS),
          lte: new Date(now.getTime() + SLATE_WINDOW_AFTER_MS),
        },
      },
      select: { seasonType: true, week: true, startTime: true, status: true },
    })
    return pickSlate(rows, now) ?? fallback
  } catch {
    // A schema not yet carrying `seasonType` must not take live scoring down.
    return fallback
  }
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
  /** Slate actually polled. 'pre' means nothing was persisted — see persistChangedStats. */
  seasonType: LiveSeasonType
  /** Whether the slate came from the schedule or the calendar fallback. */
  slateSource: ResolvedSlate['source']
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
): Promise<LiveTickResult & { slate: ResolvedSlate & { weekUsed: number } }> {
  const provider = deps.provider ?? new NflLiveStatsProvider(prisma)
  const broadcast = deps.broadcast ?? publishToSse
  const now = deps.now ?? new Date()

  const slate = await resolveSlate(prisma, season.sport, season.season, now)
  const seasonType = deps.seasonType ?? slate.seasonType

  /*
   * ⚠ THE FANTASY WEEK AND THE REAL-WORLD WEEK ARE ONLY THE SAME THING IN THE
   * REGULAR SEASON. `RedraftSeason.currentWeek` counts fantasy weeks and is 0 for
   * a season that has not started, so `Math.max(1, ...)` turned every preseason
   * tick into "week 1" — asking Sleeper for preseason week 1 on the night of
   * preseason week 3. In the regular season currentWeek IS authoritative and is
   * kept; outside it, the schedule is the only thing that knows.
   */
  const fantasyWeek = Math.max(1, season.currentWeek || 1)
  const week = seasonType === 'regular' ? fantasyWeek : slate.week ?? fantasyWeek

  const query = { sport: season.sport, season: season.season, week, seasonType }

  const games = await provider.fetchActiveGames(query)
  const snapshots = gamesToSnapshots(games)

  const result = await runLiveScoringTick(snapshots, {
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
      /*
       * ⚠ PRESEASON MUST NOT WRITE HERE, AND THIS IS NOT A PREFERENCE.
       * `playerWeeklyScore` is unique on (playerId, week, season, sport) — there
       * is NO season-type in that key. Persisting a preseason week 3 line would
       * occupy the exact row regular-season week 3 needs, so September's real
       * stats would either collide with August's exhibition numbers or silently
       * overwrite them. Nobody would see it until a manager's week 3 score was
       * wrong.
       *
       * The tick still fetches, still rescores, still broadcasts — so a preseason
       * night genuinely exercises the live path, which is the entire point of
       * running it. Only the durable write is withheld.
       *
       * Removing this guard requires a season-type discriminator on
       * playerWeeklyScore's unique key, not a judgement that it is probably fine.
       */
      if (seasonType !== 'regular') return
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
  }, now)

  /*
   * The slate travels with the result so telemetry records WHICH week was
   * actually polled. "0 changed players" during preseason is correct on a quiet
   * night and a bug if the week was wrong — and without this they look identical.
   */
  return { ...result, slate: { ...slate, seasonType, weekUsed: week } }
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
        // The week actually polled, not the fantasy week — during preseason
        // these differ, and reporting the fantasy one hid exactly that.
        week: res.slate.weekUsed,
        polled: res.polled,
        changedPlayers: res.changedPlayerIds.length,
        affectedMatchups: res.plan.affectedMatchupIds.length,
        broadcastEvents: res.events.length,
        nextPollDelayMs: res.nextPollDelayMs,
        reason: res.reason,
        seasonType: res.slate.seasonType,
        slateSource: res.slate.source,
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
        // The tick threw before it could resolve a slate; do not imply otherwise.
        seasonType: 'regular',
        slateSource: 'calendar-fallback',
      })
    }
  }
  // Aggregate cadence for a long-running worker: the tightest positive cadence
  // across seasons (30s if any game is live), or 0 when nothing is active.
  const positive = summaries.map((s) => s.nextPollDelayMs).filter((ms) => ms > 0)
  const nextPollDelayMs = positive.length > 0 ? Math.min(...positive) : 0
  return { ticked: seasons.length, polled, nextPollDelayMs, summaries }
}
