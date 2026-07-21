/**
 * Player-game-stat ingestion: provider → normalization → PlayerGameStat → PlayerGameFact.
 *
 * Why this exists: `PlayerGameStat` had ZERO production rows. Its write path
 * (`ingestSportStats`) was fully built but had no caller — the only route that reached it
 * (`/api/internal/schedule-stats/ingest`) is a dormant external-push design gated on
 * `STATS_INGESTION_API_KEY`, which is unset, undocumented, and called by nothing. Downstream,
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
 * Reliability hardening (Phase 2, after the 2026-07-21 release exposed each of these live):
 * - Provider calls are AbortController-bounded (a hung Sleeper socket burned a full 300s
 *   function during the release backfill → FUNCTION_INVOCATION_TIMEOUT), and failures are
 *   tagged timeout/http/network rather than collapsed to null.
 * - Week completion is an explicit LEDGER (existing `StatIngestionJob` table, no migration),
 *   not "some stats exist": the release left week 16 with stats-but-no-facts and week 1 with
 *   only the 50 pilot rows, and presence-based detection skipped both.
 * - Partial weeks self-repair via facts-only regeneration — no provider call, stats untouched.
 * - Stale `running` telemetry rows are swept (status `timed_out`, history preserved) and the
 *   run lock is acquired atomically (single INSERT ... WHERE NOT EXISTS), closing the
 *   find-then-create race.
 */

import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { ingestSportStats } from '@/lib/schedule-stats'
import { generateGameFactsFromExistingStats } from '@/lib/data-warehouse/HistoricalFactGenerator'

export interface ProviderWeekStatRow {
  playerId: string
  gameId: string | null
  stats: Record<string, number>
}

export type WeekFetchFailureKind = 'timeout' | 'http' | 'network'

export type WeekFetchOutcome =
  | { ok: true; rows: ProviderWeekStatRow[] }
  | { ok: false; failure: WeekFetchFailureKind; status?: number }

export interface WeeklyStatsFetchArgs {
  sport: 'NFL'
  season: number
  week: number
  seasonType: 'regular' | 'post'
}

export interface WeeklyStatsFetcher {
  /** Never throws; failures come back tagged so telemetry can name the cause. */
  fetchWeek(args: WeeklyStatsFetchArgs): Promise<WeekFetchOutcome>
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

/**
 * Per-request provider timeout. Well under the 300s function budget so a single hung socket
 * costs one bounded slot, not the whole invocation. No automatic retry — the week stays
 * non-completed in the ledger and the next run picks it up.
 */
export const PROVIDER_REQUEST_TIMEOUT_MS = 20_000

/** A run/job row older than this with no completion is considered stale and swept. */
export const STALE_RUN_THRESHOLD_MS = 10 * 60 * 1000

/** Ledger identity for this pipeline inside the shared StatIngestionJob table. */
const LEDGER_SOURCE = 'sleeper-weekly'
const LOCK_JOB_NAME = 'import-player-game-stats'

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

type FetchImpl = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

/** Production fetcher: Sleeper free stats API, AbortController-bounded per request. */
export class SleeperWeeklyStatsFetcher implements WeeklyStatsFetcher {
  constructor(
    private readonly timeoutMs: number = PROVIDER_REQUEST_TIMEOUT_MS,
    private readonly fetchImpl: FetchImpl = fetch as unknown as FetchImpl,
  ) {}

