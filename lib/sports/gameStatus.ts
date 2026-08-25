/**
 * ONE READING OF `SportsGame.status`.
 *
 * ⚠ THE COLUMN IS SIXTEEN VOCABULARIES AT ONCE. Measured against production
 * 2026-08-25, across 7 sports and 2 seasons:
 *
 *   FT 10,534 · scheduled 4,332 · final 3,564 · NS 2,001 · AOT 474 · AP 128
 *   CANC 89 · in_progress 22 · Final 16 · POST 10 · postponed 8 · PST 6
 *   canceled 3 · null 3 · "Match Finished" 1 · IN2 1
 *
 * Three provider dialects share one column: our own snake_case (`scheduled`,
 * `in_progress`), TheSportsDB prose (`Match Finished`), and api-sports codes
 * (`FT`, `NS`, `AOT`, `AP`, `IN2`). Any `status === 'final'` check sees 3,564 of
 * 14,717 finished games and misses the rest.
 *
 * ⚠ AN UNKNOWN VALUE RESOLVES TO `unknown`, NEVER TO A GUESS. Both defaults are
 * actively harmful and in opposite directions: defaulting to `scheduled` tells a
 * manager their player has not played when he has — `AOT` and `AP` alone are 602
 * finished games — and defaulting to `final` tells them a game is over while it
 * is being played. Callers must handle `unknown` as "we do not know", which is
 * the honest answer and the one a lineup decision can be made around.
 */

export type CanonicalGameStatus =
  | 'scheduled'
  | 'live'
  | 'final'
  | 'postponed'
  | 'cancelled'
  | 'unknown'

/** Finished, including the ways a game can end after regulation. */
const FINAL = new Set([
  'ft',
  'final',
  'aot',
  'ap',
  'aet',
  'pen',
  'match finished',
  'finished',
  'complete',
  'completed',
  'closed',
  'game over',
  'f',
  'f/ot',
  'awarded',
])

const SCHEDULED = new Set([
  'scheduled',
  'ns',
  'not started',
  'pre',
  'pregame',
  'upcoming',
  'tbd',
  'time to be defined',
])

const POSTPONED = new Set(['post', 'pst', 'postponed', 'susp', 'suspended', 'delayed', 'int'])

const CANCELLED = new Set(['canc', 'cancelled', 'canceled', 'abd', 'abandoned', 'awd', 'wo'])

/**
 * Live. api-sports encodes the period in the code itself (`1H`, `IN2`, `Q3`,
 * `P1`), so a prefix family is matched rather than an enumeration that would go
 * stale the first time a game reached a period nobody had seen yet.
 */
const LIVE_EXACT = new Set([
  'in_progress',
  'live',
  'inprogress',
  'ht',
  'halftime',
  'et',
  'bt',
  'brk',
  'break',
  'pen_live',
  'in play',
])
const LIVE_PREFIX = /^(?:in|q|p|h|ot|otb)\d+$|^\d+h$/

/** Normalize a provider status to the one vocabulary the app reasons in. */
export function normalizeGameStatus(raw: string | null | undefined): CanonicalGameStatus {
  if (raw == null) return 'unknown'
  const s = String(raw).trim().toLowerCase()
  if (s.length === 0) return 'unknown'

  if (FINAL.has(s)) return 'final'
  if (SCHEDULED.has(s)) return 'scheduled'
  if (POSTPONED.has(s)) return 'postponed'
  if (CANCELLED.has(s)) return 'cancelled'
  if (LIVE_EXACT.has(s) || LIVE_PREFIX.test(s)) return 'live'

  return 'unknown'
}

/**
 * Has this game finished?
 *
 * Only ever true for a status we positively recognise as finished. `unknown` is
 * false here AND false in `hasGameStarted` — deliberately, so an unrecognised
 * status cannot be read as either "safe to bench" or "already locked".
 */
export function isGameFinished(raw: string | null | undefined): boolean {
  return normalizeGameStatus(raw) === 'final'
}

/** Has the ball been kicked? True for live and finished games only. */
export function hasGameStarted(raw: string | null | undefined): boolean {
  const s = normalizeGameStatus(raw)
  return s === 'live' || s === 'final'
}

/** Will this game be played at all? False only when positively cancelled. */
export function isGameCancelled(raw: string | null | undefined): boolean {
  return normalizeGameStatus(raw) === 'cancelled'
}

/** Human-facing label, for prompts and UI alike. */
export function describeGameStatus(raw: string | null | undefined): string {
  switch (normalizeGameStatus(raw)) {
    case 'final':
      return 'final'
    case 'live':
      return 'in progress'
    case 'scheduled':
      return 'not started'
    case 'postponed':
      return 'postponed'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'status unknown'
  }
}
