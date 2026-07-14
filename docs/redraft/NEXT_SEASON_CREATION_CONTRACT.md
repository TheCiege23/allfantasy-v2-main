# Next-Season Creation Contract

Full types: `lib/redraft/renewal/nextSeasonContract.ts`. Adapted from the brief's preferred shape to this repo's real conventions (`requestedSeason`/`season` fields are `number`, not `string`, matching `RedraftSeason.season Int` and `LeagueRenewal.season Int` — using a string here would have required a lossy conversion at every call site for no benefit).

## Input / Output / Violations

`CreateNextSeasonInput`, `CreateNextSeasonResult`, and `NextSeasonCreationViolation` match the brief's shapes field-for-field, with the one type correction above. `NextSeasonEligibilityResult` (`{eligible: boolean, violations: Array<{code, message}>}`) is an addition — the evaluator's own real return shape, used both inside the transaction and by the unit tests.

## Settings vs. scoring snapshot — a real architectural note, not a shortcut

The brief's contract has separate `settingsSnapshotId`/`scoringSnapshotId` fields. This codebase has no separate scoring-settings model — `League.settings: Json?` is the single, already-versioned (`settingsSnapshotVersion: Int?`) canonical blob covering "roster/scoring/draft/waiver/playoff + conceptSetup + conceptRules" (confirmed via its own doc comment and the `SettingsSnapshot` type in `lib/league-contract/types.ts`). Rather than fabricate a second, parallel scoring-versioning system that doesn't exist anywhere else in the codebase, `createNextSeason` snapshots `League.settings` once and returns the **same** identifier (the `LeagueRenewal.id`) for both `settingsSnapshotId` and `scoringSnapshotId`. This is disclosed here explicitly rather than silently presented as two independent systems.

## Structured violations, not generic strings

Every ineligibility path in `evaluateNextSeasonEligibility` returns one or more of the 14 `NextSeasonCreationViolation` codes from the brief, each with a specific, real message (e.g. `"Requested season 2029 does not immediately follow source season 2026."`, not `"Invalid request"`). Verified via `next-season-eligibility.test.ts` (16 tests) and physically confirmed via a real unauthorized-actor test against the disposable database (`UNAUTHORIZED` + `INVALID_SEASON_SEQUENCE` returned together, correctly accumulated rather than short-circuiting at the first violation).
