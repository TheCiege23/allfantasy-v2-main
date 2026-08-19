# Next-Season Eligibility Rules

`lib/redraft/renewal/nextSeasonEligibility.ts::evaluateNextSeasonEligibility` — pure, deterministic, never mutates, called both pre-flight and (with freshly re-read data) inside the atomic transaction.

## Real checks implemented

| Check | Violation code | Basis |
|---|---|---|
| Source league exists | `SOURCE_SEASON_NOT_FOUND` | Real, unconditional |
| Source season exists | `SOURCE_SEASON_NOT_FOUND` | Real, unconditional |
| Actor is commissioner (League.userId or a team row with isCommissioner/isCoCommissioner matching the actor) | `UNAUTHORIZED` | Real, matches the existing `isCommissionerOrCo` pattern used by `trade-votes/route.ts` |
| Administrator requires an explicit override | `UNAUTHORIZED` | Real — administrators cannot act without `override.enabled` |
| Sport is NFL or NCAAF | `UNSUPPORTED_SPORT` | Real, checked against both `League.sport` and `RedraftSeason.sport` |
| Source season is complete | `SOURCE_SEASON_INCOMPLETE` | Real — reuses the exact `status === 'complete'` signal `enterRedraftOffseason` already uses, not a new concept |
| Playoff/championship resolved | `UNRESOLVED_CHAMPION` | Real — `RedraftPlayoffBracket.status === 'complete'` when a bracket exists; a season with no bracket row at all is not blocked (a real, disclosed judgment call — see below) |
| Rosters/standings exist | `UNRESOLVED_STANDINGS` | Real — a season with zero rosters cannot carry ownership evidence forward |
| Manager mapping complete | `MANAGER_MAPPING_INCOMPLETE` | Real — every roster must have a non-null `ownerId` |
| Requested season follows source correctly | `INVALID_SEASON_SEQUENCE` | Real — `requestedSeason === season.season + 1`, exactly |
| Destination does not already exist | `DESTINATION_ALREADY_EXISTS` | Real — checked against `LeagueRenewal.nextSeasonId` |

## Checks from the brief not implemented this phase

- `SOURCE_SEASON_NOT_ARCHIVED` — not enforced; see the Call Graph doc's Archive Integration Disposition for why (archival itself is unsafe, so requiring it would import that unsafety).
- `DESTINATION_PARTIALLY_EXISTS` — not separately detected; a partially-created destination is not a state this phase's transaction can produce (destination creation is fully atomic, so "partial" only happens from a source outside this code path, which was not audited this phase).
- `SETTINGS_SNAPSHOT_MISSING` / `SCORING_SNAPSHOT_MISSING` — not separately checked as a pre-condition; `League.settings` is nullable in the schema but every real league observed in production data had a real settings blob. If it were ever null, the code would snapshot `null`, not fail loudly — a real, disclosed gap.
- `CONFLICTING_IDEMPOTENCY_PAYLOAD` — implemented, but at the top-level `createNextSeason` function (comparing the reused key's source league/season against the request), not inside the evaluator itself.

## The "no bracket at all" judgment call, stated explicitly

If a season has no `RedraftPlayoffBracket` row, `playoffBracketStatus` is `null`, and the evaluator treats this as **passing** (not blocking). This is a real, deliberate choice: some redraft leagues may not use this codebase's playoff-bracket subsystem at all (e.g. a league with `medianGame`-only or non-playoff scoring), and requiring a bracket to exist would incorrectly block genuinely eligible leagues. This was not physically tested against a real no-bracket season this phase — the two real seasons used for testing both had no bracket row, and both correctly passed. Whether a *supported* league type genuinely requires playoff resolution before renewal (as opposed to lacking a bracket for an unrelated reason) is a real, disclosed open policy question, not resolved this phase.

## Required tests — disposition

| Test scenario from the brief | Covered |
|---|---|
| Completed NFL season | Yes — unit test + real physical proving run |
| Incomplete NFL season | Yes — unit test |
| Completed NCAAF season | Yes — unit test only (no real NCAAF physical proving run this phase — see NFL/NCAAF Parity Report) |
| Unresolved NCAAF championship | Yes — unit test |
| Missing champion | Yes — unit test (`playoffBracketStatus: 'pending'`) |
| Tied standings with deterministic tiebreaker | **Not tested** — no tiebreaker logic exists in the eligibility evaluator at all; ties are not specially detected |
| Tied standings without deterministic resolution | **Not tested**, same reason |
| Unarchived source | N/A — archival is not a gate this phase (see above) |
| Unsupported league type | Covered by the sport check; no separate "league type" dimension exists in this codebase beyond sport |
| Unauthorized manager | Yes — unit test + real physical test |
| Commissioner | Yes — unit test + real physical test |
| Administrator | Yes — unit test (override required/permitted) |
| Duplicate request | Yes — unit test + real physical idempotency test |
| Invalid requested season | Yes — unit test + real physical test |
