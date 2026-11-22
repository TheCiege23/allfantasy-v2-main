/**
 * PROMPT 3: Deterministic advancement rules and tiebreakers.
 * Qualification cuts use `qualificationAdvancementTotal` / conference count (see tournament-sport-cutoffs).
 * Tiebreakers: 1) W-L, 2) Points For. Bubble: optional Week 9 fill remaining slots.
 */

import { getQualificationCutSlotsPerConference } from './tournament-sport-cutoffs'

/** Fallback advancement per conference when only pool size is known (assumes 2 conferences, sport NFL). */
export function getAdvancementSlotsPerConference(participantPoolSize: number): number {
  return getQualificationCutSlotsPerConference('NFL', participantPoolSize, undefined, 2)
}

/** Default tiebreaker order (deterministic). Commissioner override can be stored in Tournament.settings.qualificationTiebreakers. */
export const DEFAULT_TIEBREAKER_ORDER = ['wins', 'points_for'] as const

/**
 * Head-to-head record between two rosters in the same league.
 * Returns positive if `a` has more H2H wins, negative if `b` does, 0 if tied or no matchups.
 */
export function resolveHeadToHead(
  aRosterId: string,
  bRosterId: string,
  matchups: Array<{ teamA: string; teamB: string; winnerTeamId: string | null }>
): number {
  let aWins = 0
  let bWins = 0
  for (const m of matchups) {
    const involves =
      (m.teamA === aRosterId && m.teamB === bRosterId) ||
      (m.teamA === bRosterId && m.teamB === aRosterId)
    if (!involves) continue
    if (m.winnerTeamId === aRosterId) aWins++
    else if (m.winnerTeamId === bRosterId) bWins++
  }
  return bWins - aWins // negative = a ahead, positive = b ahead
}

export type StandingsRowForSort = {
  rosterId?: string
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
}

/**
 * Compare two standing rows by configured tiebreakers. Returns negative if a before b, positive if b before a.
 * When `head_to_head` is in the order and matchups are provided, uses H2H record as a tiebreaker.
 */
export function compareByTiebreakers(
  a: StandingsRowForSort,
  b: StandingsRowForSort,
  order: string[] = [...DEFAULT_TIEBREAKER_ORDER],
  matchups?: Array<{ teamA: string; teamB: string; winnerTeamId: string | null }>
): number {
  for (const key of order) {
    if (key === 'wins') {
      if (a.wins !== b.wins) return b.wins - a.wins
    } else if (key === 'points_for') {
      if (a.pointsFor !== b.pointsFor) return b.pointsFor - a.pointsFor
    } else if (key === 'points_against') {
      if (a.pointsAgainst !== b.pointsAgainst) return a.pointsAgainst - b.pointsAgainst
    } else if (key === 'head_to_head' && matchups && a.rosterId && b.rosterId) {
      const h2h = resolveHeadToHead(a.rosterId, b.rosterId, matchups)
      if (h2h !== 0) return h2h
    }
  }
  return 0
}

/** Black/Gold default: elimination league size after qualification (e.g. 16-team leagues). */
export const ELIMINATION_LEAGUE_SIZE = 16

/** Number of elimination leagues per conference when condensing (e.g. 64 per conf → 4 leagues of 16). */
export function getEliminationLeagueCountPerConference(advancementPerConference: number): number {
  return Math.ceil(advancementPerConference / ELIMINATION_LEAGUE_SIZE)
}

/** Bubble: number of extra slots that can be filled by bubble week (configurable; 0 = disabled). */
export function getBubbleSlotsPerConference(advancementPerConference: number, bubbleEnabled: boolean): number {
  if (!bubbleEnabled) return 0
  return Math.max(0, Math.min(4, Math.floor(advancementPerConference / 16)))
}
