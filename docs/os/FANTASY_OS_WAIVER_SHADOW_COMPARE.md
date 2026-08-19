# Waiver Shared-Service Shadow Compare (Phase 12)

> **STALE-MODULE NOTE (2026-08-09, AF_TRADE_UNIFICATION_BRIEF Phase 0.5):** the module
> this document describes — `lib/decision-os/waiver/sharedServiceShadowCompare.ts` —
> **does not exist in the repo** (never landed on this branch or was removed). Its test
> was deleted in Phase 0/1 because it imported the missing path. The 39/39 result below
> is historical evidence from that module's validation runs and cannot currently be
> reproduced from `main`. The live, real waiver shadow is
> `lib/decision-os/waiver/shadow.ts`, wired into `app/api/waiver-ai/engine/route.ts`
> with `emitShadowParity('manager.waiver.claim', …)`.

**Status: implemented (Phase 12), real-data validated against one real imported Sleeper league (Phase 13), player-identity gap closed (Phase 14), decision-context fidelity fixed (Phase 15), generalized to 3 distinct real rosters (Phase 16). Off by default in every real environment. Not an authoritative migration.**

**Phase 15 update:** the shadow-compare seam previously never forwarded `currentWeek`/`goal`/`maxResults` to `evaluateWaiverShadow`, so it always evaluated as week-1/balanced/top-10 regardless of the real request. Fixed via a new, narrow `WaiverRequestContext` extraction (see [`FANTASY_OS_DECISION_CONTEXT.md`](FANTASY_OS_DECISION_CONTEXT.md) for the full audit, security review, and Context Fidelity Matrix). Re-validated against the same real Sleeper league: `equivalent` rate rose from 14/21 (67%, Phase 14) to **21/21 (100%)** — for the correct reason (identical decision context), not a masked one.

**Phase 16 update:** validated 2 additional, structurally distinct real Sleeper rosters (22 and 33 players, vs the original 27) within the same league — no independent second real league or provider exists in this non-production environment, disclosed honestly. Combined: **39/39 (100%) real telemetry events `equivalent`** across 3 rosters. No bug found; no code changed. Readiness remains **B — continue shadow validation**; see [`FANTASY_OS_WAIVER_MULTI_LEAGUE_VALIDATION.md`](FANTASY_OS_WAIVER_MULTI_LEAGUE_VALIDATION.md).

**Phase 13 update:** real-data validation against a genuine, non-production, imported Sleeper dynasty league found and fixed one real bug in `WaiverContextAssembler.ts` (roster parsing silently returned zero players for un-normalized real Sleeper imports), then produced 22/22 `equivalent` shadow-compare results with 0 failures/timeouts. See [`FANTASY_OS_WAIVER_REAL_DATA_VALIDATION.md`](FANTASY_OS_WAIVER_REAL_DATA_VALIDATION.md) for full evidence, methodology, and the resulting readiness classification (**B — continue shadow validation**, not yet ready for authoritative-fidelity testing). The comparison-semantics and telemetry sections below are unchanged from Phase 12; only the "Known gaps" and "Criteria for considering an authoritative migration" sections have been updated to reflect real evidence.

This document covers the concrete implementation of the migration candidate selected in [`docs/os/FANTASY_OS_FIRST_CONSUMER_MIGRATION_READINESS.md`](FANTASY_OS_FIRST_CONSUMER_MIGRATION_READINESS.md) (Candidate B).

## Current architecture (unchanged, authoritative)

```
POST /api/waiver-ai/engine
  → session check (401)
  → Zod request validation (400)
  → assertLeagueMember, when leagueId present (403)
  → requireFeatureEntitlement('ai_waivers') (402/gated)
  → runWaiverAIService(input)                         ← AUTHORITATIVE, untouched
  → Decision OS Slice 2 wrap-fidelity card (unchanged) ← reuses the SAME `analysis` above, no recompute
  → response: { success, analysis, tokenSpend, decisionOs? }
```

## Implemented architecture (additive)

