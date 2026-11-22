import 'server-only'
import { loadLeaguePlayerMetrics } from './leaguePlayerMetrics'
import { loadUnavailableBySport } from '@/lib/core-app/unavailableStarters'
import { createHash } from 'node:crypto'
import { sharedRead, sharedReadCacheActive } from './sharedReadCache'
import { mapWithConcurrency } from '@/lib/concurrency/mapWithConcurrency'
import type { DurableCacheTier } from '@/lib/sports-os/layeredCache'
import { sportsDataCacheTier } from '@/lib/sports-os/durableTier'

export type RosterWeekRequest = { leagueId: string; season: number; week: number; ids: readonly string[] }
export type RosterWeekPlayer = { points: number | null; team: string | null; unavailable: boolean }

/**
 * How long one league's week board is reused. The /core shell, the rail-scores refresh and the league page each
 * price every league the user holds; rebuilding ~85 boards per render took the shell from 3-6 s to 10-105 s
 * (2026-11-20). A weekly projection that is three minutes old is the same projection; who is ruled out is still
 * read fresh on every call below.
 */
export const ROSTER_WEEK_BOARD_TTL_MS = 3 * 60_000

/**
 * How long past that a board may still be SERVED while a rebuild runs behind it (2026-11-22).
 *
 * ⚠ WHY THE BOARDS NOW LIVE IN POSTGRES TOO. The cache above was per process, so every deploy (several an hour)
 * and every visit more than three minutes apart rebuilt every board. Measured on the owner's 91-league account:
 * a cold open rebuilt all 64 boards in 8.5s. The board is now kept in memory AND in `SportsDataCache`
 * (`sportsDataCacheTier`), so a board built before a deploy, or by the other replica, is reused.
 *
 * ⚠ THE TRADE, STATED. Up to three minutes old a board is served as-is, as before. From three minutes to three
 * hours old it is served at once and rebuilt in the background, so the next view has the new one. Past that the
 * caller waits for a rebuild, as before. Who is ruled out is NOT in the board: it is read fresh on every call below
 * (`loadUnavailableBySport`), so a stale board can never show an injured starter as playing — what can be up to
 * three hours old is the projected points, which come from AF projections recomputed once a day.
 *
 * ⚠ THREE HOURS, NOT THIRTY MINUTES (owner's OK, 2026-11-22). Measured: the owner's /core opens are usually more
 * than half an hour apart (1.5h between the two on 11-22), so a 30-minute window never applied and every cold open
 * rebuilt all 64 boards while the home cards were loading, on a server 95% busy.
 */
export const ROSTER_WEEK_BOARD_SERVE_STALE_MS = 3 * 60 * 60_000

/** `SportsDataCache` key family for these boards — listed in `PURGEABLE_KEY_PREFIXES` (lib/enrichment-cache.ts). */
export const ROSTER_WEEK_BOARD_KEY_PREFIX = 'rail-board:v1:'

export function rosterWeekBoardKey(leagueId: string, week: number, rosterIds: readonly string[]): string {
  const ids = createHash('sha1').update([...rosterIds].sort().join(',')).digest('hex')
  return `${ROSTER_WEEK_BOARD_KEY_PREFIX}${leagueId}|${week}|${ids}`
}

async function buildBoard(leagueId: string, week: number, rosterIds: string[]) {
  const board = await loadLeaguePlayerMetrics({ leagueId, week, rosterIds, limit: rosterIds.length, includeTradeValues: false })
  // Only a board is kept: a miss is not cached, so the next call tries again.
  if (!board) throw new Error('no board')
  return board
}

type Board = Awaited<ReturnType<typeof buildBoard>>

/**
 * Memory first (`sharedRead`, three minutes, one read shared by concurrent renders), then Postgres, then a build.
 *
 * ⚠ ITS OWN MEMORY TIER, NOT `readThrough`'s. That one is capped at 500 entries shared with every screen summary
 * in the app; one 64-league account would push the summaries out.
 */
/**
 * Where a board came from, for `[rail-boards-timing]` (2026-11-22). Timing alone could not say: once boards were
 * kept in Postgres, a stored read took longer than the old 5 ms "cached" cutoff and was counted as a rebuild.
 *   memory  this process already held it (or shared a read another render had in flight)
 *   stored  read from Postgres, under three minutes old
 *   stale   read from Postgres, 3 minutes to 3 hours old, served while a rebuild runs behind it
 *   built   no usable board anywhere: this view waited for a build
 */
