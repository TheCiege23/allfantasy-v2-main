/**
 * Live Scoring — shared platform types.
 *
 * Sport- AND concept-agnostic by design: Redraft, Keeper, Dynasty, Best Ball,
 * Guillotine, Survivor, Big Brother, Devy, C2C, Zombie, Tournament, and IDP all
 * consume the same live-scoring primitives. Nothing here imports Prisma, Next, or
 * any redraft-only module — the engine core is pure so it can be unit-tested and
 * reused everywhere.
 */

/** Canonical live game lifecycle, normalized from any provider's raw status. */
export type LiveGameStatus =
  | 'scheduled' // not started
  | 'in_progress' // a quarter/period is running
  | 'halftime' // paused at the half (still "live" for cadence)
  | 'overtime' // extra period (still "live")
  | 'final' // completed (incl. final/OT)
  | 'suspended' // stopped mid-game, expected to resume (weather, etc.)
  | 'postponed' // moved to a different day — do not poll today

/** The subset of statuses that mean "the clock could change soon" → poll fast. */
export const LIVE_GAME_STATUSES: ReadonlySet<LiveGameStatus> = new Set<LiveGameStatus>([
  'in_progress',
  'halftime',
  'overtime',
])

/** A normalized game snapshot the cadence/projection engine reasons about. */
export type LiveGameSnapshot = {
  gameId: string
  status: LiveGameStatus
  /** Kickoff/tip time. Null when unknown (treated as not-imminent). */
  startTime: Date | null
  /**
   * Fraction of regulation game elapsed in [0,1]. 0 = not started, 1 = clock
   * expired. Halftime ≈ 0.5, end of Q3 ≈ 0.75. Providers without a clock can
   * leave this null and the projection falls back to status-only behavior.
   */
  fractionElapsed?: number | null
}

/** Result of the poll-cadence decision (Phase 2: when/whether to poll). */
export type PollCadenceDecision = {
  /** At least one game is in_progress/halftime/overtime. */
  anyLive: boolean
  /** Any game is live OR imminent (kickoff within the lead window). */
  anyActive: boolean
  /** Every game is final/postponed — polling can stop entirely. */
  allDone: boolean
  /** Game ids that should be polled this tick (live + imminent + suspended). */
  gameIdsToPoll: string[]
  /** Delay until the next poll, in ms. 0 means "stop polling". */
  nextPollDelayMs: number
  /** Human-readable reason for the chosen cadence (telemetry/tests). */
  reason: string
}
