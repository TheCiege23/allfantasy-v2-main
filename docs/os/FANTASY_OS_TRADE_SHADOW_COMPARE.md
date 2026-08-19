# Trade Value Console — Shadow Compare (Phase 18)

**Status: implemented, additive, off by default. First real Trade consumer migration. Real-data validated against `.env.test` — Phase 18: 8 requests, 100% equivalent. Phase 19: 30 events across a deliberately diverse matrix found and fixed a real multi-sport identity gap.**

**Phase 19 update:** expanded real validation found the canonical `PlayerIdentityMap` is 100% NFL-only, causing every real non-NFL asset (NBA/MLB/NHL/NCAAF/Soccer — all genuinely supported by this route) to report `identity_unresolvable` even though `SportsPlayer` has substantial real data for all of them. Fixed with a narrow, additive fallback (`resolveViaSportsPlayerName`, scoped entirely to `TradeValueConsoleShadowService.ts`) and a new, honestly-distinct status, `identity_name_match_multisport_fallback`. Confirmed via real before/after data: 4/4 multi-sport requests went from `identity_unresolvable` to `equivalent`. See [`FANTASY_OS_TRADE_EXPANDED_REAL_VALIDATION.md`](FANTASY_OS_TRADE_EXPANDED_REAL_VALIDATION.md) for full evidence, including a real, significant, **out-of-scope** performance finding (an unrecognized `playerId` can stall the authoritative engine for 170+ seconds via a synchronous data-refresh call in `lib/data/players.ts`, unrelated to this migration) — the shadow seam's own latency stayed at ~1ms throughout, proving its isolation design holds even when the authoritative path performs catastrophically badly.

This document covers the concrete implementation of the migration candidate selected in [`FANTASY_OS_TRADE_SHADOW_DESIGN.md`](FANTASY_OS_TRADE_SHADOW_DESIGN.md).

## Scope, narrowed from the design doc's aspiration — a real finding from re-auditing before writing code

Task 1's mandatory re-audit (not relying on Phase 17's design alone) found the route's `playerId` field is a `SportsPlayerRecord.id` — confirmed by reading `lib/data/players.ts`'s `getPlayer()` (`prisma.sportsPlayerRecord.findUnique`) — a different internal id space from the Phase 14 canonical resolver's `PlayerIdentityMap`/`SportsPlayer` tables. And the existing `lib/shared-services/trade/TradeShadowService.ts` requires real roster ids this route never supplies (sport-wide asset comparison, no rosters). Both findings narrow this phase's honest scope to an **identity + secondary value cross-check**, not a full fairness-score shadow — documented here plainly rather than silently building a comparison that doesn't hold up.

## Current architecture (unchanged, authoritative)

```
POST /api/trade-value/analyze
  → rate limit (20/min per IP)
  → optional session (userId may be null — this route does not require auth)
  → Zod validation
  → runTradeConsoleAnalysis(payload)             ← AUTHORITATIVE, untouched
  → response: TradeConsoleAnalyzeResult | TradeConsoleAnalyzeError
```

## Implemented architecture (additive)

```
  → [everything above, byte-for-byte unchanged]
  → if out.ok AND shouldRunSharedTradeShadowCompare(env, {leagueId}):
      → extract real player asset lines (pricedSource IN ('fantasycalc','sports_db')) from out.players.give/get
        (picks/FAAB lines are excluded — no player identity to resolve)
      → await runSharedTradeValueShadowCompare({ leagueId, assets, authoritativeDurationMs })
          → evaluateTradeValueConsoleShadow(assets)   ← lib/shared-services/trade/TradeValueConsoleShadowService.ts
              → for each asset: find its FantasyCalc identity (same source the authoritative
                engine already uses) to get a real cross-provider id (sleeperId/espnId/mflId/
                fleaflickerId) when present, then resolvePlayer() against the canonical resolver
              → classify: identity_direct / identity_name_match / identity_ambiguous / identity_unresolvable
              → secondary: value delta vs. the authoritative marketValue (derived signal, not primary)
          → emitShadowParity('shared_services.trade', {...})
      → (caught defensively; the seam itself never throws)
  → response: [identical to above — the seam never touches it]
```

## Feature flag

`SHARED_SERVICES_TRADE_SHADOW_COMPARE` — read via the existing `shouldRunShadow(flagEnvVar, env, scope)` helper, same mechanism every Decision OS slice uses. **Default: unset (disabled).** Scoped via the existing `DecisionShadowScope`/`getDecisionShadowScopeFilters()` (`DECISION_OS_TEST_LEAGUE_IDS`) — since this route's `leagueId` is optional, requests with no `leagueId` run the shadow whenever no scope restriction is configured at all (matching `matchesDecisionShadowScope`'s existing, unmodified behavior), and are correctly excluded once a league-id scope filter is configured.

## Identity resolution — what "identity_unresolvable" really means here

Confirmed via a real validation run: the AUTHORITATIVE engine itself drops any asset it cannot resolve (`unresolved.push(...); continue` in `runTradeConsoleAnalysis.ts`) — meaning **this seam only ever sees assets the authoritative engine has already successfully resolved**. `identity_unresolvable`/`identity_ambiguous` therefore measure something specific and real: *does the canonical PlayerIdentityMap-based resolver also recognize a player the console's own SportsPlayerRecord-based pipeline already confirmed* — not "can we do better than the console at resolving ambiguous free text." This is a real, disclosed scope boundary, not a limitation hidden from the telemetry's consumers.

