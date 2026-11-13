/**
 * Stored under `LegacyTournament.hubSettings.draftScheduleV1` (JSON).
 * Commissioner UI reads/writes via PATCH `/api/tournament/[id]/legacy-settings`.
 */

export type DraftPhaseKey = 'startup' | 'redraft_first' | 'redraft_finals'

type DraftScheduleMode = 'uniform' | 'per_league' | 'grouped'

export type PhaseScheduleFields = {
  scheduledAt: string | null
  timezone: string
  pickTimerSec: number
  draftMode: string
  status: 'scheduled' | 'live' | 'complete' | 'unset'
}

export type PhaseDraftPlan = {
  mode: DraftScheduleMode
  uniform?: PhaseScheduleFields
  /** leagueId → schedule when mode is `per_league` */
  perLeague?: Record<string, PhaseScheduleFields>
  /** When mode is `grouped`: batches of leagues sharing one clock */
  groups?: Array<{ id: string; leagueIds: string[]; schedule: PhaseScheduleFields }>
}

export type DraftScheduleV1 = {
  phases: Partial<Record<DraftPhaseKey, PhaseDraftPlan>>
}

export const DRAFT_PHASE_KEYS: DraftPhaseKey[] = ['startup', 'redraft_first', 'redraft_finals']

export function defaultPhaseSchedule(): PhaseScheduleFields {
  return {
    scheduledAt: null,
    timezone: 'America/New_York',
    pickTimerSec: 90,
    draftMode: 'snake',
    status: 'unset',
  }
}

export function defaultDraftScheduleV1(): DraftScheduleV1 {
  const base = (): PhaseDraftPlan => ({
    mode: 'uniform',
    uniform: defaultPhaseSchedule(),
    perLeague: {},
    groups: [],
  })
  return {
    phases: {
      startup: base(),
      redraft_first: base(),
      redraft_finals: base(),
    },
  }
}
