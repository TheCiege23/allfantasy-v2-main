import { prisma } from '@/lib/prisma'
import { isInSeason, resolveSeasonState } from '@/lib/import-os/season'
import { enumerateConnectedLeagues } from './enumerate'
import { GAME_DAY_REFRESH_TARGET_MINUTES, isNflGameDayWindow } from './gameDayWindow'
import { isInLeagueGoneBackoff } from './leagueGone'
import { runDueLeagues, type RunDueResult } from './runDueSleeperLeagues'
import { SYNCABLE_PROVIDERS, type LeagueSyncConnection } from './types'

export const ACTIVE_SYNC_CADENCE_MINUTES = 5
export const ACTIVE_SYNC_SCOPES = ['league_state', 'transactions', 'teams_rosters'] as const
/**
 * Per-league work budget for the active lane.
 *
 * ⚠ 20s WAS NOT WRONG ABOUT THE WORK, IT WAS WRONG ABOUT WHAT IT WAS MEASURING. Successful runs
 * of this lane finish at p50 1.9s and p95 7.3s (5,585 runs, production 2026-09-18 onward), so 20s
 * carried roughly 3x headroom over anything a scope actually does. What exhausted it was queueing
 * charged to the same clock — see `budgetStartedAt` in `runner.ts`, which no longer does that.
 *
 * 60s is ~8x the p95 and still a real bound. It is raised rather than removed because the
 * distribution has a genuine tail (max 466s on a large league), and an unbounded lane on a worker
 * with one JS thread is how one slow league stalls the ones behind it.
 */
export const ACTIVE_SYNC_LEAGUE_TIMEOUT_MS = 60_000
/** State-key suffix for the five-minute lane — shared by `lineupRefresh.ts` so a manual refresh and the lane hold one lock. */
export const ACTIVE_LANE_SUFFIX = 'active'
const RECENT_VIEW_WINDOW_MS = 30 * 60_000

/**
 * 🛑 ON A GAME DAY THE SLICE IS SIZED FROM THE PORTFOLIO, BECAUSE A FIXED SLICE CANNOT KEEP UP.
 *
 * Four leagues per provider per five-minute tick is 48 an hour. Measured on production
 * 2026-09-27 with 307 current-season Sleeper leagues: median 4.5h and p90 7.2h since a league's
 * rosters and transactions were last read — on a Sunday morning, when lineups and waiver pickups
 * matter most. The five-minute per-league cadence was never the limit; the slice was.
 *
 * So on a game day each provider takes `ceil(eligible / ticksPerTarget)` leagues, which is what
 * it takes for every league to come round inside {@link GAME_DAY_REFRESH_TARGET_MINUTES}. The
 * oldest-attempt ordering below means consecutive ticks walk the whole list rather than
 * re-reading the same leagues.
 *
 * ⚠ CAPPED, AND THE CAP IS NOT THE TARGET. At the measured p50 of 1.9s a league, 100 leagues at
 * concurrency 6 is ~30s of work; the start budget below is what actually bounds a tick. If the
 * portfolio outgrows the cap, the lane stops promising 20 minutes and says so in `deferred` —
 * it does not quietly run longer.
 */
export const GAME_DAY_MAX_PER_PROVIDER = 100
/**
 * No new league starts after this much of a tick. Deferred leagues keep their old attempt time,
 * so they lead the next tick.
 *
 * ⚠ SIZED AGAINST THE SCHEDULER'S CLIENT TIMEOUT, NOT THE ROUTE'S `maxDuration`. The fast-tier
 * loop gives this route 120s + 30s = 150s before it records a timeout, and Railway does not
 * enforce `maxDuration` at all. Worst case is this budget, plus one league started at its last
 * instant running its full {@link ACTIVE_SYNC_LEAGUE_TIMEOUT_MS}, plus the heartbeat's 25s
 * roster-refresh pass: 60 + 60 + 25 = 145s. A larger budget turns the rare slow league into a
 * recorded timeout.
 */
export const ACTIVE_SYNC_START_BUDGET_MS = 60_000

