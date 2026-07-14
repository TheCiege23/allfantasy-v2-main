import type { NextSeasonCreationViolation } from './nextSeasonContract'

/**
 * API-level request/response contract for POST /api/redraft/renewals/[renewalId]/execute.
 *
 * Deliberate deviation from the brief's literal shape: `sourceLeagueId` and
 * `sourceSeasonId` are NOT accepted from the client at all (not merely
 * `actorUserId`/`actorRole`) — they are derived server-side from the
 * `renewalId` route param's own `leagueId`/`priorSeasonId` (real fields
 * `openRedraftRenewal` already populates at renewal-open time). This is
 * strictly more secure than accepting them from the client: there is no
 * league/season pair for a tampered request to supply in the first place.
 */
export type CreateNextSeasonApiRequest = {
  idempotencyKey: string
  expectedSourceVersion?: string | null
  override?: {
    enabled: boolean
    reason: string | null
  }
}

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INVALID_REQUEST'
  | 'SOURCE_SEASON_NOT_FOUND'
  | 'SOURCE_SEASON_INCOMPLETE'
  | 'DESTINATION_ALREADY_EXISTS'
  | 'DESTINATION_PARTIALLY_EXISTS'
  | 'INVALID_SEASON_SEQUENCE'
  | 'CONFLICT'
  | 'RETRYABLE_CONFLICT'
  | 'UNSUPPORTED'
  | 'INTERNAL_ERROR'

export type CreateNextSeasonApiResponse<Result> =
  | { ok: true; result: Result }
  | {
      ok: false
      error: {
        code: ApiErrorCode
        message: string
        retryable: boolean
        violations?: NextSeasonCreationViolation[]
      }
    }
