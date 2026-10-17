/**
 * Fantasy OS — "Refresh my lineups": bring ONE user's connected leagues' rosters current, now.
 *
 * The game-day list reads `Roster.playerData.starters` from Postgres. Measured on production
 * 2026-09-27 at 07:55 ET on a Sunday: Sleeper rosters were a median 2.2h old, and the five-minute
 * active lane (activeSyncLane.ts, 4 leagues per provider per tick) had attempted 19 leagues in the
 * previous hour out of ~350. So a manager who benched an inactive on Sleeper at 12:40 came back to a
 * list that still flagged him — the one failure that makes a game-day tool untrustworthy.
 *
 * ── WHAT THIS RUNS ───────────────────────────────────────────────────────────────────────────
 *
 * The SAME durable collector the lane runs (`syncConnectedLeague`), with the lane's own state key
 * (`<runKey>:active`), so it shares the lane's lock and freshness bookkeeping and never disturbs the
 * full collector's cadence. Only the `teams_rosters` scope, forced past the cadence gate, with a
 * tight per-league timeout. Provider reads stay inside the ingestion layer (DB-first boundary):
 * the route that calls this never touches a provider itself.
 *
 * ── WHO CAN BE REFRESHED ─────────────────────────────────────────────────────────────────────
 *
 * The candidate set is recomputed from the database on every call: leagues where THIS user has a
 * claimed team, this season, on a syncable provider. A client cannot name a league — authorization
 * is by construction, the same stance as POST /api/core/sync.
 *
 * ── A BATCH PER CALL, AND THE CLIENT LOOPS ───────────────────────────────────────────────────
 *
 * A league takes p50 1.9s / p95 7.3s on the lane. Sixty-five leagues do not fit one request, so each
 * call starts leagues until its time budget is spent and reports `remaining`. It is stateless: a
 * league attempted inside `RECENT_ATTEMPT_MS` is not "remaining", so the next call naturally moves
 * on, and a double-click cannot refresh the same league twice.
 */
import { prisma } from '@/lib/prisma'
import { buildRunKey } from './enumerate'
import { ACTIVE_LANE_SUFFIX, ACTIVE_SYNC_CADENCE_MINUTES } from './activeSyncLane'
import { syncConnectedLeague, type SyncConnectedDeps, type SyncConnectedResult } from './syncConnectedSleeperLeague'
import { SYNCABLE_PROVIDERS, type LeagueSyncConnection } from './types'
import type { ImportProvider } from '@/lib/league-import/types'

/** A league refreshed inside this window is done for this round of clicks. */
export const RECENT_ATTEMPT_MS = 3 * 60_000
/** Stop STARTING leagues after this much of the request; the ones in flight still finish. */
export const LINEUP_REFRESH_BUDGET_MS = 20_000
/** Per-league bound. Well above the lane's p95 (7.3s), well below a request's patience. */
export const LINEUP_REFRESH_LEAGUE_TIMEOUT_MS = 15_000
const CONCURRENCY = 5

export type LineupRefreshOutcome = {
  runKey: string
  provider: string
  /** refreshed = rosters written; busy = the lane or another click holds the lock; skipped = the collector declined (no credentials, league gone); failed = it threw or failed. */
  status: 'refreshed' | 'busy' | 'skipped' | 'failed'
  reason?: string
}

export type LineupRefreshResult = {
  /** Distinct connected leagues this user can refresh. */
  total: number
  attempted: LineupRefreshOutcome[]
  /** Leagues still waiting for a refresh after this call — post again to continue. */
  remaining: number
}

function activeSeasonYear(now: Date): number {
  return now.getUTCMonth() <= 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear()
}