export type BoardSource = 'memory' | 'stored' | 'stale' | 'built'

async function leagueWeekBoard(leagueId: string, week: number, rosterIds: string[]): Promise<{ board: Board; source: BoardSource }> {
  // Off under Vitest unless a test turns it on, like `sharedRead`: suites mock the board with different data.
  if (!sharedReadCacheActive()) return { board: await buildBoard(leagueId, week, rosterIds), source: 'built' }
  const key = rosterWeekBoardKey(leagueId, week, rosterIds)
  // Set only when this call is the one that runs the load; a memory hit never runs it.
  let source: BoardSource = 'memory'
  const board = await sharedRead('league-roster-week', key, ROSTER_WEEK_BOARD_TTL_MS, async () => {
    const found = await storedOrBuiltBoard(key, leagueId, week, rosterIds)
    source = found.source
    return found.board
  })
  return { board, source }
}

async function storedOrBuiltBoard(
  key: string, leagueId: string, week: number, rosterIds: string[],
): Promise<{ board: Board; source: Exclude<BoardSource, 'memory'> }> {
  const durable = boardTier()
  const stored = durable ? await durable.read(key).catch(() => null) : null
  const age = stored ? Date.now() - stored.fetchedAt : Number.POSITIVE_INFINITY
  if (stored && age >= 0 && age < ROSTER_WEEK_BOARD_TTL_MS) return { board: stored.data as Board, source: 'stored' }
  if (stored && age >= 0 && age < ROSTER_WEEK_BOARD_TTL_MS + ROSTER_WEEK_BOARD_SERVE_STALE_MS) {
    // Served now; the next view gets the rebuilt one. A failed rebuild leaves the stored board as it was.
    rebuildBoard(key, leagueId, week, rosterIds).catch(() => undefined)
    return { board: stored.data as Board, source: 'stale' }
  }
  return { board: await rebuildBoard(key, leagueId, week, rosterIds), source: 'built' }
}

/** One build per key at a time, whether a caller is waiting on it or it is running behind a stale board. */
const rebuilding = new Map<string, Promise<Board>>()
function rebuildBoard(key: string, leagueId: string, week: number, rosterIds: string[]): Promise<Board> {
  const running = rebuilding.get(key)
  if (running) return running
  const build = (async () => {
    const board = await buildBoard(leagueId, week, rosterIds)
    // A failed write must not fail the read: the board is already correct.
    await boardTier()?.write(key, { data: board, fetchedAt: Date.now(), source: 'live', staleAfterMs: ROSTER_WEEK_BOARD_TTL_MS })
      .catch(() => undefined)
    return board
  })()
  rebuilding.set(key, build)
  const release = () => {
    if (rebuilding.get(key) === build) rebuilding.delete(key)
  }
  build.then(release, release)
  return build
}

let tier: DurableCacheTier | null | undefined
/** The Postgres tier, created on first use; null where it cannot be (a cache must never fail a render). */
function boardTier(): DurableCacheTier | null {
  if (tier === undefined) {
    try {
      tier = sportsDataCacheTier()
    } catch {
      tier = null
    }
  }
  return tier
}

/** How many league boards are built at once. Unchanged by the pool below; see its note. */
export const ROSTER_WEEK_BOARD_BOUND = 4

/** One `[rail-boards-timing]` line when building the boards takes this long or more. */
let BOARD_TIMING_THRESHOLD_MS = 1500

/** Tests only: log every run, so a test can read the sources a real load reports. */
export function __setBoardTimingThresholdForTests(ms: number): void {
  BOARD_TIMING_THRESHOLD_MS = ms
}

