import 'server-only'
import { loadLeaguePlayerMetrics } from './leaguePlayerMetrics'
import { loadUnavailableBySport } from '@/lib/core-app/unavailableStarters'
import { sharedRead } from './sharedReadCache'
import { mapWithConcurrency } from '@/lib/concurrency/mapWithConcurrency'

export type RosterWeekRequest = { leagueId: string; season: number; week: number; ids: readonly string[] }
export type RosterWeekPlayer = { points: number | null; team: string | null; unavailable: boolean }

/**
 * How long one league's week board is reused. The /core shell, the rail-scores refresh and the league page each
 * price every league the user holds; rebuilding ~85 boards per render took the shell from 3-6 s to 10-105 s
 * (2026-11-20). A weekly projection that is three minutes old is the same projection; who is ruled out is still
 * read fresh on every call below.
 */
export const ROSTER_WEEK_BOARD_TTL_MS = 3 * 60_000

function leagueWeekBoard(leagueId: string, week: number, rosterIds: string[]) {
  const key = `${leagueId}|${week}|${[...rosterIds].sort().join(',')}`
  return sharedRead('league-roster-week', key, ROSTER_WEEK_BOARD_TTL_MS, async () => {
    const board = await loadLeaguePlayerMetrics({ leagueId, week, rosterIds, limit: rosterIds.length, includeTradeValues: false })
    // Only a board is kept: a miss is not cached, so the next call tries again.
    if (!board) throw new Error('no board')
    return board
  })
}

/** How many league boards are built at once. Unchanged by the pool below; see its note. */
export const ROSTER_WEEK_BOARD_BOUND = 4

/** A board served from the shared read cache comes back in well under this; a rebuilt one does not. */
const CACHED_BOARD_MS = 5

/** One `[rail-boards-timing]` line when building the boards takes this long or more. */
const BOARD_TIMING_THRESHOLD_MS = 1500

/** Portfolio views can span dozens of leagues. Bound board reads and share availability for each sport-week. */
export async function loadLeagueRosterWeeks(requests: RosterWeekRequest[]) {
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
  await mapWithConcurrency(requests, ROSTER_WEEK_BOARD_BOUND, async ({ leagueId, season, week, ids }) => {
      const rosterIds = [...new Set(ids.filter(id => id && id !== '0' && !id.startsWith('name:')))]
      if (!rosterIds.length) return
      const boardStartedAt = Date.now()
      const board = await leagueWeekBoard(leagueId, week, rosterIds).catch(() => null)
      boardMs.push(Date.now() - boardStartedAt)
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
  logBoardTiming(Date.now() - startedAt, boardMs)
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
 * Diagnostics must never fail a render, so nothing here throws.
 */
export function logBoardTiming(totalMs: number, boardMs: readonly number[]): void {
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
    }))
  } catch {
    /* diagnostics cannot fail a render */
  }
}
