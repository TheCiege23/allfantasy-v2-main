/**
 * Matchup State Normalizer — Phase 9. Pure functions only.
 *
 * Normalizes MatchupCenterPayload's real 'upcoming'|'live'|'final' status
 * (server/services/matchupCenterService.ts) into this module's richer
 * GameDayMatchupState enum. A bye is detected via the real, verified sentinel
 * matchupCenterService.ts uses (`right.rosterId === 'bye'`, confirmed by
 * reading assembleSidesPayload's own bye-branch construction) — not guessed.
 *
 * Deliberately does NOT infer 'final' or 'postponed'/'cancelled' purely from
 * "the scheduled kickoff time has passed" — MatchupCenterPayload's own status
 * is itself provider-data-derived (via TeamWeekResult.status / RedraftMatchup
 * status), so this normalizer trusts that value rather than re-deriving one
 * from a clock. A failed fetch (buildMatchupCenterPayload returning an error)
 * is always 'unavailable', never silently rendered as an absent/bye matchup.
 */

import type { MatchupCenterPayload } from '@/lib/matchup-center/types'
import type { GameDayMatchupState, NormalizedMatchupState } from './types'

/**
 * Phase 5E-g: certified game evidence supplied as an ADDITIONAL INPUT FACT only. It is surfaced on the returned
 * state for transparency but NEVER changes the authoritative `state` — the normalizer's existing rules remain
 * the customer-facing authority, and no single provider game status may bypass them.
 */
export interface CertifiedMatchupEvidenceInput {
  available: boolean
  freshnessStatus: string
  snapshotVersion: string | null
  totalGames: number
  finalGames: number
  allGamesFinal: boolean
}

export interface NormalizeMatchupStateInput {
  matchup: MatchupCenterPayload | null
  fetchedAt: string
  unavailableReason: string | null
  /** Optional, additive certified GAME evidence. Off unless the caller (gated) supplies it. Never alters state. */
  certifiedGameEvidence?: CertifiedMatchupEvidenceInput | null
}

/** Attach certified evidence to a normalized state without touching its authoritative `state`. */
function withCertifiedEvidence(state: NormalizedMatchupState, evidence: CertifiedMatchupEvidenceInput | null | undefined): NormalizedMatchupState {
  if (!evidence) return state
  return { ...state, certifiedGameEvidence: evidence }
}

const STALE_THRESHOLD_MS = 15 * 60 * 1000

export function normalizeMatchupState(input: NormalizeMatchupStateInput): NormalizedMatchupState {
  if (input.unavailableReason || !input.matchup) {
    return withCertifiedEvidence({
      state: 'unavailable',
      attribution: {
        source: 'matchup-center-service',
        fetchedAt: input.fetchedAt,
        providerTimestamp: null,
        freshness: 'unknown',
        confidence: 0,
        missingDataReason: input.unavailableReason ?? 'No matchup payload was returned.',
      },
    }, input.certifiedGameEvidence)
  }

  const matchup = input.matchup

  // Phase 34: matchupCenterService.ts's buildEmptyMatchupPayload() (the real
  // `kind: 'none'` case -- no matchup ROW exists at all, e.g. no TeamWeekResult
  // for this league/week) returns a well-formed payload with matchupStatus:
  // 'upcoming', not a top-level error -- so the `!input.matchup` check above
  // never catches it. Detected via the same real, verified sentinel pattern
  // already used for bye (left.rosterId === 'none-left', set by that exact
  // function). Without this, "we have no matchup data" was reported as a
  // confident 'upcoming' state -- overstated certainty.
  if (matchup.left.rosterId === 'none-left') {
    return withCertifiedEvidence({
      state: 'unavailable',
      attribution: {
        source: 'matchup-center-service',
        fetchedAt: input.fetchedAt,
        providerTimestamp: null,
        freshness: 'unknown',
        confidence: 0,
        missingDataReason: matchup.conceptOverlay ?? 'No matchup data exists for this league/week.',
      },
    }, input.certifiedGameEvidence)
  }

  let state: GameDayMatchupState

  if (matchup.right.rosterId === 'bye') {
    state = 'bye'
  } else if (matchup.matchupStatus === 'final' || matchup.matchupStatus === 'live' || matchup.matchupStatus === 'upcoming') {
    state = matchup.matchupStatus
  } else {
    // Any status string matchupCenterService didn't already normalize to one of its 3
    // real values is reported honestly, not guessed at.
    state = 'unsupported'
  }

  const ageMs = Date.now() - new Date(input.fetchedAt).getTime()
  const isAgeStale = ageMs > STALE_THRESHOLD_MS
  const freshness: NormalizedMatchupState['attribution']['freshness'] = isAgeStale ? 'stale' : 'fresh'

  // Age-based staleness overrides the reported state (a live/upcoming/final call this
  // old can no longer be trusted as current). partialData is a separate concern — it
  // means upstream AI/media/weather enrichment failed, not that the core matchup data
  // is old — so it only reduces confidence and records why, never overrides state.
  const finalState: GameDayMatchupState = isAgeStale ? 'stale' : state

  return withCertifiedEvidence({
    state: finalState,
    attribution: {
      source: 'matchup-center-service',
      fetchedAt: input.fetchedAt,
      providerTimestamp: null,
      freshness,
      confidence: matchup.partialData ? 40 : 90,
      missingDataReason: matchup.partialData ? 'Upstream AI, media, or weather enrichment was unavailable for this payload (partialData).' : null,
    },
  }, input.certifiedGameEvidence)
}