/** The user's own connected leagues this season, one connection per (provider, league, season), keyed on the active lane. */
export async function lineupRefreshCandidates(
  userId: string,
  now: Date = new Date(),
  /**
   * Narrow to ONE AllFantasy league (Chimmy's "Refresh" under an answer). It filters inside the
   * claimed-team query, so a league the user has no claimed team in simply yields nothing — the
   * client can name a league but can never widen what it may refresh.
   */
  onlyLeagueId?: string | null,
): Promise<LeagueSyncConnection[]> {
  const season = activeSeasonYear(now)
  const teams = await prisma.leagueTeam.findMany({
    where: { claimedByUserId: userId, league: { season, ...(onlyLeagueId ? { id: onlyLeagueId } : {}) } },
    select: { league: { select: { platform: true, platformLeagueId: true, season: true, sport: true } } },
  })
  const byKey = new Map<string, LeagueSyncConnection>()
  for (const t of teams) {
    const l = t.league
    const provider = String(l?.platform ?? '').toLowerCase() as ImportProvider
    if (!l || !l.platformLeagueId || !SYNCABLE_PROVIDERS.includes(provider as (typeof SYNCABLE_PROVIDERS)[number])) continue
    const runKey = `${buildRunKey(provider, l.platformLeagueId, l.season)}:${ACTIVE_LANE_SUFFIX}`
    if (!byKey.has(runKey)) {
      byKey.set(runKey, { runKey, provider, externalLeagueId: l.platformLeagueId, season: l.season, sport: String(l.sport) })
    }
  }
  return [...byKey.values()]
}

function outcomeOf(connection: LeagueSyncConnection, sync: SyncConnectedResult): LineupRefreshOutcome {
  const base = { runKey: connection.runKey, provider: connection.provider }
  const status = sync.status ?? sync.result?.status
  if (status === 'completed' || status === 'partial') return { ...base, status: 'refreshed' }
  if (status === 'locked') return { ...base, status: 'busy', reason: 'already refreshing' }
  if (status === 'failed') return { ...base, status: 'failed', reason: sync.warning ?? 'the refresh failed' }
  return { ...base, status: 'skipped', reason: sync.reason ?? sync.warning ?? 'not refreshed' }
}

export async function refreshLineupsNow(input: {
  userId: string
  /** Only this AllFantasy league, when the user holds a claimed team in it. See `lineupRefreshCandidates`. */
  leagueId?: string | null
  now?: Date
  budgetMs?: number
  /** Test seam: a fixture loader, never a provider. */
  deps?: Pick<SyncConnectedDeps, 'fetchNormalized' | 'skipCredentialPreflight' | 'clock'>
}): Promise<LineupRefreshResult> {
  const now = input.now ?? new Date()
  const startedAt = Date.now()
  const budgetMs = input.budgetMs ?? LINEUP_REFRESH_BUDGET_MS

  const candidates = await lineupRefreshCandidates(input.userId, now, input.leagueId)
  if (candidates.length === 0) return { total: 0, attempted: [], remaining: 0 }

  const states = await prisma.leagueSyncState.findMany({
    where: { runKey: { in: candidates.map((c) => c.runKey) } },
    select: { runKey: true, lastAttemptedSyncAt: true },
  })
  const attemptedAt = new Map(states.map((s) => [s.runKey, s.lastAttemptedSyncAt?.getTime() ?? 0]))
  // Oldest attempt first; anything attempted in the last few minutes is already current enough.
  const todo = candidates
    .filter((c) => now.getTime() - (attemptedAt.get(c.runKey) ?? 0) >= RECENT_ATTEMPT_MS)
    .sort((a, b) => (attemptedAt.get(a.runKey) ?? 0) - (attemptedAt.get(b.runKey) ?? 0))

  const attempted: LineupRefreshOutcome[] = []
  let next = 0
  const worker = async () => {
    while (next < todo.length && Date.now() - startedAt < budgetMs) {
      const connection = todo[next++]
      try {
        const sync = await syncConnectedLeague(connection, now, {
          ...input.deps,
          force: true,
          scopes: ['teams_rosters'],
          cadenceMinutesOverride: ACTIVE_SYNC_CADENCE_MINUTES,
          matchupStaleThresholdMs: ACTIVE_SYNC_CADENCE_MINUTES * 60_000,
          runTimeoutMs: LINEUP_REFRESH_LEAGUE_TIMEOUT_MS,
        })
        attempted.push(outcomeOf(connection, sync))
      } catch (err) {
        // Never echo the error text: a provider URL can carry a credential (CLAUDE.md, Credentials).
        void err
        attempted.push({ runKey: connection.runKey, provider: connection.provider, status: 'failed', reason: 'the refresh failed' })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker))

  return { total: candidates.length, attempted, remaining: Math.max(0, todo.length - next) }
}
