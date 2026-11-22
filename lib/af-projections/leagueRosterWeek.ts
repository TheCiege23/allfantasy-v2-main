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
 * ⚠ THE TRADE, STATED. Up to three minutes old a board is served as-is, as before. From three to thirty-three
 * minutes old it is served at once and rebuilt in the background, so the next view has the new one. Past that
 * the caller waits for a rebuild, as before. Who is ruled out is NOT in the board: it is read fresh on every call
 * below (`loadUnavailableBySport`), so a stale board can never show an injured starter as playing.
 */
export const ROSTER_WEEK_BOARD_SERVE_STALE_MS = 30 * 60_000

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
function leagueWeekBoard(leagueId: string, week: number, rosterIds: string[]): Promise<Board> {
  // Off under Vitest unless a test turns it on, like `sharedRead`: suites mock the board with different data.
  if (!sharedReadCacheActive()) return buildBoard(leagueId, week, rosterIds)
  const key = rosterWeekBoardKey(leagueId, week, rosterIds)
  return sharedRead('league-roster-week', key, ROSTER_WEEK_BOARD_TTL_MS, () => storedOrBuiltBoard(key, leagueId, week, rosterIds))
}

async function storedOrBuiltBoard(key: string, leagueId: string, week: number, rosterIds: string[]): Promise<Board> {
  const durable = boardTier()
  const stored = durable ? await durable.read(key).catch(() => null) : null
  const age = stored ? Date.now() - stored.fetchedAt : Number.POSITIVE_INFINITY
  if (stored && age >= 0 && age < ROSTER_WEEK_BOARD_TTL_MS) return stored.data as Board
  if (stored && age >= 0 && age < ROSTER_WEEK_BOARD_TTL_MS + ROSTER_WEEK_BOARD_SERVE_STALE_MS) {
    // Served now; the next view gets the rebuilt one. A failed rebuild leaves the stored board as it was.
    rebuildBoard(key, leagueId, week, rosterIds).catch(() => undefined)
    return stored.data as Board
  }
  return rebuildBoard(key, leagueId, week, rosterIds)
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

/** A board served from the shared read cache comes back in well under this; a rebuilt one does not. */
const CACHED_BOARD_MS = 5

/** One `[rail-boards-timing]` line when building the boards takes this long or more. */
const BOARD_TIMING_THRESHOLD_MS = 1500

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
  const boardMs: number[] = []
  const timedBoards: Array<{ leagueId: string; ms: number }> = []
  await mapWithConcurrency(requests, ROSTER_WEEK_BOARD_BOUND, async ({ leagueId, season, week, ids }) => {
      const rosterIds = [...new Set(ids.filter(id => id && id !== '0' && !id.startsWith('name:')))]
      if (!rosterIds.length) return
      const boardStartedAt = Date.now()
      // Rechecks compare a freshly computed board to the other readers after verified stats may have changed.
      const read = options.fresh ? buildBoard : leagueWeekBoard
      const board = await read(leagueId, week, rosterIds).catch(() => null)
      const ms = Date.now() - boardStartedAt
      boardMs.push(ms)
      timedBoards.push({ leagueId, ms })
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
  logBoardTiming(Date.now() - startedAt, boardMs, timedBoards)
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

/**
 * `[rail-boards-timing] {"boards":91,"rebuilt":91,"totalMs":…,"slowestMs":…,"medianRebuildMs":…}` — so the next
 * slow rail says whether the time went on rebuilding boards (a cold cache) or on a few slow ones.
 * `slowestLeagues` names the three slowest (internal league ids, no user data) so a slow board can be profiled:
 * measured 2026-11-22, the typical rebuild was 260 ms and the slowest 3.7 s.
 * Diagnostics must never fail a render, so nothing here throws.
 */
export function logBoardTiming(
  totalMs: number,
  boardMs: readonly number[],
  timed?: ReadonlyArray<{ leagueId: string; ms: number }>,
): void {
  try {
    if (totalMs < BOARD_TIMING_THRESHOLD_MS) return
    const rebuilt = boardMs.filter((ms) => ms >= CACHED_BOARD_MS).sort((a, b) => a - b)
    console.info('[rail-boards-timing]', JSON.stringify({
      boards: boardMs.length,
      rebuilt: rebuilt.length,
      bound: ROSTER_WEEK_BOARD_BOUND,
      totalMs,
      slowestMs: rebuilt.at(-1) ?? 0,
      medianRebuildMs: rebuilt.length ? rebuilt[Math.floor(rebuilt.length / 2)] : 0,
      ...(timed ? { slowestLeagues: [...timed].sort((a, b) => b.ms - a.ms).slice(0, 3) } : {}),
    }))
  } catch {
    /* diagnostics cannot fail a render */
  }
}
