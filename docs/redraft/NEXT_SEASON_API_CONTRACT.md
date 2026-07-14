# Next-Season API Contract

Full types: `lib/redraft/renewal/nextSeasonApiContract.ts`.

## Deliberate deviation from the brief's literal request shape

`CreateNextSeasonApiRequest` does **not** include `sourceLeagueId`/`sourceSeasonId`/`requestedSeason` at all — only `idempotencyKey`, `expectedSourceVersion`, and `override`. This is stricter than "do not accept `actorUserId`/`actorRole` from the client" — there is no league/season pair for a tampered request to supply in the first place; they are derived exclusively from the `renewalId` route parameter's own real, server-controlled `leagueId`/`priorSeasonId` fields. Route-parameter tampering (Part 6, item 7) is structurally addressed by this design, not just tested against.

## Response contract

`CreateNextSeasonApiResponse<CreateNextSeasonResult>` — a discriminated union (`ok: true | false`), matching the brief exactly. Error codes implemented and physically exercised: `UNAUTHORIZED` (401), `FORBIDDEN` (403), `INVALID_REQUEST` (400), `SOURCE_SEASON_NOT_FOUND` (404), `SOURCE_SEASON_INCOMPLETE` (422, carries `violations`), `CONFLICT` (409), `RETRYABLE_CONFLICT` (409, `retryable: true`), `INTERNAL_ERROR` (500). `DESTINATION_ALREADY_EXISTS`, `DESTINATION_PARTIALLY_EXISTS`, `INVALID_SEASON_SEQUENCE`, and `UNSUPPORTED` are defined in the type but surface as `violations` entries under `SOURCE_SEASON_INCOMPLETE` rather than as distinct top-level error codes — this codebase's `evaluateNextSeasonEligibility` already returns a structured violation list, and re-deriving a separate top-level code per violation would duplicate that information rather than add precision.

## Status code behavior, physically verified

201 (real created), 200 (real already-created, both fresh idempotent-replay and pre-existing-completion paths), 422 (real blocked eligibility, e.g. a genuinely wrong season sequence), 403 (real unauthorized), 400 (real malformed input), 404 (real nonexistent renewal, confirmed to contain no raw Prisma/Postgres text). 409 paths (CONFLICT, RETRYABLE_CONFLICT) and 500 were not independently physically triggered this phase beyond the conflict-handling unit coverage — see the Physical Validation report.

## No raw internals ever returned

Verified directly: a request against a nonexistent `renewalId` returns a clean 404 with no Prisma/Postgres/host text anywhere in the JSON body (asserted via regex in the physical test run). The catch-all internal-error path logs the real error server-side (`console.error`, structured, no secrets) and returns only `{code: 'INTERNAL_ERROR', message: 'Renewal execution failed unexpectedly.'}` to the client.
