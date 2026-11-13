/**
 * Legacy draft-runtime write guard (Commit L).
 *
 * The codebase has two parallel draft-pick write paths:
 *
 *   1. CANONICAL — `lib/live-draft-engine/PickSubmissionService.submitPick()`
 *      writes to the AllFantasy canonical tables (`DraftPick`,
 *      `DraftSession`). This is the path the NFL redraft draft room calls
 *      via `/api/leagues/[leagueId]/draft/pick`,
 *      `/api/leagues/[leagueId]/draft/autopick-expired`,
 *      `/api/leagues/[leagueId]/draft/controls`, and the commissioner
 *      assign-pick action on `/api/commissioner/leagues/[leagueId]/draft`.
 *
 *   2. LEGACY — `lib/draft/execute-pick.ts:executeDraftPick()` writes to
 *      the legacy `DraftRoomPickRecord` / `DraftRoomStateRow` tables.
 *      This path was the original mock-draft runtime and is still the
 *      authoritative writer for **mock** sessions (session key prefix
 *      `mock:`).
 *
 * The risk: a live-mode session key (`live:<leagueId>`) hitting the legacy
 * path would write to the legacy tables and the canonical board would
 * never see the pick. That would corrupt the unified-state contract
 * locked by Commit E (the live `<DraftBoard>` reads from the canonical
 * `DraftSession.picks`, not the legacy `DraftRoomPickRecord`).
 *
 * This guard fails fast for that case so callers are forced to use the
 * canonical path for live writes. Mock writes pass through unchanged.
 */

type LegacyDraftRuntimeWriteGuardInput = {
  /** Logical caller — usually the API route or service name. */
  route: string
  /** What the caller is trying to do (e.g. `'commit_pick'`, `'undo_pick'`). */
  operation: string
  /** Session id from `parseSessionKey` (the unprefixed UUID/league id). */
  sessionId: string
  /** Session mode from `parseSessionKey`. Live writes are blocked here. */
  mode: 'mock' | 'live'
}

/**
 * Thrown by `assertLegacyDraftRuntimeWriteAllowed` when a live-mode write is
 * attempted against the legacy DraftRoom tables. Distinct from generic
 * `Error` so callers can choose to map it to a specific HTTP status (e.g.
 * 403 / 410) without catching unrelated failures.
 */
export class LegacyDraftRuntimeWriteBlockedError extends Error {
  readonly route: string
  readonly operation: string
  readonly sessionId: string

  constructor(input: LegacyDraftRuntimeWriteGuardInput) {
    super(
      `Legacy DraftRoom runtime writes are blocked for live sessions. ` +
        `Route ${input.route} attempted ${input.operation} against live session ${input.sessionId}; ` +
        `route this through @/lib/live-draft-engine/PickSubmissionService.submitPick instead.`,
    )
    this.name = 'LegacyDraftRuntimeWriteBlockedError'
    this.route = input.route
    this.operation = input.operation
    this.sessionId = input.sessionId
  }
}

/**
 * Block live-mode writes against the legacy DraftRoom runtime. Mock writes
 * pass through unchanged. Throws `LegacyDraftRuntimeWriteBlockedError`
 * for live mode.
 *
 * Intended call site: top of any function that writes to
 * `prisma.draftRoomPickRecord` or `prisma.draftRoomStateRow`. The guard is
 * a no-op for mock mode.
 */
export function assertLegacyDraftRuntimeWriteAllowed(
  input: LegacyDraftRuntimeWriteGuardInput,
): void {
  if (input.mode === 'live') {
    throw new LegacyDraftRuntimeWriteBlockedError(input)
  }
}
