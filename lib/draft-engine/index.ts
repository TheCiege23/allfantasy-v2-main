/**
 * Canonical draft engine facade — core logic lives in `lib/live-draft-engine/*`.
 * Use these URLs and helpers for new integrations including redraft, mobile,
 * Chimmy, specialty formats, and commissioner draft controls.
 */

export { generateFullPickOrder } from './order/generateFullPickOrder'
export type { PlannedPickSlot } from './order/generateFullPickOrder'

export * from './validation/draftInvariants'
export * from './queue/autopickPreference'

/** REST endpoints for league-scoped live drafts. */
export const leagueDraftApi = {
  session: (leagueId: string) => `/api/leagues/${encodeURIComponent(leagueId)}/draft/session`,
  pool: (leagueId: string) => `/api/leagues/${encodeURIComponent(leagueId)}/draft/pool`,
  pick: (leagueId: string) => `/api/leagues/${encodeURIComponent(leagueId)}/draft/pick`,
  queue: (leagueId: string) => `/api/leagues/${encodeURIComponent(leagueId)}/draft/queue`,
  controls: (leagueId: string) => `/api/leagues/${encodeURIComponent(leagueId)}/draft/controls`,
  actions: (leagueId: string) => `/api/leagues/${encodeURIComponent(leagueId)}/draft/actions`,
  chat: (leagueId: string) => `/api/leagues/${encodeURIComponent(leagueId)}/draft/chat`,
} as const

/** REST endpoints for draft-id routes and legacy standalone draft surfaces. */
export const draftApi = {
  session: leagueDraftApi.session,
  pool: leagueDraftApi.pool,
  pick: leagueDraftApi.pick,
  queue: leagueDraftApi.queue,
  controls: leagueDraftApi.controls,
  actions: leagueDraftApi.actions,
  chat: leagueDraftApi.chat,

  pickByDraftId: (draftId: string) => `/api/draft/${encodeURIComponent(draftId)}/pick`,
  stream: (draftId: string) => `/api/draft/stream/${encodeURIComponent(draftId)}`,

  /**
   * Legacy standalone draft room state endpoint.
   * Do not use for new redraft league draft work.
   */
  legacyRoomState: () => `/api/draft/room/state`,
} as const