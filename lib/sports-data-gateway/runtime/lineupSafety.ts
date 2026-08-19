/**
 * Fantasy OS Phase 5D-c — auto-switch safety contract + lock evidence (Parts 5, 7, 8).
 *
 * The Sports Data Gateway supplies EVIDENCE; the existing lineup lock authority (`lineupLockService`, league
 * lock policy) makes the final decision. Auto-switch fails closed for EVERY non-resolved state. Injury evidence
 * is never used to override lock state. This module is pure so the full safety matrix is deterministically tested.
 */
import type { SportsDataContext } from '../contracts'
import { computeLockStatus } from './lock'
import type { PlayerGameResolution } from './playerGameResolution'

export type SportsDataLockEvidence = 'before_start' | 'at_or_after_start' | 'postponed' | 'suspended' | 'final' | 'unknown'

export function lockEvidenceFrom(res: PlayerGameResolution, now: Date): SportsDataLockEvidence {
  if (res.status !== 'resolved') return 'unknown'
  switch (res.gameStatus) {
    case 'postponed': return 'postponed'
    case 'suspended': return 'suspended'
    case 'final': return 'final'
    case 'live': return 'at_or_after_start'
    default: {
      const lock = computeLockStatus({ scheduledStart: res.scheduledStart, gameStatus: res.gameStatus, now })
      return lock === 'locked' ? 'at_or_after_start' : lock === 'unlocked' ? 'before_start' : 'unknown'
    }
  }
}

export type LiveLineupSportsContext = {
  canonicalPlayerId: string
  canonicalTeamId: string | null
  canonicalGameId: string | null
  scheduledStart: string | null
  gameStatus: import('../contracts').CanonicalGameSchedule['status'] | null
  gameResolutionStatus: PlayerGameResolution['status']
  sportsDataLockEvidence: SportsDataLockEvidence
  dataContext: SportsDataContext
  limitations: string[]
}

export function assembleLiveLineupContext(input: { canonicalPlayerId: string; resolution: PlayerGameResolution; now: Date; freshness: SportsDataContext }): LiveLineupSportsContext {
  const r = input.resolution
  return {
    canonicalPlayerId: input.canonicalPlayerId,
    canonicalTeamId: r.status === 'resolved' ? r.canonicalTeamId : null,
    canonicalGameId: r.status === 'resolved' ? r.canonicalGameId : null,
    scheduledStart: r.status === 'resolved' ? r.scheduledStart : null,
    gameStatus: r.status === 'resolved' ? r.gameStatus : null,
    gameResolutionStatus: r.status,
    sportsDataLockEvidence: lockEvidenceFrom(r, input.now),
    dataContext: input.freshness,
    limitations: r.status === 'resolved' ? [] : [`sports-data lock evidence unavailable: ${r.status}`],
  }
}

export type AutoSwitchSafetyResult =
  | { allowed: true; reason: 'verified_unlocked'; evidence: string[] }
  | { allowed: false; reason: 'already_locked' | 'schedule_unavailable' | 'schedule_stale' | 'team_unresolved' | 'game_conflict' | 'game_postponed' | 'game_suspended' | 'game_final' | 'identity_unresolved' | 'authorization_failed' | 'roster_illegal'; evidence: string[] }

/**
 * Auto-switch precondition. Fails closed for every uncertain state. `authorized`/`rosterLegal` come from the
 * existing authority (steps 1–2) and are NEVER bypassed by sports data. `scheduleFresh` gates staleness.
 */
export function evaluateAutoSwitchSafety(input: { authorized: boolean; rosterLegal: boolean; resolution: PlayerGameResolution; now: Date; scheduleFresh: boolean }): AutoSwitchSafetyResult {
  if (!input.authorized) return { allowed: false, reason: 'authorization_failed', evidence: ['actor not authorized'] }
  if (!input.rosterLegal) return { allowed: false, reason: 'roster_illegal', evidence: ['roster move is not legal per eligibility rules'] }
  const r = input.resolution
  switch (r.status) {
    case 'free_agent':
    case 'unresolved_team': return { allowed: false, reason: 'team_unresolved', evidence: r.evidence }
    case 'missing_schedule': return { allowed: false, reason: 'schedule_unavailable', evidence: r.evidence }
    case 'multiple_games':
    case 'conflicting_schedule': return { allowed: false, reason: 'game_conflict', evidence: r.evidence }
    case 'bye': return { allowed: false, reason: 'schedule_unavailable', evidence: ['bye week — no game to gate on'] }
    case 'resolved': break
  }
  if (!input.scheduleFresh) return { allowed: false, reason: 'schedule_stale', evidence: ['schedule snapshot is stale'] }
  const ev = lockEvidenceFrom(r, input.now)
  if (ev === 'postponed') return { allowed: false, reason: 'game_postponed', evidence: r.evidence }
  if (ev === 'suspended') return { allowed: false, reason: 'game_suspended', evidence: r.evidence }
  if (ev === 'final') return { allowed: false, reason: 'game_final', evidence: r.evidence }
  if (ev === 'at_or_after_start') return { allowed: false, reason: 'already_locked', evidence: ['game has started'] }
  if (ev === 'before_start') return { allowed: true, reason: 'verified_unlocked', evidence: r.evidence }
  return { allowed: false, reason: 'schedule_unavailable', evidence: ['lock evidence unknown'] }
}

export type LineupLockEvidence = {
  canonicalPlayerId: string
  canonicalGameId: string | null
  scheduleSnapshotVersion: string | null
  scheduledStart: string | null
  evaluatedAt: string
  gameStatus: string | null
  freshnessStatus: string
  leagueLockPolicyVersion: string
  finalDecision: 'allowed' | 'rejected'
  reason: string
}

export function buildLockEvidence(input: { context: LiveLineupSportsContext; leagueLockPolicyVersion: string; finalDecision: 'allowed' | 'rejected'; reason: string; now: Date }): LineupLockEvidence {
  return {
    canonicalPlayerId: input.context.canonicalPlayerId,
    canonicalGameId: input.context.canonicalGameId,
    scheduleSnapshotVersion: input.context.dataContext.snapshotVersions[0] ?? null,
    scheduledStart: input.context.scheduledStart,
    evaluatedAt: input.now.toISOString(),
    gameStatus: input.context.gameStatus,
    freshnessStatus: input.context.dataContext.freshnessStatus,
    leagueLockPolicyVersion: input.leagueLockPolicyVersion,
    finalDecision: input.finalDecision,
    reason: input.reason,
  }
}