```
  → [everything above, byte-for-byte unchanged]
  → if leagueId present AND shouldRunSharedWaiverShadowCompare(env, {leagueId}):
      → await runSharedWaiverShadowCompare({ userId, leagueId, engineInput: input, legacyAnalysis: analysis, authoritativeDurationMs })
          → loadWaiverWorldFacts(userId, leagueId)          ← reused, real, authorized rosterId resolution
          → evaluateWaiverShadow({ leagueId, rosterId })    ← lib/shared-services/waiver/WaiverShadowService.ts, independent DB context assembly
          → compare vs legacyAnalysis.deterministic.suggestions
          → emitShadowParity('shared_services.waiver', {...})  ← thin wrapper over emitDecisionTelemetry, same taxonomy every slice uses
      → (caught defensively; the seam itself never throws)
  → response: [identical to above — the seam never touches it]
```

## Feature flag

`SHARED_SERVICES_WAIVER_SHADOW_COMPARE` — read via the existing `shouldRunShadow(flagEnvVar, env, scope)` helper (`lib/decision-os/core/shadow/flag.ts`), the same mechanism `DECISION_OS_WAIVER_SHADOW`/`DECISION_OS_WAIVER_LIVE`/`DECISION_OS_TRADE_LIVE`/`DECISION_OS_LINEUP_LIVE` already use. **Default: unset (disabled).** Optional scoping via the existing `DecisionShadowScope`/`getDecisionShadowScopeFilters()` (`DECISION_OS_TEST_LEAGUE_IDS`/`DECISION_OS_TEST_USERNAMES`) is supported for free since `shouldRunShadow` already accepts a scope argument — the route currently passes `{ leagueId: input.leagueId }` as scope, so a future rollout can narrow to specific test leagues via the existing env vars without any new code.

## Authoritative engine vs. shared shadow engine

- **Authoritative**: `runWaiverAIService` (`lib/waiver-ai-engine`) → `scoreWaiverCandidates`, fed the CLIENT-SUPPLIED roster/pool context from the request body.
- **Shared shadow**: `evaluateWaiverShadow` (`lib/shared-services/waiver/WaiverShadowService.ts`) calls the SAME `runWaiverAIService`/`scoreWaiverCandidates`, but fed its OWN, independently DB-assembled roster/pool context (`WaiverContextAssembler.ts` — real ADP snapshot, real sport-scoped free-agent pool, real roster lineup sections). **This is the genuinely new thing being validated**: does the shared service's independent context assembly produce an equivalent view of the same real league to whatever the client currently sends?

## Comparison dimensions implemented

| Dimension | Implemented | Notes |
|---|---|---|
| Top recommendation agreement | Yes | `legacyTop.playerId === sharedTop.playerId` |
| Candidate membership overlap | Yes (partial) | Shared service's top pick's rank position in the legacy engine's own ranked list — see "known gap" below |
| Ranked-order agreement (full) | **Not implemented** | `WaiverEvaluation` only exposes its own top candidate, not a full ranked list — implementing this would require modifying the shared service's public output type, out of scope this phase (see Known gaps) |
| Score delta | Yes | `legacyTop.compositeScore - shared.recommendation.score` (same 0–100 scale, both derived from the same `scoreWaiverCandidates`) |
| FAAB delta | Yes | `legacyTop.faabBid - shared.faab.recommendedBid` |
| Empty-result agreement | Yes | Both-empty → `exact_match`; one-sided empty → `material_divergence` |
| Provider-context completeness | Yes | Client-supplied `sport` vs. the shared service's DB-resolved `sport` — mismatch is flagged in `unsupportedReason`, never silently presented as a real recommendation divergence |
| Freshness/source differences | Yes | `evaluation.freshness`/`evaluation.sourceAttribution` are included in the telemetry payload |
| Shared-service execution failure | Yes | `shadow_execution_failure`, with a real failure reason (exception message or `"...timed out after 4000ms"`) |
| Insufficient context | Yes | No roster resolvable for the authorized user in this league → `insufficient_context`, shared service never even called |

