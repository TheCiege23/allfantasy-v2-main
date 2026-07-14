/**
 * Authoritative contract for atomic next-season creation. This is the single
 * input/output/violation vocabulary the eligibility evaluator, the atomic
 * transaction, and the API route all share — no ad hoc shapes elsewhere.
 */

export type CreateNextSeasonInput = {
  sourceLeagueId: string
  sourceSeasonId: string
  requestedSeason: number
  actorUserId: string
  actorRole: 'commissioner' | 'administrator'
  idempotencyKey: string
  requestTimestamp: string
  expectedSourceVersion?: string | null
  override?: {
    enabled: boolean
    reason: string | null
  }
}

export type CreateNextSeasonResult = {
  sourceLeagueId: string
  sourceSeasonId: string
  destinationLeagueId: string
  destinationSeasonId: string
  requestedSeason: number
  status: 'created' | 'already_created' | 'blocked' | 'conflict'
  rosterCount: number
  managerAssignmentCount: number
  settingsSnapshotId: string | null
  scoringSnapshotId: string | null
  scheduleStatus: 'initialized' | 'deferred' | 'not_applicable'
  waiverStatus: 'initialized' | 'deferred' | 'not_applicable'
  draftStatus: 'initialized' | 'deferred' | 'not_applicable'
  eventId: string | null
  auditId: string | null
  idempotencyKey: string
  limitations: string[]
}

export type NextSeasonCreationViolation =
  | 'UNAUTHORIZED'
  | 'SOURCE_SEASON_NOT_FOUND'
  | 'SOURCE_SEASON_INCOMPLETE'
  | 'SOURCE_SEASON_NOT_ARCHIVED'
  | 'SOURCE_LEAGUE_ALREADY_ARCHIVED'
  | 'DESTINATION_ALREADY_EXISTS'
  | 'DESTINATION_PARTIALLY_EXISTS'
  | 'INVALID_SEASON_SEQUENCE'
  | 'UNRESOLVED_CHAMPION'
  | 'UNRESOLVED_STANDINGS'
  | 'SETTINGS_SNAPSHOT_MISSING'
  | 'SCORING_SNAPSHOT_MISSING'
  | 'MANAGER_MAPPING_INCOMPLETE'
  | 'CONFLICTING_IDEMPOTENCY_PAYLOAD'
  | 'UNSUPPORTED_SPORT'
  | 'UNSUPPORTED_LEAGUE_TYPE'

export type NextSeasonEligibilityResult = {
  eligible: boolean
  violations: Array<{ code: NextSeasonCreationViolation; message: string }>
}