/** Portfolio views can span dozens of leagues. Bound board reads and share availability for each sport-week. */
export async function loadLeagueRosterWeeks(requests: RosterWeekRequest[], options: { fresh?: boolean } = {}) {
  const result = new Map<string, Map<string, RosterWeekPlayer>>()
  const cohorts = new Map<string, { sport: string; season: number; week: number; players: Map<string, RosterWeekPlayer[]> }>()
  /*
   * ⚠ A POOL OF FOUR, NOT LOCKSTEP BATCHES OF FOUR (2026-11-22). Measured on the owner's 91-league account on
   * a cold open: the rail's matchup scores took 12.5s of a 13.0s /core shell, with the event loop only 45% busy
   * — waiting, not working. The old loop started four boards and waited for the SLOWEST of the four before
   * starting the next four, 23 times in a row. Now a board starts the moment any running one finishes. Still at
   * most four at once (the bound that keeps a cold rail from flooding the database); same boards, same results.
   *
   * The cache in `leagueWeekBoard` is per process and lasts three minutes, so every deploy and every visit more
   * than three minutes apart rebuilds every board. The timing line below says how many were rebuilt.
   */
  const startedAt = Date.now()
  const timedBoards: TimedBoard[] = []
  await mapWithConcurrency(requests, ROSTER_WEEK_BOARD_BOUND, async ({ leagueId, season, week, ids }) => {
      const rosterIds = [...new Set(ids.filter(id => id && id !== '0' && !id.startsWith('name:')))]
      if (!rosterIds.length) return
      const boardStartedAt = Date.now()
      // Rechecks compare a freshly computed board to the other readers after verified stats may have changed (#4093):
      // they build past every cache, and the timing line counts them as built.
      const found = await (options.fresh
        ? buildBoard(leagueId, week, rosterIds).then((board) => ({ board, source: 'built' as const }))
        : leagueWeekBoard(leagueId, week, rosterIds)
      ).catch(() => null)
      const board = found?.board ?? null
      timedBoards.push({ leagueId, ms: Date.now() - boardStartedAt, source: found?.source ?? 'failed' })
      if (board?.unit !== 'fantasy points' || board.week !== week || board.season !== season) return
      const players = new Map<string, RosterWeekPlayer>()
      result.set(leagueId, players)
      const key = [board.sport, season, week].join(':')
      let cohort = cohorts.get(key)
      if (!cohort) cohorts.set(key, cohort = { sport: board.sport, season, week, players: new Map() })
      for (const row of board.rows) {
        if (!row.rosterPlayerId) continue
        const player = { points: row.weekly, team: row.team ?? null, unavailable: false }
        players.set(row.rosterPlayerId, player)
        if (row.availabilityId && row.weeklyUnavailableReason !== 'no_nba_roster') {
          const matches = cohort.players.get(row.availabilityId) ?? []
          matches.push(player)
          cohort.players.set(row.availabilityId, matches)
        }
      }
  })
  logBoardTiming(Date.now() - startedAt, timedBoards)
  await Promise.all([...cohorts.values()].map(async cohort => {
    if (!cohort.players.size) return
    const unavailable = await loadUnavailableBySport({ sleeperIds: [...cohort.players.keys()], sports: [cohort.sport],
      season: cohort.season, week: cohort.week }).catch(() => new Map<string, Set<string>>())
    for (const id of unavailable.get(cohort.sport) ?? []) {
      for (const player of cohort.players.get(id) ?? []) {
        player.points = 0
        player.unavailable = true
      }
    }
  }))
  return result
}

export type TimedBoard = { leagueId: string; ms: number; source: BoardSource | 'failed' }

/**
 * `[rail-boards-timing] {"boards":64,"built":3,"stored":40,"stale":15,"memory":6,"failed":0,…}` — where each
 * board came from (see `BoardSource`), so the next slow rail says whether the time went on BUILDING boards or on
 * reading stored ones. `medianBuildMs` is over real builds only. `slowestLeagues` names the three slowest
 * (internal league ids, no user data) with their source, so a slow board can be profiled.
 * Diagnostics must never fail a render, so nothing here throws.
 */
export function logBoardTiming(totalMs: number, timed: ReadonlyArray<TimedBoard>): void {
  try {
    if (totalMs < BOARD_TIMING_THRESHOLD_MS) return
    const count = (source: TimedBoard['source']) => timed.filter((b) => b.source === source).length
    const builds = timed.filter((b) => b.source === 'built').map((b) => b.ms).sort((a, b) => a - b)
    console.info('[rail-boards-timing]', JSON.stringify({
      boards: timed.length,
      built: builds.length,
      stored: count('stored'),
      stale: count('stale'),
      memory: count('memory'),
      failed: count('failed'),
      bound: ROSTER_WEEK_BOARD_BOUND,
      totalMs,
      slowestMs: timed.reduce((max, b) => Math.max(max, b.ms), 0),
      medianBuildMs: builds.length ? builds[Math.floor(builds.length / 2)] : 0,
      slowestLeagues: [...timed].sort((a, b) => b.ms - a.ms).slice(0, 3),
    }))
  } catch {
    /* diagnostics cannot fail a render */
  }
}