  async fetchWeek(args: WeeklyStatsFetchArgs): Promise<WeekFetchOutcome> {
    const url = `https://api.sleeper.com/stats/nfl/${args.season}/${args.week}?season_type=${args.seasonType}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await this.fetchImpl(url, { headers: { accept: 'application/json' }, signal: controller.signal })
      if (!res.ok) return { ok: false, failure: 'http', status: res.status }
      return { ok: true, rows: parseSleeperWeekPayload(await res.json()) }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return { ok: false, failure: 'timeout' }
      return { ok: false, failure: 'network' }
    } finally {
      clearTimeout(timer)
    }
  }
}

// ── Week-completion ledger (existing StatIngestionJob table; no migration) ────────────────

async function openWeekLedger(season: number, week: number): Promise<string> {
  const row = await prisma.statIngestionJob.create({
    data: { sportType: 'NFL', season, weekOrRound: week, source: LEDGER_SOURCE, status: 'fetching' },
    select: { id: true },
  })
  return row.id
}

async function markWeekLedger(
  id: string,
  status: 'stats_written' | 'facts_generated' | 'completed' | 'partial' | 'failed',
  updates?: { statCount?: number; errorMessage?: string }
): Promise<void> {
  await prisma.statIngestionJob.update({
    where: { id },
    data: {
      status,
      ...(updates?.statCount != null ? { statCount: updates.statCount } : {}),
      ...(updates?.errorMessage ? { errorMessage: updates.errorMessage.slice(0, 500) } : {}),
      ...(status === 'completed' || status === 'partial' || status === 'failed'
        ? { completedAt: new Date() }
        : {}),
    },
  }).catch((err) => {
    console.error('[player-game-stats] ledger update failed:', err instanceof Error ? err.message : err)
  })
}

export interface WeekWorkPlan {
  /** Weeks with no usable data at all — need a full provider fetch. */
  missing: number[]
  /** Weeks whose stats exist but whose facts don't reconcile — repairable WITHOUT a provider call. */
  partial: number[]
  /** Weeks proven complete (ledger says completed, or stats/facts counts reconcile). */
  completed: number[]
}

/**
 * Ledger-driven work selection. A week is complete only when a ledger row says `completed`
 * OR its stat/fact counts reconcile (the grandfather clause for weeks ingested before the
 * ledger existed — also what makes fact-drift self-detecting). Presence of stats alone is
 * explicitly NOT completion: that heuristic is what let a pilot-limited week 1 and a
 * facts-missing week 16 read as "done" during the release.
 */
export async function findWeeksNeedingWork(season: number): Promise<WeekWorkPlan> {
  const [ledgerCompleted, statWeeks, factWeeks] = await Promise.all([
    prisma.statIngestionJob.findMany({
      where: { sportType: 'NFL', season, source: LEDGER_SOURCE, status: 'completed' },
      select: { weekOrRound: true },
    }),
    prisma.playerGameStat.groupBy({
      by: ['weekOrRound'],
      where: { sportType: 'NFL', season },
      _count: { _all: true },
    }),
    prisma.playerGameFact.groupBy({
      by: ['weekOrRound'],
      where: { sport: 'NFL', season },
      _count: { _all: true },
    }),
  ])

  const ledgerDone = new Set(ledgerCompleted.map((row) => row.weekOrRound))
  const statCounts = new Map(statWeeks.map((row) => [row.weekOrRound, row._count._all]))
  const factCounts = new Map(factWeeks.map((row) => [row.weekOrRound ?? -1, row._count._all]))

  const missing: number[] = []
  const partial: number[] = []
  const completed: number[] = []
  for (let week = 1; week <= MAX_NFL_WEEK; week += 1) {
    const stats = statCounts.get(week) ?? 0
    const facts = factCounts.get(week) ?? 0
    if (ledgerDone.has(week) || (stats > 0 && facts === stats)) completed.push(week)
    else if (stats > 0) partial.push(week)
    else missing.push(week)
  }
  return { missing, partial, completed }
}

/**
 * Facts-only repair for a partial week: regenerate PlayerGameFact from the stats already in
 * the DB. No provider call, stats untouched (regeneration is scoped delete+create of FACTS).
 * Records a ledger row so the repair is auditable, completed only after validation.
 */
export async function repairWeekFacts(season: number, week: number): Promise<ImportWeekReport> {
  const ledgerId = await openWeekLedger(season, week)
  try {
    const statCount = await prisma.playerGameStat.count({ where: { sportType: 'NFL', season, weekOrRound: week } })
    await markWeekLedger(ledgerId, 'stats_written', { statCount })
    const facts = await generateGameFactsFromExistingStats('NFL', season, week)
    await markWeekLedger(ledgerId, 'facts_generated')
    const validated = facts.playerFacts === statCount
    await markWeekLedger(ledgerId, validated ? 'completed' : 'partial', {
      statCount,
      ...(validated ? {} : { errorMessage: `validation mismatch: stats=${statCount} facts=${facts.playerFacts}` }),
    })
    return {
      season, week, fetched: 0, teamRowsFiltered: 0, ingested: 0,
      matchedPlayers: 0, unresolvedPlayers: 0,
      playerFactsGenerated: facts.playerFacts,
      factStatus: validated ? `repaired_${facts.status}` : 'repair_mismatch',
      dryRun: false,
    }
  } catch (err) {
    await markWeekLedger(ledgerId, 'failed', { errorMessage: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

/**
 * Ingest one (season, week) through the full pipeline with ledger tracking. Idempotent:
 * PlayerGameStat's unique key is (playerId, sportType, gameId) and gameId is deterministic.
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
}): Promise<ImportWeekReport | { providerFailure: WeekFetchFailureKind; status?: number }> {
  const seasonType = args.seasonType ?? 'regular'
  const outcome = await args.fetcher.fetchWeek({ sport: 'NFL', season: args.season, week: args.week, seasonType })
  if (!outcome.ok) {
    if (!args.dryRun) {
      // Record the failed attempt so "provider timed out on week N" is queryable, not folklore.
      const ledgerId = await openWeekLedger(args.season, args.week).catch(() => null)
      if (ledgerId) {
        await markWeekLedger(ledgerId, 'failed', {
          errorMessage: `provider ${outcome.failure}${outcome.status ? ` (HTTP ${outcome.status})` : ''} season=${args.season} week=${args.week}`,
        })
      }
    }
    return { providerFailure: outcome.failure, status: outcome.status }
  }
  const rows = outcome.rows

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
    const ledgerId = await openWeekLedger(args.season, args.week)
    try {
      const result = await ingestSportStats({
        sportType: 'NFL',
        season: args.season,
        weekOrRound: args.week,
        source: 'sleeper',
        playerStats,
      })
      ingested = result.playerStatCount
      await markWeekLedger(ledgerId, 'stats_written', { statCount: ingested })

      if (args.generateFacts !== false) {
        const facts = await generateGameFactsFromExistingStats('NFL', args.season, args.week)
        playerFactsGenerated = facts.playerFacts
        factStatus = facts.status
        await markWeekLedger(ledgerId, 'facts_generated')
        // Validation before completion: fact count must reconcile with the stats now in the
        // DB for this scope. `limit`ed smoke runs won't reconcile against a fuller week —
        // they stay `partial`, which is exactly right (the release's pilot-week-1 lesson).
        const statCount = await prisma.playerGameStat.count({ where: { sportType: 'NFL', season: args.season, weekOrRound: args.week } })
        const validated = facts.playerFacts === statCount
        await markWeekLedger(ledgerId, validated ? 'completed' : 'partial', { statCount })
      } else {
        await markWeekLedger(ledgerId, 'partial', { errorMessage: 'facts generation skipped by caller' })
      }
    } catch (err) {
      await markWeekLedger(ledgerId, 'failed', { errorMessage: err instanceof Error ? err.message : String(err) })
      throw err
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
 * Resolve which season actually has data: providers 400/empty on a season that hasn't started,
 * so walk back up to SEASON_FALLBACK_MAX_YEARS until week 1 returns rows.
 */
export async function resolveIngestableSeason(
  requestedSeason: number,
  fetcher: WeeklyStatsFetcher
): Promise<{ season: number; fallbackUsed: boolean } | null> {
  for (let back = 0; back <= SEASON_FALLBACK_MAX_YEARS; back += 1) {
    const candidate = requestedSeason - back
    if (candidate <= 2000) break
    const probe = await fetcher.fetchWeek({ sport: 'NFL', season: candidate, week: 1, seasonType: 'regular' })
    if (probe.ok && probe.rows.length > 0) return { season: candidate, fallbackUsed: back > 0 }
  }
  return null
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

/**
 * Schema preflight: true only when prod's player_game_stats table carries the
 * provider-telemetry columns the Prisma client's upsert RETURNING requires.
 */
export async function isPlayerGameStatsSchemaReady(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ ok: number }>>`
    SELECT 1 AS ok FROM information_schema.columns
    WHERE table_name = 'player_game_stats' AND column_name = 'provider_player_id'
    LIMIT 1`
  return rows.length > 0
}

// ── Stale-state sweep + atomic run lock ───────────────────────────────────────────────────

export interface StaleSweepResult {
  sweptRuns: number
  sweptLedger: number
}

/**
 * Sweep stale telemetry: a `running` SyncJobRun (or an in-flight ledger row) older than
 * STALE_RUN_THRESHOLD_MS with no completion means the function died mid-run (the release's
 * FUNCTION_INVOCATION_TIMEOUT left exactly one). Rows are marked `timed_out`/`abandoned`
 * with start time and context preserved — history is never deleted.
 */
export async function sweepStaleIngestionState(): Promise<StaleSweepResult> {
  const cutoff = new Date(Date.now() - STALE_RUN_THRESHOLD_MS)
  const [sweptRuns, sweptLedger] = await Promise.all([
    prisma.syncJobRun.updateMany({
      where: { jobName: LOCK_JOB_NAME, status: 'running', startedAt: { lt: cutoff } },
      data: {
        status: 'timed_out',
        completedAt: new Date(),
        errorMessage: `swept: still 'running' past the ${STALE_RUN_THRESHOLD_MS / 1000}s stale threshold (function likely hit its execution limit)`,
      },
    }),
    prisma.statIngestionJob.updateMany({
      where: {
        source: LEDGER_SOURCE,
        status: { in: ['fetching', 'stats_written', 'facts_generated'] },
        startedAt: { lt: cutoff },
      },
      data: { status: 'abandoned', completedAt: new Date() },
    }),
  ])
  return { sweptRuns: sweptRuns.count, sweptLedger: sweptLedger.count }
}

/**
 * Atomic run-lock acquisition: one INSERT that only lands when no live `running` row exists.
 * Replaces the released find-then-create sequence, whose read→write gap let two simultaneous
 * invocations both believe they owned the run. A partial unique index
 * (`ON sync_job_runs(job_name) WHERE status='running'`) was evaluated as the stronger
 * alternative — rejected for now because it requires a migration and this single-statement
 * guard closes the race without one; revisit if more jobs adopt the pattern.
 * Returns the lock row id, or null when another live run holds it.
 */
export async function acquireRunLock(trigger: string): Promise<string | null> {
  const id = randomUUID()
  const cutoff = new Date(Date.now() - STALE_RUN_THRESHOLD_MS)
  const inserted = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO sync_job_runs (id, job_name, job_scope, trigger, status, rows_read, rows_written, rows_skipped, started_at, created_at)
    SELECT ${id}, ${LOCK_JOB_NAME}, 'NFL', ${trigger}, 'running', 0, 0, 0, NOW(), NOW()
    WHERE NOT EXISTS (
      SELECT 1 FROM sync_job_runs
      WHERE job_name = ${LOCK_JOB_NAME} AND status = 'running' AND started_at > ${cutoff}
    )
    RETURNING id`
  return inserted.length > 0 ? inserted[0].id : null
}

// ── Fact reconciliation ───────────────────────────────────────────────────────────────────

export interface WeekReconciliation {
  week: number
  statCount: number
  factCountBefore: number
  factCountAfter: number | null
  action: 'repaired' | 'skipped_healthy' | 'skipped_no_stats' | 'would_repair' | 'failed'
  error?: string
}

export interface SeasonReconciliationReport {
  season: number
  weeksScanned: number
  repaired: number
  skipped: number
  failed: number
  weeks: WeekReconciliation[]
  dryRun: boolean
}

/**
 * Detect and repair stat/fact drift for a season: weeks with stats but no facts, mismatched
 * counts (covers missing pairs, duplicates, and orphaned facts alike — regeneration is a pure
 * function of the stat rows), bounded per week, safe to rerun. Healthy weeks are untouched.
 */
export async function reconcilePlayerGameFacts(args: {
  season: number
  week?: number
  dryRun?: boolean
  maxRepairs?: number
}): Promise<SeasonReconciliationReport> {
  const dryRun = args.dryRun !== false // dry-run unless explicitly disabled
  const [statWeeks, factWeeks] = await Promise.all([
    prisma.playerGameStat.groupBy({
      by: ['weekOrRound'],
      where: { sportType: 'NFL', season: args.season, ...(args.week ? { weekOrRound: args.week } : {}) },
      _count: { _all: true },
    }),
    prisma.playerGameFact.groupBy({
      by: ['weekOrRound'],
      where: { sport: 'NFL', season: args.season, ...(args.week ? { weekOrRound: args.week } : {}) },
      _count: { _all: true },
    }),
  ])
  const statCounts = new Map(statWeeks.map((row) => [row.weekOrRound, row._count._all]))
  const factCounts = new Map(factWeeks.map((row) => [row.weekOrRound ?? -1, row._count._all]))

  const weeks: WeekReconciliation[] = []
  let repaired = 0
  let skipped = 0
  let failed = 0
  const maxRepairs = args.maxRepairs ?? MAX_NFL_WEEK

  const candidateWeeks = args.week
    ? [args.week]
    : Array.from(new Set([...statCounts.keys(), ...factCounts.keys()])).filter((w) => w > 0).sort((a, b) => a - b)

  for (const week of candidateWeeks) {
    const statCount = statCounts.get(week) ?? 0
    const factCountBefore = factCounts.get(week) ?? 0
    if (statCount === 0) {
      weeks.push({ week, statCount, factCountBefore, factCountAfter: null, action: 'skipped_no_stats' })
      skipped += 1
      continue
    }
    if (statCount === factCountBefore) {
      weeks.push({ week, statCount, factCountBefore, factCountAfter: factCountBefore, action: 'skipped_healthy' })
      skipped += 1
      continue
    }
    if (dryRun) {
      weeks.push({ week, statCount, factCountBefore, factCountAfter: null, action: 'would_repair' })
      continue
    }
    if (repaired >= maxRepairs) break
    try {
      const result = await repairWeekFacts(args.season, week)
      weeks.push({ week, statCount, factCountBefore, factCountAfter: result.playerFactsGenerated, action: 'repaired' })
      repaired += 1
    } catch (err) {
      weeks.push({
        week, statCount, factCountBefore, factCountAfter: null, action: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
      failed += 1
    }
  }

  return { season: args.season, weeksScanned: candidateWeeks.length, repaired, skipped, failed, weeks, dryRun }
}