/** How many leagues per provider a tick takes. Pure, for tests. */
export function activeSliceSize(input: {
  eligibleForProvider: number
  limitPerProvider: number
  gameDay: boolean
}): number {
  if (!input.gameDay) return input.limitPerProvider
  const ticksPerTarget = Math.max(1, Math.floor(GAME_DAY_REFRESH_TARGET_MINUTES / ACTIVE_SYNC_CADENCE_MINUTES))
  const needed = Math.ceil(input.eligibleForProvider / ticksPerTarget)
  return Math.min(GAME_DAY_MAX_PER_PROVIDER, Math.max(input.limitPerProvider, needed))
}

export type ActiveSyncLaneResult = RunDueResult & {
  eligible: number
  selected: number
  recentlyViewedSelected: number
  gameDay: boolean
}

function activeSeasonYear(now: Date): number {
  return now.getUTCMonth() <= 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear()
}

/**
 * Pick a bounded, fair slice for the five-minute lane. Its state key is separate
 * from the full collector, so a mutable-scope refresh cannot postpone the full
 * league-state pass. Recently viewed leagues lead the queue; the rest rotate by
 * their oldest active-lane attempt.
 */
export async function selectActiveSyncConnections(input?: {
  now?: Date
  limitPerProvider?: number
  /** Size each provider's slice to reach every league within the game-day target. */
  gameDay?: boolean
}): Promise<{ connections: LeagueSyncConnection[]; eligible: number; recentlyViewedSelected: number }> {
  const now = input?.now ?? new Date()
  const limitPerProvider = Math.max(1, Math.min(input?.limitPerProvider ?? 50, 50))
  const season = activeSeasonYear(now)

  const perProvider = await Promise.all(
    SYNCABLE_PROVIDERS.map((provider) => enumerateConnectedLeagues([provider])),
  )
  const eligible = perProvider
    .flat()
    .filter((connection) => connection.season === season)
    .filter((connection) => {
      const { state } = resolveSeasonState({
        sport: connection.sport,
        provider: connection.provider,
        season: connection.season,
        now,
      })
      // An absent calendar does not establish an offseason. Current-season
      // Fantrax college-football leagues otherwise wait four hours between
      // refreshes even while games are being played. Keep their mutable data
      // in the bounded active lane without inventing season boundaries.
      return isInSeason(state) || state === 'unknown'
    })
    .map((connection) => ({ ...connection, runKey: `${connection.runKey}:${ACTIVE_LANE_SUFFIX}` }))

  if (eligible.length === 0) return { connections: [], eligible: 0, recentlyViewedSelected: 0 }

  const [states, leagueRows] = await Promise.all([
    prisma.leagueSyncState.findMany({
      where: { runKey: { in: eligible.map((connection) => connection.runKey) } },
      select: { runKey: true, lastAttemptedSyncAt: true, syncStatus: true, lastError: true },
    }),
    prisma.league.findMany({
      where: {
        season,
        platform: { in: [...SYNCABLE_PROVIDERS] },
        platformLeagueId: { not: '' },
      },
      select: { platform: true, platformLeagueId: true, season: true, lastViewedAt: true },
    }),
  ])

  const attemptedAt = new Map(states.map((row) => [row.runKey, row.lastAttemptedSyncAt?.getTime() ?? null]))
  /*
   * A league the provider said is gone stops advancing its attempt time for a day, so the
   * oldest-attempt ordering below would hand it a slot every tick only for the due check to
   * decline it. See ./leagueGone.
   */
  const goneBackoff = new Set(states.filter((row) => isInLeagueGoneBackoff(row, now)).map((row) => row.runKey))
  const viewedAt = new Map<string, number>()
  for (const row of leagueRows) {
    const key = `${String(row.platform).toLowerCase()}:${row.platformLeagueId}:${row.season}:${ACTIVE_LANE_SUFFIX}`
    const at = row.lastViewedAt?.getTime() ?? 0
    if (at > (viewedAt.get(key) ?? 0)) viewedAt.set(key, at)
  }

  const slices: LeagueSyncConnection[][] = []
  let recentlyViewedSelected = 0
  for (const provider of SYNCABLE_PROVIDERS) {
    const candidates = eligible.filter(
      (connection) => connection.provider === provider && !goneBackoff.has(connection.runKey),
    )
    const sliceSize = activeSliceSize({
      eligibleForProvider: candidates.length,
      limitPerProvider,
      gameDay: input?.gameDay === true,
    })
    const rows = candidates
      .map((connection, index) => ({
        connection,
        index,
        attemptedAt: attemptedAt.get(connection.runKey) ?? null,
        viewedAt: viewedAt.get(connection.runKey) ?? 0,
      }))
      .sort((a, b) => {
        // Hard freshness deadline outranks recently viewed accounts. Otherwise
        // a busy account can occupy every slot and starve the rest indefinitely.
        const overdue = (at: number | null) => at === null || now.getTime() - at >= ACTIVE_SYNC_CADENCE_MINUTES * 60_000
        const aOverdue = overdue(a.attemptedAt)
        const bOverdue = overdue(b.attemptedAt)
        if (aOverdue !== bOverdue) return aOverdue ? -1 : 1
        if (aOverdue && bOverdue && a.attemptedAt !== b.attemptedAt) return (a.attemptedAt ?? 0) - (b.attemptedAt ?? 0)
        const aRecent = now.getTime() - a.viewedAt <= RECENT_VIEW_WINDOW_MS
        const bRecent = now.getTime() - b.viewedAt <= RECENT_VIEW_WINDOW_MS
        if (aRecent !== bRecent) return aRecent ? -1 : 1
        if (aRecent && a.viewedAt !== b.viewedAt) return b.viewedAt - a.viewedAt
        if (a.attemptedAt === null && b.attemptedAt !== null) return -1
        if (a.attemptedAt !== null && b.attemptedAt === null) return 1
        if (a.attemptedAt !== b.attemptedAt) return (a.attemptedAt ?? 0) - (b.attemptedAt ?? 0)
        return a.index - b.index
      })
      .slice(0, sliceSize)

    recentlyViewedSelected += rows.filter(
      (row) => now.getTime() - row.viewedAt <= RECENT_VIEW_WINDOW_MS,
    ).length
    slices.push(rows.map((row) => row.connection))
  }

  /*
   * 🛑 INTERLEAVED, NOT CONCATENATED, NOW THAT A TICK CAN RUN OUT OF TIME. Leagues start in this
   * order, so a Sleeper-first list with ~80 Sleeper leagues in it would spend the start budget
   * before ESPN or Yahoo got a slot — every tick, forever. That is the starvation the per-provider
   * slice exists to prevent, arriving through the queue order instead of the enumeration.
   */
  const chosen: LeagueSyncConnection[] = []
  const longest = Math.max(0, ...slices.map((list) => list.length))
  for (let i = 0; i < longest; i += 1) {
    for (const list of slices) {
      if (i < list.length) chosen.push(list[i])
    }
  }

  return { connections: chosen, eligible: eligible.length, recentlyViewedSelected }
}

