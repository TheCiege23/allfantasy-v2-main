# Decision Context Fidelity — Waiver Shadow Parity (Phase 15)

**Status: implemented, real-data validated against the same real Sleeper league used in Phase 13/14, and against 2 additional real rosters in Phase 16 (including, for the first time, non-default `maxResults` values in real requests). Waiver shadow-compare only. Rollback unchanged (one flag).**

**Phase 16 update:** re-validated with `maxResults` values of 5 and 15 (not just the default 10) across 2 additional real rosters — all correctly forwarded and compared, 14/14 `equivalent`. See [`FANTASY_OS_WAIVER_MULTI_LEAGUE_VALIDATION.md`](FANTASY_OS_WAIVER_MULTI_LEAGUE_VALIDATION.md).

## Why this phase

Phase 14's real re-validation surfaced something more important than a
missing field: **the shadow comparison was not evaluating the same decision
context as the authoritative engine.** `evaluateWaiverShadow({leagueId,
rosterId})` never received `currentWeek`/`goal`, so it always evaluated as
week-1/balanced regardless of what the real request actually asked for.
Phase 13's broken player-identity data had been masking this — with mostly
`UNKNOWN` positions, `computeTeamNeeds`'s week/goal-sensitive weighting had
almost no real signal to vary by. Phase 14 fixed player identity, which made
this pre-existing gap visible for the first time as real `acceptable_variance`
results (14/21 `equivalent`, 7/21 `acceptable_variance`, still 0%
`material_divergence`).

This phase is not about improving recommendations — it's about proving both
engines are answering the same question before their answers are compared.

## Required audit — the complete authoritative deterministic input surface

Traced `route.ts` → `runWaiverAIService()` → `suggestWaiverPickups()` →
`buildScoringContext()`/`scoreWaiverCandidates()` directly (not assumed).
The full deterministic input surface is exactly `WaiverAIEngineInput`:

`sport, roster, rosterPositions, allLeagueRosters, currentWeek, goal, leagueSettings, availablePlayers, teamNeeds, maxResults`

Plus `WaiverAIServiceInput`'s own `includeAIExplanation` (gates an LLM call
only — never touches deterministic scoring). Route-level `leagueId`/
`confirmTokenSpend` are entitlement/identity concerns, not scoring inputs.

No `projection inputs`, separate `lineup state`, separate `injuries` field,
or separate `imported provider settings` field exist anywhere in this input
type — those concepts are either subsumed into `roster`/`availablePlayers`
already (e.g. `injuryStatus` is a per-player field inside `availablePlayers`)
or don't exist in this codebase at all. Documented as "not applicable,"
not silently assumed absent.

## Context Fidelity Matrix