## Timeout rationale (measured, not copied from Waiver)

A 12-run local benchmark against `.env.test` (real FantasyCalc API + real `PlayerIdentityMap`/`SportsPlayer` DB queries) found:

| | Value |
|---|---|
| Cold run (first FantasyCalc fetch, uncached) | 2,539ms |
| Warm runs (cached FantasyCalc, DB-only resolution) | 0–231ms |
| Warm p50 | 20ms |

The bottleneck is entirely the external FantasyCalc HTTP call, which only happens once per warm process. Since this seam may run cold on each fresh serverless invocation (module-level caches aren't guaranteed to persist across invocations), the timeout was set to **6,000ms** — roughly 2.4x the one observed real cold-start sample, to absorb realistic network variance — not Waiver's 4,000ms copied without evidence, and not an arbitrary round number.

## Telemetry

`emitShadowParity('shared_services.trade', flags)` — the same pre-existing `decision.shadow_parity` wrapper every slice uses. No new sink.

Fields: `compare: true`, `ran`, `status`, `leagueId`, `route: 'trade-value-console'`, `assetCount`, `resolvedCount`, `unresolvedCount`, `authoritativeDurationMs`, `sharedServiceDurationMs`, `totalDurationMs`, `comparisonVersion: 'phase18-trade-value-console'`, plus a `reason` on failure/empty paths (`no_player_assets` | `timeout` | `exception`).

**Never emitted**: raw player/asset names, access tokens, provider credentials, session data, full valuations — only counts and aggregate status, confirmed via a real test asserting the raw asset name string never appears in the telemetry payload.

## Failure isolation

- Zero player assets → `unsupported`, shared service never invoked, telemetry still emitted with `comparisonVersion` stamped.
- `evaluateTradeValueConsoleShadow` exception → caught, `shadow_execution_failure` with the real error message.
- Exceeding 6,000ms → the seam's own local `withTimeout()` (same `Promise.race` pattern as Waiver's seam) rejects, caught as `shadow_execution_failure`.
- The route wraps the entire seam call in an outer `try/catch` as defense-in-depth, even though the seam itself is already guaranteed never to throw.

## Security boundaries

- This route requires no authentication and no league membership by design (a sport-wide value calculator, not a real-roster transaction tool) — the shadow seam inherits exactly the same posture, adding no new authorization surface.
- No roster id, user id, or provider credential crosses into the shadow seam — only asset name/position/team (already present in the authoritative response) and an optional `leagueId` for scoping.

## Provider handling

`resolvePlayer()` is called with a real cross-provider id (sleeperId/espnId/mflId/fleaflickerId) whenever FantasyCalc's own embedded identity carries one for the matched player — real, not fabricated (`FantasyCalcPlayerIdentity` genuinely stores these fields). When none is available, resolution falls back to the resolver's existing name-match path (`sourceId` omitted) — a real, already-tested code path from Phase 14, not new logic invented for this route.

## Real-data validation summary

8 real requests against `.env.test` (no authentication needed — this route doesn't require a session): 7 exercised the shadow seam (assets present), 1 correctly skipped (`no_player_assets` — a pick+FAAB-only request). **7/7 (100%) `equivalent`**, 13/13 real player assets resolved, 0 `identity_unresolvable`, 0 `shadow_execution_failure`, 0 timeouts. Shared-service latency: p50 73ms, p95 533ms — well under the 6,000ms bound. See [`FANTASY_OS_TRADE_REAL_VALIDATION.md`](FANTASY_OS_TRADE_REAL_VALIDATION.md) for the full record.

## Rollback

Set `SHARED_SERVICES_TRADE_SHADOW_COMPARE` to anything other than `"true"` (or unset it) — proven via a real restart-and-retest in this phase: the same request that previously produced shadow telemetry produced an identical response and zero telemetry once the flag was unset. No data repair needed — nothing is persisted; the shared service holds no result store of its own.

## Known gaps / remaining limitations

- Full fairness-score/recommendation shadow comparison is **not implemented** — see the Scope section above for why, and `FANTASY_OS_TRADE_SHADOW_DESIGN.md` for what a future, larger phase would need to build it honestly.
- ~~`identity_unresolvable`/`identity_ambiguous` did not occur in the real validation sample~~ — **closed in Phase 19.** A larger, deliberately diverse real sample found and fixed a real multi-sport identity gap (see the Phase 19 update above). `identity_unresolvable` now occurs, honestly, only for genuinely fake/unresolvable names and NCAAB (the one sport with zero real rows in this environment).
- Only one real, non-production environment was used; no second provider or league diversity was attempted (this route doesn't have a provider or league concept in the same sense Waiver did, so that axis doesn't directly apply here).
- **New (Phase 19), out of this migration's scope**: an unrecognized `playerId` can cause the *authoritative* engine to stall for 170+ seconds (`lib/data/players.ts`'s synchronous `runSportsDataImporter` call on cache miss) — disclosed, not fixed, since it's unrelated to anything this migration built.
- The flagship `/dynasty-trade-analyzer` route remains entirely untouched and unaddressed.
