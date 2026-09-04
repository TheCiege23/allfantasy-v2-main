/**
 * Fantasy OS — synchronize ONE connected league, of any provider, through the durable runner.
 *
 * Resolves the season-aware cadence, decides whether the connection is due (never hammering the
 * provider), then drives `runSync` with the Prisma store + AutomationLock + memoized Sleeper fetcher.
 * The normalized-payload loader is injectable (`fetchNormalized`) so tests drive deterministic
 * controlled fixtures without touching the live Sleeper API; production defaults to the canonical
 * `runImportedLeagueNormalizationPipeline` (a single live provider burst per run).
 */
import type { NormalizedImportResult } from '@/lib/league-import/types'
import { prisma } from '@/lib/prisma'
import { resolveCadence, isInSeason } from '@/lib/import-os/season'
import { isSyncDue } from '@/lib/import-os/freshness'
import {
  runSync,
  type Clock,
  type Rng,
  type Sleep,
  type RunResult,
  type SyncScope,
} from '@/lib/import-os/runner'
import { createSleeperScopeFetcher } from './sleeperScopeFetcher'
import {
  fetchNormalizedForConnection,
  resolveStoredCredentialUserIds,
} from './normalizedLoader'
import { createPrismaSleeperSyncStore } from './prismaSyncStore'
import { createAutomationSyncLock } from './automationSyncLock'
import { ensureMatchupsCached } from '@/lib/rankings-engine/sleeper-matchup-cache'
import { ingestSleeperPlayerScoresForWeek } from '@/lib/sleeper/sync/ingestSleeperPlayerScores'

/** NFL regular season + playoffs. The cache only fetches weeks it lacks. */
const MAX_WEEKS = 18
import {
  LEAGUE_SYNC_SCOPES,
  providerNeedsCredential,
  type LeagueSyncConnection,
  type SleeperSyncConnection,
} from './types'

const realClock: Clock = { now: () => new Date() }
const realRng: Rng = { next: () => Math.random() }
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Live provider load: fetch + normalize the current league (read-only). Throws on hard failure.
 *
 * ⚠ THE SIGNATURE TAKES A CONNECTION, NOT A LEAGUE ID, and that is the whole generalisation.
 * A Sleeper id is enough to read a Sleeper league because the API is keyless; an ESPN or Yahoo
 * or MFL id is not, because the read needs a credential belonging to one of the importing users.
 * `normalizedLoader` resolves that. Keeping the old `(externalLeagueId)` shape would have forced
 * every credentialed provider back through a second, parallel code path.
 */
async function fetchNormalizedForLeague(
  connection: LeagueSyncConnection,
): Promise<NormalizedImportResult> {
  return fetchNormalizedForConnection(connection)
}

/**
 * Memoize the fetch PROMISE so all scopes of a run share ONE provider burst — but ONLY while it is
 * in-flight or resolved. On rejection the slot is released so the runner's next retry performs a
 * genuinely NEW bounded provider attempt (transient failures can recover), while a resolved payload
 * stays shared so successful scopes never refetch. Provider load stays bounded by the runner's
 * `maxRetries`. The runner processes scopes sequentially, so there is no intra-run race on the slot.
 */
export function createMemoizedNormalizedLoader(
  fn: () => Promise<NormalizedImportResult>,
): () => Promise<NormalizedImportResult> {
  let memo: Promise<NormalizedImportResult> | null = null
  return () => {
    if (!memo) {
      const p = fn()
      memo = p
      // Fire-and-forget: release the slot on rejection. Does not change the returned promise, so the
      // caller still observes the original rejection and rethrows it up to the runner.
      p.then(undefined, () => {
        if (memo === p) memo = null
      })
    }
    return memo
  }
}

export interface SyncConnectedResult {
  runKey: string
  executed: boolean
  reason?: string
  seasonState: string
  cadenceMinutes: number
  due: boolean
  nextEligibleAt: string
  status?: RunResult['status']
  advancedFreshness?: boolean
  removed?: number
  notes?: string[]
  result?: RunResult
  warning?: string
}