**Comparison statuses**: `exact_match` | `equivalent` | `acceptable_variance` | `material_divergence` | `unsupported_comparison` | `insufficient_context` | `shadow_execution_failure` — never a fabricated match; a failed comparison is always reported as a failure, never silently coerced into "empty recommendations" or a false match.

## Telemetry

`emitShadowParity('shared_services.waiver', flags, evaluationId?)` — a thin, pre-existing wrapper (`lib/decision-os/core/parity/telemetry.ts`) over `emitDecisionTelemetry('decision.shadow_parity', decisionType, flags, decisionId)`. No new sink, no new event taxonomy value — reuses the SAME `decision.shadow_parity` category every other slice (trade/waiver/lineup Decision OS wrappers) already emits.

Fields captured: `compare: true`, `ran`, `status`, `leagueId`, `provider`, `topCandidateAgreement`, `candidateOverlap`, `scoreDelta`, `faabDelta`, `authoritativeDurationMs`, `sharedServiceDurationMs`, `totalDurationMs`, `confidence`, `freshness`, plus a `reason` on failure paths (`world_facts_error` | `insufficient_context` | `timeout` | `exception`).

**Never emitted**: access tokens, provider credentials, session data, authorization headers, full roster payloads, full recommendation narratives, raw provider responses. `userId` itself is not included in the payload (only `leagueId`, which is already the scoping key every other slice's telemetry uses); the only identifiers present are the same `leagueId`/`rosterId`/`playerId` values every other Decision OS parity event already logs.

## Failure isolation

- `loadWaiverWorldFacts` failure → caught, `shadow_execution_failure`, telemetry emitted, seam returns normally.
- No roster found → `insufficient_context`, shared service never invoked at all.
- `evaluateWaiverShadow` exception → caught, `shadow_execution_failure` with the real error message.
- `evaluateWaiverShadow` exceeding 4000ms → the seam's own local `withTimeout()` (matching the existing per-provider `Promise.race` pattern already used in `lib/chimmy-context/ChimmyContextEngine.ts` — no new shared timeout utility) rejects, caught as `shadow_execution_failure` with a `"...timed out after 4000ms"` reason.
- Telemetry emission is itself wrapped by `emitDecisionTelemetry`'s own try/catch (pre-existing contract: "telemetry must never break a decision").
- The route wraps the entire seam call in an additional outer `try/catch` as defense-in-depth, even though the seam itself is already guaranteed never to throw.

## Security boundaries

- `rosterId` is **always** resolved server-side via `loadWaiverWorldFacts(userId, leagueId)` — the authenticated `userId` from the session and the already-`assertLeagueMember`-validated `leagueId`. The request body has no `rosterId` field at all, so there is no client-supplied identifier that could be used to point the shared service at an unauthorized roster.
- The seam only runs after `assertLeagueMember` and `requireFeatureEntitlement` have already succeeded — an unauthenticated, non-member, or unentitled request never reaches it.

## Provider handling

`evaluateWaiverShadow`/`WaiverContextAssembler` are provider-neutral by construction (Phase 7) — this seam introduces no provider-specific branching of its own; it only passes `{ leagueId, rosterId }` across the boundary. Tested against both a Sleeper-platform fixture and a non-Sleeper (ESPN) fixture with identical seam behavior.

## Specialty-format handling

Not specially handled by this seam — it inherits whatever real behavior `WaiverContextAssembler`/`evaluateWaiverShadow` already have for specialty formats (Phase 7's own documented gaps, e.g. TE-premium not detected, apply unchanged). No new specialty-format logic was added or claimed.

## Performance behavior

- Bounded by a 4000ms local timeout (`SHADOW_COMPARE_TIMEOUT_MS`), matching the existing per-provider timeout convention used elsewhere in the repo.
- **Deliberately awaited in-request, not fire-and-forget** — this route runs on serverless infrastructure where a promise left running after the handler returns is not reliably completed. The documented latency tradeoff: enabling the flag adds up to 4000ms to the response time in the worst case (shared-service timeout), and typically far less in the success case.
- Never affects the authoritative response regardless of outcome.

## Rollout

1. Flag off by default (current state — nothing enabled anywhere).
2. Automated tests (this phase — see Verification).
3. Local/dev validation (manual, not performed in this sandbox — no dev server exercised this phase since the change is server-side only and already covered by route-contract tests).
4. Internal non-production request validation — **pending**, requires a real non-prod environment.
5. Real imported Sleeper league validation — **pending**, requires real non-prod DB access (consistent with every prior phase's disclosed sandbox limitation).
6. Limited enablement via the existing `DECISION_OS_TEST_LEAGUE_IDS` scope mechanism.
7. Telemetry review.
8. Broader enablement only if failure/latency thresholds are acceptable — no such thresholds have been evaluated yet since no real traffic has run.

## Rollback

Set `SHARED_SERVICES_WAIVER_SHADOW_COMPARE` to anything other than the literal string `"true"` (or unset it). No deploy required if the runtime environment supports live env var updates (matches the existing `DECISION_OS_WAIVER_SHADOW`/`DECISION_OS_WAIVER_LIVE` precedent — if this repo's deployment target requires a redeploy for env var changes, the same caveat applies equally to those pre-existing flags, not something new to this phase). No data repair needed — nothing is persisted outside the shared service's own existing in-memory `WaiverShadowResultStore`.

## Known gaps

- Full ranked-order agreement is not computed (`WaiverEvaluation` doesn't expose a full ranked list, only its top candidate) — a real, disclosed limitation, not a fabricated "unsupported" excuse.
- `financialStatus`/`draftDateUtc` gaps noted in Phase 10's Commissioner work are unrelated to this seam.
- ~~(Phase 13, real, unfixed) Real Sleeper-imported rosters' player IDs are not resolved against AllFantasy's internal player pool~~ — **CLOSED in Phase 14.** `WaiverContextAssembler.ts` now resolves raw provider player ids via the new canonical `lib/shared-services/player-identity` resolver. Re-validated against the same real Sleeper league: 100% player resolution (0/567 unresolved across 21 real requests). See [`FANTASY_OS_PLAYER_IDENTITY.md`](FANTASY_OS_PLAYER_IDENTITY.md). Phase 14 also found that fixing this exposed a separate, pre-existing, real characteristic of this seam: `evaluateWaiverShadow({leagueId, rosterId})` never forwards `currentWeek`/`goal`, so the shadow always evaluates as week-1/balanced — invisible in Phase 13 because broken position data suppressed any week/goal-driven signal, now visible as `acceptable_variance` (never `material_divergence`) for non-default week/goal requests. Documented, not fixed — out of Phase 14's scope.
- Real validation (Phase 13) covered exactly one real Sleeper league, one real roster/manager perspective (21 goal/week permutations), and one non-production database. It has not yet been run across multiple real leagues, multiple real managers within a league, or multiple providers' real data.

## Criteria for considering an authoritative migration (future, not this phase)

Updated after Phase 13's real-data validation — see [`FANTASY_OS_WAIVER_REAL_DATA_VALIDATION.md`](FANTASY_OS_WAIVER_REAL_DATA_VALIDATION.md) for full evidence:
- [x] A first real sample of `shared_services.waiver` shadow_parity telemetry events reviewed — 22 events, 1 real league. **Still needed:** a meaningful sample across *multiple* real leagues/managers before this criterion is fully met.
- [x] `equivalent` rate confirmed at 100% (22/22) for the one real league tested, 0% `material_divergence`, 0% `shadow_execution_failure`, 0% `insufficient_context`, 0% timeout.
- [x] Confirmed acceptable added latency under real (not fixture) traffic: shared-service p95 ≈1.3s, total p95 ≈1.4s, well under the 4000ms bound.
- [ ] Multiple real leagues / real managers / multiple providers — not yet done.
- [ ] The real, disclosed Sleeper-ID player-resolution gap above — not yet closed.
- [ ] A separate, explicit decision — not implied by this phase — that any part of the shared Waiver Service's output should ever become authoritative for a live response.
