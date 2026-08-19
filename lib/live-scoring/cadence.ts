/**
 * Live Scoring — poll cadence engine (Phase 2).
 *
 * Pure decision logic for *when* and *whether* to poll providers, matching the
 * behavior of Sleeper/ESPN/Yahoo: poll fast (30s) while any game is live, lighter
 * (2m) before kickoff, and stop entirely once every game is final/postponed. The
 * server scheduler and the browser both consume this so the cadence is identical
 * and testable without a live clock.
 */

import {
  LIVE_GAME_STATUSES,
  type LiveGameSnapshot,
  type LiveGameStatus,
  type PollCadenceDecision,
} from '@/lib/live-scoring/types'

/** Poll every 30s while games are live (matches Sleeper/ESPN). */
export const LIVE_POLL_MS = 30_000
/** Poll every 2m before kickoff. */
export const PREGAME_POLL_MS = 120_000
/** Suspended games may resume — keep a slow heartbeat. */
export const SUSPENDED_POLL_MS = 300_000
/** Sentinel: stop polling. */
export const STOP_POLL_MS = 0
/** Tighten to live cadence when a game kicks off within this lead window. */
export const KICKOFF_LEAD_MS = 120_000

const RAW_STATUS_MAP: Record<string, LiveGameStatus> = {
  // not started
  scheduled: 'scheduled',
  pre: 'scheduled',
  pregame: 'scheduled',
  upcoming: 'scheduled',
  ns: 'scheduled',
  status_scheduled: 'scheduled',
  // running
  in_progress: 'in_progress',
  inprogress: 'in_progress',
  live: 'in_progress',
  playing: 'in_progress',
  status_in_progress: 'in_progress',
  q1: 'in_progress',
  q2: 'in_progress',
  q3: 'in_progress',
  q4: 'in_progress',
  '1q': 'in_progress',
  '2q': 'in_progress',
  '3q': 'in_progress',
  '4q': 'in_progress',
  // halftime
  halftime: 'halftime',
  half: 'halftime',
  ht: 'halftime',
  status_halftime: 'halftime',
  // overtime
  overtime: 'overtime',
  ot: 'overtime',
  status_end_period_ot: 'overtime',
  // final
  final: 'final',
  'final/ot': 'final',
  ft: 'final',
  complete: 'final',
  completed: 'final',
  closed: 'final',
  status_final: 'final',
  // suspended / postponed
  suspended: 'suspended',
  delayed: 'suspended',
  status_suspended: 'suspended',
  postponed: 'postponed',
  ppd: 'postponed',
  canceled: 'postponed',
  cancelled: 'postponed',
  status_postponed: 'postponed',
}

/**
 * Normalize any provider's raw status string to a canonical {@link LiveGameStatus}.
 * Unknown values default to `scheduled` (safe: the cadence engine will treat it as
 * "not yet live" rather than mistakenly stop or hammer the provider).
 */
export function normalizeLiveGameStatus(raw: string | null | undefined): LiveGameStatus {
  const key = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '_')
  return RAW_STATUS_MAP[key] ?? 'scheduled'
}

export function isLiveStatus(status: LiveGameStatus): boolean {
  return LIVE_GAME_STATUSES.has(status)
}

/** A game still worth polling: live, suspended (may resume), or imminent kickoff. */
function shouldPollGame(game: LiveGameSnapshot, now: Date): boolean {
  if (isLiveStatus(game.status)) return true
  if (game.status === 'suspended') return true
  if (game.status === 'scheduled' && game.startTime) {
    const ms = game.startTime.getTime() - now.getTime()
    // Imminent (about to kick off) OR already past kickoff but provider hasn't
    // flipped to in_progress yet — both warrant a poll to catch the transition.
    return ms <= KICKOFF_LEAD_MS
  }
  return false
}

/**
 * Decide the poll cadence for a set of games at `now`. Pure and deterministic.
 *
 * Priority: any live game → {@link LIVE_POLL_MS}; else any imminent kickoff →
 * {@link LIVE_POLL_MS}; else any future game today → {@link PREGAME_POLL_MS}; else
 * any suspended game → {@link SUSPENDED_POLL_MS}; else everything is done → stop.
 */
export function resolvePollCadence(
  games: readonly LiveGameSnapshot[],
  now: Date = new Date(),
): PollCadenceDecision {
  const anyLive = games.some((g) => isLiveStatus(g.status))
  const anySuspended = games.some((g) => g.status === 'suspended')
  const anyImminent = games.some(
    (g) =>
      g.status === 'scheduled' &&
      g.startTime != null &&
      g.startTime.getTime() - now.getTime() <= KICKOFF_LEAD_MS,
  )
  const anyUpcoming = games.some((g) => g.status === 'scheduled')
  const allDone =
    games.length > 0 && games.every((g) => g.status === 'final' || g.status === 'postponed')

  const gameIdsToPoll = games.filter((g) => shouldPollGame(g, now)).map((g) => g.gameId)

  let nextPollDelayMs: number
  let reason: string
  if (anyLive) {
    nextPollDelayMs = LIVE_POLL_MS
    reason = 'live_games'
  } else if (anyImminent) {
    nextPollDelayMs = LIVE_POLL_MS
    reason = 'kickoff_imminent'
  } else if (anyUpcoming) {
    nextPollDelayMs = PREGAME_POLL_MS
    reason = 'upcoming_games'
  } else if (anySuspended) {
    nextPollDelayMs = SUSPENDED_POLL_MS
    reason = 'suspended_heartbeat'
  } else {
    nextPollDelayMs = STOP_POLL_MS
    reason = games.length === 0 ? 'no_games' : 'all_final'
  }

  return {
    anyLive,
    anyActive: anyLive || anyImminent || anySuspended,
    allDone,
    gameIdsToPoll,
    nextPollDelayMs,
    reason,
  }
}