export interface SyncConnectedDeps {
  /**
   * Injectable normalized-payload loader (controlled fixture in tests). Default = the live
   * provider read for this connection's platform.
   *
   * ⚠ IT RECEIVES THE EXTERNAL LEAGUE ID FIRST FOR BACKWARD COMPATIBILITY — every existing
   * test passes `(externalLeagueId) => fixture`. The connection is a second argument so a
   * provider-aware fixture can use it without breaking any of them.
   */
  fetchNormalized?: (
    externalLeagueId: string,
    connection?: LeagueSyncConnection,
  ) => Promise<NormalizedImportResult>
  /**
   * Skip the stored-credential pre-flight. Only for tests that inject `fetchNormalized` and
   * therefore never touch a real credential.
   */
  skipCredentialPreflight?: boolean
  /** Bypass the cadence due-check (manual refresh). Default false. */
  force?: boolean
  /** Reconcile removals from complete authoritative responses. Default true. */
  reconcileRemovals?: boolean
  /** Overridable scope set (tests may add an immutable scope to exercise skip-refetch). */
  scopes?: SyncScope[]
  immutableScopes?: SyncScope[]
  clock?: Clock
  rng?: Rng
  sleep?: Sleep
  leaseMs?: number
  maxRetries?: number
  runTimeoutMs?: number
}

/**
 * Record that a connection was considered and deliberately not synced.
 *
 * 🛑 WITHOUT THIS, A SKIPPED LEAGUE IS INDISTINGUISHABLE FROM ONE NOBODY LOOKED AT.
 * The credential pre-flight returns before `runSync`, so `recordRun` never fires and no
 * `LeagueSyncState` row was written at all — a reader of that table saw nothing, which
 * reads as "never enumerated" rather than "enumerated, and here is exactly why it did not
 * sync". The skip reason did reach the cron response, but nothing durable held it, so by
 * the time anyone investigated a stale league the explanation was gone.
 *
 * ⚠ `syncStatus: 'skipped'` IS NOT A NEW VOCABULARY. The column's own schema comment
 * already lists `completed | partial | failed | locked | skipped`; this is the first thing
 * to write the last of those. No migration.
 *
 * ⚠ `lastAttemptedSyncAt` IS DELIBERATELY NOT SET, AND THAT IS THE WHOLE DESIGN.
 * It means "a run was attempted", and no run was — we declined before touching the
 * provider. Setting it would be a small lie with two real costs: a freshness reader would
 * see an attempt with no success and infer a silent failure, and `isSyncDue` would then
 * consider the league not-due for a full cadence window, so a manager who connects ESPN
 * thirty seconds later waits half an hour for a refresh nobody is charging for. Leaving it
 * null keeps the pre-flight running every heartbeat — two indexed DB reads, no provider
 * call — so a newly-stored credential is picked up on the very next tick.
 *
 * ⚠ AND `consecutiveFailures` IS UNTOUCHED. A missing credential is not a provider failure;
 * counting it as one would drive backoff and alerting against a provider behaving perfectly.
 *
 * Non-fatal: the collector's job is refreshing leagues, and failing to write an explanatory
 * row must never take down the run that produced it.
 */
async function recordSkippedConnection(
  connection: LeagueSyncConnection,
  seasonState: string,
  reason: string,
): Promise<void> {
  await prisma.leagueSyncState
    .upsert({
      where: { runKey: connection.runKey },
      create: {
        runKey: connection.runKey,
        provider: connection.provider,
        externalLeagueId: connection.externalLeagueId,
        season: connection.season,
        sport: connection.sport,
        seasonState,
        syncStatus: 'skipped',
        lastError: reason,
      },
      update: {
        seasonState,
        syncStatus: 'skipped',
        lastError: reason,
      },
    })
    .catch(() => undefined)
}

