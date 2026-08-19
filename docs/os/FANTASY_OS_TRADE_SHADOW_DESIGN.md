# Trade Shadow-Comparison Seam — Future Design (Phase 17)

**Status: specification only. Nothing in this document is implemented. No feature flag exists yet. This design is conditional on the Phase 17 final report's readiness decision — see that report before building any of this.**

## Why this design differs from Waiver's in shape, not in principle

The Waiver shadow-compare pattern (Phase 12) assumes: one live route, one authenticated user, one real owned roster, a structured provider-id input. Phase 17's audit found Trade has none of those preconditions cleanly. This design mirrors Waiver's *principles* (additive, flag-gated, bounded timeout, never alters the response, honest unresolved states) while adapting the *mechanics* to Trade's real shape.

## Recommended target: `/api/trade-value/analyze`, not `/dynasty-trade-analyzer`

Of the three live routes audited, `/trade-value/analyze` is the better first shadow-comparison candidate:
- It already accepts a **structured** asset schema with an optional real `playerId` — directly reusable by the Phase 14 `PlayerIdentityResolver` with no new resolution logic needed for that subset of requests.
- It's already the "compare two sets of assets" shape the existing `lib/shared-services/trade/` service's `sideARosterId`/`sideBRosterId`-optional path could reasonably extend to (asset-list-based rather than strictly roster-pair-based).

`/dynasty-trade-analyzer` remains the harder, lower-confidence target (free-text names, no structured id, unreliable league-settings parsing) — recommended as a **later** phase, only after the name-resolution problem identified in `FANTASY_OS_TRADE_IDENTITY_AUDIT.md` has a real design, not this one.

`/trade-builder/analyze` is excluded from this design — it belongs to Draft OS (Phase 8), already has its own mature deterministic/AI pattern, and evaluates picks, not players.

## Feature flag

`SHARED_SERVICES_TRADE_SHADOW_COMPARE` — read via the same, already-proven `shouldRunShadow(flagEnvVar, env, scope)` helper every other Fantasy OS slice uses (`lib/decision-os/core/shadow/flag.ts`). Default: unset (disabled). Scoped via the same `DECISION_OS_TEST_LEAGUE_IDS`/`DecisionShadowScope` mechanism — no new scoping framework.

## Injection point

Inside `POST /api/trade-value/analyze`, after `runTradeConsoleAnalysis()` returns (mirroring exactly where Waiver's seam sits — after the authoritative call, never before, never altering it):

```
POST /api/trade-value/analyze
  → [existing: rate limit, optional session, Zod validation]
  → const out = await runTradeConsoleAnalysis(payload)     ← AUTHORITATIVE, untouched
  → if (shouldRunSharedTradeShadowCompare(env, {leagueId})) {
      await runSharedTradeShadowCompare({ userId, leagueId, requestAssets: payload.sideGive/sideGet, authoritativeResult: out, authoritativeDurationMs })
        (bounded timeout, caught, never throws past this call)
    }
  → return NextResponse.json(out)                          ← unchanged regardless of the above
```

## Comparison payload (identity + request context, mirroring the Waiver boundary discipline)

Only these cross the seam boundary — no provider objects, no full asset valuations, no raw request body:

- `leagueId` (identity, optional — many real requests won't have one, matching the route's own optionality)
- `userId` (identity, for future roster-ownership resolution if `leagueId` is present — not required for a leagueId-less request)
- The asset list **shape only**: for each asset, `{ kind, playerId? }` (never the free-text `name`, which could carry PII-adjacent user-typed content not otherwise persisted) — mirroring Waiver's `{leagueId, rosterId}`-only discipline
- `strategy`/`teamContext` (request context, cannot be reconstructed — the Trade analog of Waiver's `goal`)

**Never forwarded**: full valuations, manager tendency data, AI consensus text, raw request body.

## Timeout strategy

Reuse the exact `withTimeout()`/`Promise.race` pattern from `lib/decision-os/waiver/sharedServiceShadowCompare.ts` — no new timeout utility. Given Trade's valuation pipeline (FantasyCalc + ADP + VORP + analytics, more data sources than Waiver's single free-agent-pool fetch) is likely to be slower, the bound should be measured empirically before being set — **do not copy Waiver's 4000ms without first measuring `runSharedTradeShadowCompare`'s real p95 in a non-production environment**, per this effort's explicit "do not change a timeout without evidence" discipline (extended here to "do not set one without evidence" for a brand-new seam).

## Telemetry

Reuse `emitShadowParity('shared_services.trade', {...})` — the same `decision.shadow_parity` event every slice already emits. No second telemetry system. Fields to include, informed directly by the Context Fidelity Matrix: `comparisonVersion`, `identityResolutionStatus` (per-asset: direct/name_match/unresolved — expect this to be meaningfully non-100% for any free-text-adjacent input, and to report it honestly rather than only shipping this seam for the always-100%-resolvable structured-`playerId` subset), `valuationDeltaDistribution`, `authoritativeDurationMs`, `sharedServiceDurationMs`, `totalDurationMs`.

## Comparison semantics (new statuses needed, beyond Waiver's 7)

Waiver's 7 statuses (`exact_match`/`equivalent`/`acceptable_variance`/`material_divergence`/`unsupported_comparison`/`insufficient_context`/`shadow_execution_failure`) apply directly to the *valuation* comparison once both sides have resolved the same assets. Trade needs one additional real state Waiver never had: **`identity_unresolvable`** — when the shared service cannot confidently resolve one or more assets to a canonical player at all (a real, expected, non-error outcome for any name-only input), distinct from `insufficient_context` (which in Waiver's vocabulary means "no roster could be resolved," a different failure mode). Never silently coerced into a false match.

## Rollback

One flag, same as Waiver — `SHARED_SERVICES_TRADE_SHADOW_COMPARE` unset stops everything. No data repair needed (in-memory result store only, mirroring `WaiverShadowResultStore`'s pattern). No new infrastructure to roll back.

## Failure isolation

Identical posture to Waiver: the seam's own internal try/catch guarantees it never throws; the route's outer try/catch is defense-in-depth only; a shared-service failure, timeout, or unresolved identity never alters the authoritative response.

## Authorization order

Unchanged from the route's existing order (rate-limit → optional session → Zod validation → authoritative analysis) — the shadow seam runs strictly after the authoritative response is computed, exactly like Waiver's placement, and never gates or delays the response beyond its own bounded timeout.

## Response fidelity guarantee

Byte-identical to today's response in every case — the shadow seam is purely additive and asynchronous-but-awaited (same serverless-safety reasoning as Waiver's Phase 12 correction: fire-and-forget is not reliable on this infrastructure, so it must be awaited with a bound, accepting the latency tradeoff).

## What this design explicitly does not attempt

- Does not propose a design for `/dynasty-trade-analyzer` (free-text names) — flagged as a harder, separate problem requiring its own identity-resolution design first.
- Does not propose changing `lib/shared-services/trade/`'s existing `sideARosterId`/`sideBRosterId` roster-pair contract — that capability remains valid for a genuinely different future use case (a real roster-to-roster proposed trade flow, which doesn't exist as a live route today) and should not be conflated with this design's asset-list-based approach.
- Does not implement anything in this phase.