export async function runActiveSyncLane(input?: {
  now?: Date
  limitPerProvider?: number
  concurrency?: number
  /** Override the schedule read (tests, ops). Default = {@link isNflGameDayWindow}. */
  gameDay?: boolean
  /** Injectable clock for the start budget. */
  clock?: () => number
}): Promise<ActiveSyncLaneResult> {
  const now = input?.now ?? new Date()
  const clock = input?.clock ?? Date.now
  const startedAt = clock()
  const gameDay = input?.gameDay ?? (await isNflGameDayWindow(now))
  const selected = await selectActiveSyncConnections({ now, limitPerProvider: input?.limitPerProvider, gameDay })
  const summary = await runDueLeagues({
    now,
    connections: selected.connections,
    concurrency: input?.concurrency ?? 6,
    cadenceMinutesOverride: ACTIVE_SYNC_CADENCE_MINUTES,
    scopes: [...ACTIVE_SYNC_SCOPES],
    matchupStaleThresholdMs: ACTIVE_SYNC_CADENCE_MINUTES * 60_000,
    runTimeoutMs: ACTIVE_SYNC_LEAGUE_TIMEOUT_MS,
    startDeadlineAt: startedAt + ACTIVE_SYNC_START_BUDGET_MS,
    clock,
  })
  return {
    ...summary,
    eligible: selected.eligible,
    selected: selected.connections.length,
    recentlyViewedSelected: selected.recentlyViewedSelected,
    gameDay,
  }
}
