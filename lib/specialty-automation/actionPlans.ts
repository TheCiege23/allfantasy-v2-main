/**
 * Deterministic factories for `PlannedAction` / `PlannedEvent` — handlers use these instead of ad-hoc literals.
 */
import type { PlannedAction, PlannedEvent } from '@/lib/specialty-automation/types'

export const ActionTypes = {
  eliminateRoster: 'eliminate_roster',
  advancePhase: 'advance_phase',
  transitionPhase: 'transition_phase',
  releaseToWaivers: 'release_to_waiver_pool',
  promoteTeam: 'promote_team',
  relegateTeam: 'relegate_team',
  createStage: 'create_stage',
  redraftCheckpoint: 'redraft_checkpoint',
  openVotingWindow: 'open_voting_window',
  closeVotingWindow: 'close_voting_window',
  commissionerTask: 'commissioner_task',
  specialtyMetadataSync: 'specialty_metadata_sync',
  automationTick: 'automation_tick',
} as const

export function planEliminateRoster(
  rosterId: string,
  metadata?: Record<string, unknown>,
): PlannedAction {
  return {
    actionType: ActionTypes.eliminateRoster,
    targetType: 'roster',
    targetId: rosterId,
    metadata,
  }
}

export function planReleaseToWaiverPool(rosterId: string, playerId: string, metadata?: Record<string, unknown>): PlannedAction {
  return {
    actionType: ActionTypes.releaseToWaivers,
    targetType: 'roster',
    targetId: rosterId,
    metadata: { playerId, ...(metadata ?? {}) },
  }
}

export function planPromoteOrRelegate(
  kind: 'promote' | 'relegate',
  rosterId: string,
  metadata?: Record<string, unknown>,
): PlannedAction {
  return {
    actionType: kind === 'promote' ? ActionTypes.promoteTeam : ActionTypes.relegateTeam,
    targetType: 'roster',
    targetId: rosterId,
    metadata,
  }
}

export function planLeagueEvent(
  eventType: string,
  title: string,
  description?: string,
  payload?: Record<string, unknown>,
  visibility: PlannedEvent['visibility'] = 'league',
): PlannedEvent {
  return { eventType, title, description, payload, visibility }
}

export function planCommissionerTask(title: string, payload?: Record<string, unknown>): PlannedAction {
  return {
    actionType: ActionTypes.commissionerTask,
    metadata: { title, ...(payload ?? {}) },
  }
}