export async function syncConnectedLeague(
  connection: LeagueSyncConnection,
  now: Date,
  deps: SyncConnectedDeps = {},
): Promise<SyncConnectedResult> {
  const { state: seasonState, cadenceMinutes, warning } = resolveCadence({
    sport: connection.sport,
    provider: connection.provider,
    now,
  })

  const stateRow = await prisma.leagueSyncState.findUnique({
    where: { runKey: connection.runKey },
    select: { lastAttemptedSyncAt: true },
  })
  const lastAttempt = stateRow?.lastAttemptedSyncAt ? stateRow.lastAttemptedSyncAt.toISOString() : null
  const due = deps.force === true || isSyncDue(lastAttempt, cadenceMinutes, now)
  const nextEligibleAt = lastAttempt
    ? new Date(new Date(lastAttempt).getTime() + cadenceMinutes * 60_000).toISOString()
    : now.toISOString()

  const base = { runKey: connection.runKey, seasonState, cadenceMinutes, due, nextEligibleAt, warning }

  if (!due) {
    return { ...base, executed: false, reason: 'not due for this season cadence' }
  }

  /*
   * ⚠ ASK THE DATABASE BEFORE ASKING THE PROVIDER.
   *
   * ESPN, Yahoo and MFL cannot be read without a credential belonging to one of the importing
   * users. A league where nobody ever connected that platform is a permanent condition, so
   * discovering it by attempting a provider read would spend one request per candidate on
   * every heartbeat, forever, to learn something a single `SELECT` already knows.
   *
   * ⚠ IT IS A SKIP, NOT A FAILURE, and the distinction is load-bearing: a failure increments
   * `consecutiveFailures` and drives retry backoff against a provider that is behaving
   * perfectly. Nothing is wrong with ESPN — we simply have no key to the door.
   *
   * A stored-but-broken credential deliberately does NOT skip here; it proceeds and surfaces
   * as a real failure, because expired ESPN cookies are something a manager can go and fix,
   * and hiding that behind a quiet skip is how a league goes stale unnoticed.
   */
  if (!deps.skipCredentialPreflight && providerNeedsCredential(connection.provider)) {
    const withCredentials = await resolveStoredCredentialUserIds(connection)
    if (withCredentials.length === 0) {
      const reason = `no importing user has stored ${connection.provider} credentials for this league`
      /* Durable, so the explanation outlives this cron response — see the note above. */
      await recordSkippedConnection(connection, seasonState, reason)
      return { ...base, executed: false, reason }
    }
  }

  const loadNormalized = createMemoizedNormalizedLoader(() =>
    deps.fetchNormalized
      ? deps.fetchNormalized(connection.externalLeagueId, connection)
      : fetchNormalizedForLeague(connection),
  )
  const store = createPrismaSleeperSyncStore({
    connection,
    loadNormalized,
    reconcileRemovals: deps.reconcileRemovals ?? true,
  })
  const fetchScope = createSleeperScopeFetcher({ loadNormalized })
  const lock = createAutomationSyncLock()

  const result = await runSync({
    runKey: connection.runKey,
    seasonState,
    scopes: deps.scopes ?? (LEAGUE_SYNC_SCOPES as unknown as SyncScope[]),
    immutableScopes: deps.immutableScopes ?? [],
    lock,
    store,
    clock: deps.clock ?? realClock,
    rng: deps.rng ?? realRng,
    sleep: deps.sleep ?? realSleep,
    fetchScope,
    leaseMs: deps.leaseMs ?? 5 * 60_000,
    maxRetries: deps.maxRetries ?? 2,
    runTimeoutMs: deps.runTimeoutMs ?? 4 * 60_000,
  })

  /*
   * ⚠ TURN THE TAP ON. ensureMatchupsCached and refreshWeekCache — the only two
   * writers of WeeklyMatchup — had ZERO callers anywhere in the codebase. The
   * rankings engine reads that cache through getWeekStatsFromCache, so it has
   * been reading a table nothing fills; the 262 rows on production are leftovers
   * from something that no longer runs. No scores, no win probabilities, no
   * "your week" anywhere, for want of this call.
   *
   * ⚠ THE SEASON MUST BE PASSED. sleeper-matchup-cache hardcodes
   * CURRENT_SEASON = 2025 as its default while the clock reads 2026 — which is
   * precisely why every existing row is 2025. Omitting the argument would keep
   * writing into last season forever.
   *
   * ⚠ THE ID IS THE PLATFORM ID, NOT OUR UUID. WeeklyMatchup.leagueId holds
   * Sleeper's league id (it is fetched with it), and measured on production only
   * 2 of those ids match a League.id. connection.externalLeagueId is the right
   * one; passing leagueId would write rows nothing can ever join back.
   *
   * Only in season, and only after a run that actually executed. Out of season
   * there is no new week to fetch, and a locked run did no work to follow up.
   *
   * COST: ensureMatchupsCached fetches only weeks it is missing, plus the latest
   * one if older than its 30-minute threshold — which matches this cron's
   * cadence. So steady state is ~1 request per league per run. The FIRST run
   * after this ships backfills up to MAX_WEEKS per league, which is a one-time
   * cost paid once per league and then never again. Failures are swallowed: a
   * matchup backfill must never fail the league sync that already succeeded.
   */
  /*
   * ⚠ SLEEPER-ONLY, AND THAT IS NOT AN OVERSIGHT LEFT BY THE GENERALISATION.
   *
   * Both enrichments below call Sleeper's own endpoints directly:
   * `ensureMatchupsCached` fetches `/league/{id}/matchups/{week}` and
   * `ingestSleeperPlayerScoresForWeek` reads Sleeper player scoring. Neither has a meaning
   * for an ESPN or Fantrax league id, and running them would either 404 in a loop or — worse
   * — write `WeeklyMatchup` rows keyed on a non-Sleeper league id that the readers would then
   * join against, producing scores for the wrong league.
   *
   * ESPN, Yahoo and Fantrax get their `WeeklyMatchup` rows from the parity collectors
   * (`externalMatchupParity`, `fantraxMatchupParity`) which speak their own APIs. MFL and
   * Fleaflicker have no weekly-matchup writer yet — a known gap, recorded rather than papered
   * over by pointing a Sleeper fetcher at them.
   */
  if (connection.provider === 'sleeper' && result.status !== 'locked' && isInSeason(seasonState)) {
    await ensureMatchupsCached(connection.externalLeagueId, MAX_WEEKS, connection.season).catch(
      (err: unknown) => {
        console.warn(
          '[sync] weekly matchup cache failed',
          connection.externalLeagueId,
          err instanceof Error ? err.message : err,
        )
      },
    )

    /*
     * Per-player weekly scores for the live weeks. `LeaguePlayerWeeklyScore`
     * had a writer and NO scheduled caller — /live's personalization (My
     * games, leagues-affected, impact totals) read a table only a manual
     * script ever filled. This is the scheduled caller.
     *
     * Target weeks derive from the WeeklyMatchup rows the call above just
     * refreshed: the frontier (earliest zero-point week — the week being
     * played or about to be) and the week before it (in progress on a Sunday,
     * stat corrections after). The writer itself skips placeholder rows with
     * no real scoring, so an un-started week costs one request and writes
     * nothing. Failures are swallowed for the same reason as the matchup
     * cache: enrichment must never fail a sync that already succeeded.
     */
    try {
      const weekRows = await prisma.weeklyMatchup.groupBy({
        by: ['week'],
        where: { leagueId: connection.externalLeagueId, seasonYear: connection.season },
        _sum: { pointsFor: true },
        orderBy: { week: 'asc' },
      })
      let frontier: number | null = null
      for (const r of weekRows) {
        if ((r._sum.pointsFor ?? 0) === 0) {
          frontier = r.week
          break
        }
      }
      const targetWeeks = new Set<number>()
      if (frontier !== null) {
        targetWeeks.add(frontier)
        if (frontier > 1) targetWeeks.add(frontier - 1)
      } else if (weekRows.length > 0) {
        targetWeeks.add(weekRows[weekRows.length - 1].week)
      }
      for (const week of targetWeeks) {
        const scores = await ingestSleeperPlayerScoresForWeek(
          connection.externalLeagueId,
          connection.season,
          week,
        )
        if (scores.error) {
          console.warn(
            '[sync] player weekly scores failed',
            connection.externalLeagueId,
            week,
            scores.error,
          )
        }
      }
    } catch (err: unknown) {
      console.warn(
        '[sync] player weekly score ingestion failed',
        connection.externalLeagueId,
        err instanceof Error ? err.message : err,
      )
    }
  }

  return {
    ...base,
    executed: result.status !== 'locked',
    reason: result.status === 'locked' ? 'another executor holds the lock' : undefined,
    status: result.status,
    advancedFreshness: result.advancedFreshness,
    removed: store.removedTotal(),
    notes: store.notes,
    result,
  }
}

/**
 * @deprecated Use `syncConnectedLeague`. Identical behaviour — the function was never
 * Sleeper-specific past the fetch it hardcoded. Kept so existing call sites and their tests
 * are untouched by the generalisation.
 */
export async function syncConnectedSleeperLeague(
  connection: SleeperSyncConnection,
  now: Date,
  deps: SyncConnectedDeps = {},
): Promise<SyncConnectedResult> {
  return syncConnectedLeague(connection, now, deps)
}