| Context Item | Authoritative | Shared (before Phase 15) | Shared (after Phase 15) | Classification |
|---|---|---|---|---|
| `currentWeek` | ✓ client value | ✗ always defaults to 1 | ✓ forwarded | **accidentally omitted** |
| `goal` | ✓ client value | ✗ always defaults to `'balanced'` | ✓ forwarded | **accidentally omitted** |
| `maxResults` | ✓ client value (1–25) | ✗ hardcoded to 10 inside `WaiverContextAssembler` regardless of input | ✓ forwarded (clamped 1–25) | **accidentally omitted** (a real, third gap found beyond week/goal) |
| `roster` | ✓ client-supplied | ✓ independently DB-assembled | ✓ unchanged | **intentionally omitted from forwarding** — this is the exact thing the shadow compare validates; forwarding it would defeat the test |
| `availablePlayers` | ✓ client-supplied | ✓ independently DB-assembled | ✓ unchanged | intentionally omitted from forwarding |
| `leagueSettings` | ✓ client-supplied | ✓ independently DB-assembled | ✓ unchanged | intentionally omitted from forwarding |
| `rosterPositions` | ✓ client-supplied | ✓ independently derived from `League.starters` | ✓ unchanged | intentionally omitted from forwarding |
| `allLeagueRosters` | ✓ client-supplied | ✓ independently DB-assembled | ✓ unchanged | intentionally omitted from forwarding |
| `teamNeeds` | ✓ client-supplied or derived | ✓ independently derived — but from the *wrong* `currentWeek` before this phase | ✓ independently derived, now from the *correct* `currentWeek` | **normalized** (fixed indirectly by forwarding `currentWeek`) |
| `sport` | ✓ | ✓ independently DB-resolved | ✓ unchanged | already identical/normalized — a mismatch-detection comparison already existed pre-Phase-15 (`unsupportedReason`) |
| `includeAIExplanation` | ✓ | n/a — shadow never generates AI text | n/a | **intentionally omitted** — non-deterministic, AI-only, irrelevant to comparison |
| `confirmTokenSpend` | ✓ | n/a | n/a | **intentionally omitted** — entitlement/billing only, not a scoring input |
| `leagueId` | ✓ | ✓ server-resolved via `loadWaiverWorldFacts` | ✓ unchanged | **identity** — never inside Decision Context, never client-trusted for the shared side |
| `rosterId` | n/a (client never sends this) | ✓ server-resolved | ✓ unchanged | **authorization-sensitive** — never client-supplied, never inside Decision Context |
| `userId` | ✓ session | ✓ session (used only to resolve `rosterId`) | ✓ unchanged | **identity/authorization** — never inside Decision Context |
| waiver mode / FAAB budget | n/a — not an input to `scoreWaiverCandidates` at all | ✓ via `getEffectiveLeagueWaiverSettings` (DB) | ✓ unchanged | **not applicable to the authoritative deterministic engine** — FAAB fields are shadow-output-only (`WaiverEvaluation.faab`), not a scoring input either side |
| projection inputs | n/a — no such field exists in this codebase | n/a | n/a | **not applicable** — no projection system feeds this engine today |
| injuries | subsumed in `availablePlayers[].injuryStatus` | subsumed the same way (via `getPlayerPoolForLeague`'s `injury_status`) | unchanged | already covered, not a separate top-level field |
| lineup state | subsumed in `roster[].slot` | subsumed the same way | unchanged | already covered, not separate |
| cached world facts | n/a | `loadWaiverWorldFacts`'s own result (`rosterId`, `sport`, `platform`) — identity resolution only | unchanged | **identity/authorization**, correctly excluded |

**No undocumented differences remain** — every field on `WaiverAIServiceInput` is accounted for above.

## Build: `WaiverRequestContext`

**A naming note, disclosed rather than silently worked around:** the brief
asked for a type named `WaiverDecisionContext`. That name is already taken
by a real, different, existing type —
`lib/shared-services/waiver/WaiverContextAssembler.ts`'s `WaiverDecisionContext`
(the full assembled context: identity + league/waiver context +
`engineInput` + FAAB/needs/completeness). Reusing the same name for a
narrower, request-only object would collide and confuse the two. The new
type is `WaiverRequestContext` — see `lib/decision-os/waiver/WaiverRequestContext.ts`.

```ts
interface WaiverRequestContext {
  currentWeek: number   // 1–30, always concrete (defaulted the same way the authoritative engine defaults it)
  goal: UserGoal         // 'win-now' | 'balanced' | 'rebuild', always concrete
  maxResults: number     // 1–25, always concrete, clamped
}
```

`extractWaiverRequestContext(engineInput)` is a **pure function** — no DB
access, no authorization decision, reads exactly 3 fields off the
client-supplied engine input and applies the same defaults
`suggestWaiverPickups`/`buildScoringContext` already use, so an omitted
field resolves identically on both sides (not just an identical
*possibly-undefined* value).

## Security review (per field, as required)

| Field | Reveals private info? | Weakens authorization? | Reconstructable from `leagueId` alone? | Request-local only? | Deterministic? | Already available to the authoritative engine? |
|---|---|---|---|---|---|---|
| `currentWeek` | No | No | No — no "current week" is stored; a user may intentionally view a past/future week | Yes | Yes | Yes (client sent it) |
| `goal` | No | No | No — confirmed no `waiverGoal`/`savedGoal`/`preferredGoal` field exists anywhere in this schema | Yes | Yes | Yes |
| `maxResults` | No | No | No — arbitrary client choice | Yes | Yes | Yes |

None of the three fields identify a user, a roster, a league, or a
credential. All three are already sent by the client to the authoritative
engine in the exact same request — forwarding them to the shadow adds no new
information exposure, since the shadow only ever runs for the same
authenticated, already-`assertLeagueMember`-checked request. `leagueId`/
`rosterId`/`userId` remain entirely separate, resolved server-side, never
inside `WaiverRequestContext`.

## Shadow comparison rules (unchanged from Phase 12/13, now honored precisely)

The authoritative engine remains authoritative — this phase changes zero
lines in `runWaiverAIService`/`suggestWaiverPickups`/`scoreWaiverCandidates`,
and zero lines in the response returned to the client. The shared service
remains shadow-only — nothing it produces is ever surfaced to the user. The
comparison seam (`sharedServiceShadowCompare.ts`) now calls:

```ts
evaluateWaiverShadow({
  leagueId,                    // identity
  rosterId: facts.rosterId,    // identity, server-resolved
  currentWeek: requestContext.currentWeek,  // decision context
  goal: requestContext.goal,                // decision context
  maxResults: requestContext.maxResults,    // decision context
})
```

No provider objects, no roster/pool data, no unnecessary fields cross the
boundary — tested explicitly (`Object.keys(callArgs).sort()` must equal
exactly `['currentWeek', 'goal', 'leagueId', 'maxResults', 'rosterId']`).

## Telemetry (extended, not duplicated)

No second telemetry system was created — `emitShadowParity` (the same
`decision.shadow_parity` event every Decision OS slice already emits) now
additionally carries:

- `comparisonVersion: 'phase15-decision-context'` — on every emission path (success and all 3 failure paths), so historical telemetry can be filtered by whether it reflects the old (identity-only) or new (decision-context-aware) comparison.
- `currentWeek`, `goal`, `maxResults` — the exact request context both engines were evaluated with, on the success and exception/timeout paths (the two `world_facts_error`/`insufficient_context` early-return paths don't reach a shared evaluation at all, so only `comparisonVersion` is meaningful there).

The `WaiverShadowCompareResult` return type also gained a `requestContext`
field, always populated (extracted before any DB call), so callers besides
telemetry can see exactly what was compared.

## Real-data validation — before/after (same real Sleeper league, same 21 requests)

| Metric | Phase 14 (pre-fix) | Phase 15 (post-fix) |
|---|---|---|
| `equivalent` | 14/21 (67%) | **21/21 (100%)** |
| `acceptable_variance` | 7/21 (33%) | 0/21 (0%) |
| `material_divergence` / `shadow_execution_failure` / `insufficient_context` | 0/21 each | 0/21 each (unchanged) |
| `topCandidateAgreement` rate | 14/21 | **21/21** |
| `comparisonVersion` stamped | n/a (didn't exist yet) | 21/21 |
| HTTP status | 21/21 `200` | 21/21 `200` |

**Equivalence returned to 100% for the right reason this time** — not
because bad data was masking real signal (Phase 13's confound), but because
both engines are now genuinely evaluating the same real week/goal/
maxResults for the same real roster. This is the meaningful distinction the
brief asked to prove or disprove; it's proven.

Latency: shared-service p95 rose slightly to 1,095ms in this run (vs Phase
14's 670ms) — attributable to this run starting from a cold server (first
request in the batch took 17.9s total, dominated by cold Next.js/FantasyCalc
warm-up, not the 3 extra fields threaded through). Still far under the
4,000ms timeout bound; 0% timeouts in both runs. The 3 forwarded fields
themselves add no meaningful overhead — they're already-computed local
values, not new queries.

## Rollback

Unchanged: `SHARED_SERVICES_WAIVER_SHADOW_COMPARE` remains the complete
rollback mechanism. `extractWaiverRequestContext` is a pure, synchronous
function with no side effects and no new code path reachable outside the
already-flag-gated seam — disabling the flag stops everything, exactly as
proven in Phase 13. No new flag was added or needed for this fix.

## Tests added

`__tests__/decision-os/waiver-request-context.test.ts` (15 tests): context
construction, serialization, omitted-context defaults (week/goal/maxResults
forwarding and defaulting), out-of-range clamping, authorization boundaries
(never leaks identity fields even if present on the input object; pure
function, never touches the DB), and identical-input reproducibility.

`__tests__/decision-os/waiver-shared-service-shadow-compare.test.ts`: 2
existing Phase 12 tests updated (the old "only leagueId/rosterId cross the
boundary" assertion is now intentionally, correctly
`['currentWeek','goal','leagueId','maxResults','rosterId']`) + 3 new tests
(telemetry carries the decision context and comparison version on both
success and failure paths; the result object exposes `requestContext`).

## Documentation updated

This document (new) plus pointer updates in
[`FANTASY_OS_WAIVER_SHADOW_COMPARE.md`](FANTASY_OS_WAIVER_SHADOW_COMPARE.md)
and [`FANTASY_OS_PLAYER_IDENTITY.md`](FANTASY_OS_PLAYER_IDENTITY.md).

## What this phase does NOT do

- Does not build a generic, domain-agnostic `DecisionContext` runtime
  abstraction shared across Trade/Draft/Game Day/Commissioner. Those domains
  have entirely different real request-context fields (unaudited this
  phase); fabricating a shared abstraction with only one real consumer to
  validate it against would be premature. The *pattern* demonstrated here —
  separate identity, league/waiver context, and request context; audit the
  full real input surface before assuming what's missing; forward only what
  cannot be reconstructed — is documented as reusable design guidance, not
  built as reusable code, matching this effort's established discipline of
  not fabricating unvalidated abstractions.
- Does not touch `runWaiverAIService`, `suggestWaiverPickups`, or
  `scoreWaiverCandidates` — the authoritative engine is unchanged.
- Does not change the response returned to any real user.
