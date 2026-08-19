# G17: Waiver Canonical Convergence Plan

**Branch:** g15-event-foundation
**Date:** 2026-06-30
**ADR:** `ADR_G17_CANONICAL_CONVERGENCE.md`
**Audit baseline:** `G16_CORE_WAIVER_ENGINE_AUDIT.md`
**Readiness held:** NFL Engine 93% / Overall Platform 90%

No routes were changed. No production data was mutated. No cutover was performed.
Decision OS Stage 1 soak (`DECISION_OS_COMMISSIONER_HEALTH_LIVE=true`) is not disrupted.

---

## 1. Migration Matrix

Three sub-systems must converge onto the canonical `lib/waiver-wire` engine. Each row defines the source state, target state, migration approach, and specialty requirements that must be preserved.

### 1.1 Redraft (highest priority — largest duplicate)

| Dimension | Today | After convergence |
|---|---|---|
| Claim model | `RedraftWaiverClaim` | `WaiverClaim` |
| Roster mutation | `RedraftRosterPlayer` (add row / set droppedAt) | `Roster.playerData` (JSON, same as canonical leagues) |
| FAAB balance | `RedraftRoster.faabBalance` | `Roster.faabRemaining` |
| Transaction record | `RedraftLeagueTransaction` | `WaiverTransaction` + `WaiverResult` |
| Processing | `lib/redraft/waiverEngine.ts::processWaiverWindow` | `lib/waiver-wire/process-engine.ts::processWaiverClaimsForLeague` |
| Settings source | Implicit (sport/season defaults) | `LeagueWaiverSettings` row per league |
| Audit lock | None | `LeagueWaiverState.processingLocked` |
| Cron path | `app/api/redraft/waiver-process/route.ts` | `app/api/cron/waivers/route.ts` |
| IDP cap post-hook | `finalizeRedraftWaiverClaimIdpCap` (called after settlement) | Registered as `afterSettleClaim` plugin hook |
| Player metadata | `resolvePlayerMeta` (SportsPlayer + PlayerIdentityMap join) | Same join; must be preserved as WaiverPlugin or pre-enrichment step |

**Specialty requirements to preserve:**
- `finalizeRedraftWaiverClaimIdpCap` — must be called after canonical settlement for IDP-capable Redraft leagues.
- `moveApprovedRosterToBack` — already in canonical processor as rolling-priority update; confirm equivalence before retiring.
- `resetWaiverPriority` (offseason reset) — must be wired to canonical `LeagueWaiverState` after migration.
- Player metadata resolution (`resolvePlayerMeta`) — must not be lost when `RedraftWaiverClaim.addPlayerName` is deprecated; canonical `WaiverClaim` only stores `addPlayerId`.
- Platform events (`EVENT.WAIVER_PROCESSED`, `EVENT.WAIVER_WINDOW_PROCESSED`) — emitted post-commit; must be emitted from canonical `run-hooks` for Redraft leagues.

### 1.2 Dynasty (already canonical — enhancements only)

Dynasty leagues already use the canonical `WaiverClaim` path. No migration needed for claim creation or processing.

| Dimension | Gap | Resolution |
|---|---|---|
| Keeper eligibility guard | No `afterSettleClaim` hook to mark waiver-acquired players as keeper-eligible (with keeper cost) | Add keeper-eligibility plugin hook when keeper/dynasty plugin interface is formalized |
| Devy claim transition | Devy-eligible players claimed via waiver do not automatically transition when graduated | `validateDevyWaiverClaim` guard exists; graduation transition requires a separate Dynasty lifecycle event, not a waiver-engine change |
| Roster legality for DYNASTY_IDP | `validateRoster('NFL', ..., 'DYNASTY_IDP')` uses slot name `IDP` but the documented slot name is `IDP_FLEX` — waiver eligibility checks may reject valid IDP claim contexts | See Test Plan §4.2: rename `IDP` → `IDP_FLEX` in `SportDefaultsRegistry.getRosterDefaults` |
| Process-time legality recheck | Canonical processor does not fully re-run projected roster legality at settlement (G16 gap §9 Medium) | Out of scope for G17; tracked in G16 gap table |

### 1.3 Guillotine (specialty bridge — highest complexity)

The `GuillotineWaiverRelease` model has its own lifecycle that does not map 1:1 to `WaiverClaim`. The bridge approach below preserves Guillotine specialty behavior while producing canonical audit records.

| Dimension | Today | After bridge |
|---|---|---|
| Claim initiation | Automatic: eliminated roster's players queued as `GuillotineWaiverRelease` rows with `releaseStatus='pending'` | Same: no change to how releases are created |
| Availability gate | `availableAt` timestamp gates when the release becomes claimable | Same: Guillotine UI continues to use `availableAt`; bridge does not change the gate |
| Bid type | `Float` (decimal FAAB) | Rounded to `Int` for canonical `WaiverClaim.faabBid`; original Float stored in `GuillotineWaiverRelease.winningBid` as audit trail |
| Settlement | Self-contained in Guillotine concept; sets `releaseStatus='claimed'`, `claimedByRosterId`, `claimedAt` | Bridge emits a canonical `WaiverRun` + `WaiverResult` + `WaiverTransaction` AFTER Guillotine settlement completes (post-commit, non-blocking); these records are audit-only and do not re-drive roster mutation |
| Roster mutation | Guillotine-specific (add player to claiming roster via its own path) | Unchanged; roster mutation stays in Guillotine concept |
| FAAB deduction | Not recorded in `WaiverTransaction.faabSpent` today | Bridge emits `WaiverTransaction` with `faabSpent = Math.floor(winningBid)` (rounded down) and `source='guillotine_release'` |
| History | Not visible in canonical waiver history feed | Visible after bridge emits canonical records |

**Guillotine bridge phases (Phase G):**
- **G.1** — Define `GuillotineWaiverBridgeRecord` shape: which canonical fields are emitted, what `metadata` carries to indicate the record originated from a Guillotine release.
- **G.2** — Implement `emitGuillotineCanonicalAudit(leagueId, release)` as a best-effort post-commit function (never throws, logs on failure). Called from Guillotine settlement after `releaseStatus='claimed'` is committed.
- **G.3** — Parity test: verify that audit records produced by the bridge match the Guillotine release records.
- **G.4** — Route convergence: Guillotine claim browsing uses `getPlayerPoolForLeague` rather than its own player list.

**Pre-requisite for Phase G:** Redraft convergence (Phase R) must be stable and soaking before Guillotine bridge work begins.

---

## 2. Route-by-Route Replacement Plan

### 2.1 Canonical waiver routes — no change to route signature

These routes already use canonical tables and services. No migration needed for route shape. Internal service improvements (process-time revalidation, notification idempotency) are separate G16 gap items.

| Route | Status | Action |
|---|---|---|
| `app/api/waiver-wire/leagues/[leagueId]/claims` GET/POST | Canonical | No change |
| `app/api/waiver-wire/leagues/[leagueId]/claims/[claimId]` PATCH/DELETE | Canonical | No change |
| `app/api/waiver-wire/leagues/[leagueId]/add-drop` POST | Canonical | No change |
| `app/api/waiver-wire/leagues/[leagueId]/eligibility` POST | Canonical | No change |
| `app/api/waiver-wire/leagues/[leagueId]/settings` GET/PATCH | Canonical | No change |
| `app/api/waiver-wire/leagues/[leagueId]/state` GET | Canonical (mixes RedraftRoster for FAAB — see Phase R.3) | Fix in Phase R.3 |
| `app/api/waiver-wire/leagues/[leagueId]/runs` GET | Canonical | No change |
| `app/api/waiver-wire/leagues/[leagueId]/process` POST | Canonical | No change |
| `app/api/waiver-wire/leagues/[leagueId]/watchlist` GET/POST/DELETE | Canonical | No change |
| `app/api/commissioner/leagues/[leagueId]/waivers` | Canonical | No change |
| `app/api/commissioner/leagues/[leagueId]/waiver-claims/[claimId]` | Canonical | No change |
| `app/api/cron/waivers` | Canonical | No change |

### 2.2 Canonical player-browse route — HIGH SEVERITY fix required

**Route:** `app/api/waiver-wire/leagues/[leagueId]/players/route.ts`

**Current behavior:** Calls `prisma.redraftRosterPlayer.findMany` to get rostered player IDs and `prisma.sportsPlayer.findMany` to get available players. Hardcoded position-exclusion list, ADP-to-points projection logic, and rookie detection. No sport-mismatch guard.

**Required behavior (per test contract):**

```
Phase R.0 (fix, prerequisite for all Phase R work):
1. Read the requesting user's roster via `prisma.roster.findFirst` (existing call — keep).
2. Collect all rostered player IDs across the league using `getRosterPlayerIds` from
   `lib/waiver-wire/roster-utils` (replace the redraftRosterPlayer.findMany call).
3. Resolve available players using `getPlayerPoolForLeague(leagueId, sport, { limit, position, teamId })`
   from `lib/sport-teams/SportPlayerPoolResolver`.
4. Filter pool: remove entries whose `external_source_id` is in the rostered IDs set.
5. Add sport-mismatch guard: if `?sport=` query param is present and does not match
   `league.sport`, return 400 `{ error: "Sport mismatch: ..." }` before any pool call.
6. Return `{ players: [...], rosteredCount: N }`.
```

**Tests unblocked by this fix:** Both failing tests in `waiver-wire-player-route-pool-resolver.test.ts`.

**Risk:** Low. The rewrite is additive — the route currently throws 500 on the test mock paths anyway, so any live traffic using this route relies on the Redraft-table path. Phase R.0 requires a parity check to confirm that `getPlayerPoolForLeague` returns equivalent or better results before the flag is enabled.

**Feature flag:** `WAIVER_PLAYER_BROWSE_CANONICAL=true` — enables the canonical pool resolver path. False = legacy Redraft path (current behavior). Default false until parity confirmed.

### 2.3 Redraft claim creation route — Phase R.1

**Route:** `app/api/redraft/waivers/route.ts` (POST creates `RedraftWaiverClaim`, DELETE cancels)

**Migration phases:**

| Phase | Flag | Behavior |
|---|---|---|
| R.1 Shadow | `REDRAFT_WAIVER_SHADOW=true` | POST writes `RedraftWaiverClaim` (primary) + `WaiverClaim` (shadow, status='pending'). DELETE cancels both. |
| R.2 Canonical primary | `REDRAFT_WAIVER_CANONICAL=true` | POST writes `WaiverClaim` (primary). `RedraftWaiverClaim` write is a best-effort compatibility copy. |
| R.3 Route convergence | `REDRAFT_WAIVER_ROUTE_CONVERGENCE=true` | Redraft UI routes all waiver creates/cancels/edits through `app/api/waiver-wire/leagues/[leagueId]/claims`. Legacy routes return 301. |
| R.4 Table retirement | After 30-day soak | `RedraftWaiverClaim` table dropped. Routes deleted. |

**Parity gate for R.1 → R.2 transition:** Shadow parity script must show zero divergence between canonical and Redraft processing outcomes on 5 consecutive processing runs. See §5 Risk Plan.

### 2.4 Redraft processing route — Phase R.2

**Route:** `app/api/redraft/waiver-process/route.ts`

**Current behavior:** Discovers active `RedraftSeason` rows, calls `processWaiverWindow(leagueId, seasonId)` for each.

**Migration phases:**

| Phase | Flag | Behavior |
|---|---|---|
| R.2 Canonical primary | `REDRAFT_WAIVER_CANONICAL=true` (same flag as §2.3) | Processing route calls `processLeagueWaiversJob({ leagueId, trigger: 'redraft_manual' })` for each active season. Redraft-specific post-hooks (IDP cap, platform events) registered as plugin hooks before this flag is enabled. |
| R.3 Cron convergence | `REDRAFT_WAIVER_CRON_CONVERGENCE=true` | `app/api/cron/waivers` discovers Redraft league seasons via `discoverDueWaiverLeagues`. The dedicated `app/api/redraft/waiver-process` route is retired. |
| R.4 | Same 30-day soak | Route deleted. |

### 2.5 State route — mixed Redraft/canonical FAAB read

**Route:** `app/api/waiver-wire/leagues/[leagueId]/state/route.ts`

**Current behavior:** Reads `redraftRoster` for FAAB balance and priority in a route that is supposed to be canonical-only.

**Fix (Phase R.3):** Replace `redraftRoster` read with `Roster.faabRemaining` + `Roster.waiverPriority` (canonical fields). After Redraft FAAB balance migrates to `Roster.faabRemaining` in Phase R.2, this read is already correct for canonical leagues; adding a league-type guard makes it explicit.

### 2.6 Legacy `app/waiver-wire/*` routes

**Routes:** `app/waiver-wire/claim/route.ts`, `app/waiver-wire/claims/route.ts`

These are path-level legacy routes (not under `app/api/`). They reference Redraft waiver tables.

**Migration:** Gate on `REDRAFT_WAIVER_ROUTE_CONVERGENCE` flag (Phase R.3). Return 301 to canonical endpoints. Delete in Phase R.4.

---

## 3. Plugin Hook Formalization (prerequisite for Phases R.2 and G.2)

Before the canonical processor handles Redraft leagues, the specialty hooks currently embedded as direct imports must be wrapped in `WaiverPluginHooks`. This is a code-safety prerequisite, not a behavior change.

### 3.1 Target interface

```typescript
// lib/waiver-wire/plugin-hooks.ts (new)
export interface WaiverPluginContext {
  leagueId: string
  rosterId: string
  claim: { addPlayerId: string; dropPlayerId: string | null; faabBid: number | null }
  settings: EffectiveLeagueWaiverSettings
  specialtyConceptKey: string | null
}

export interface WaiverPluginHooks {
  canSubmitClaim(ctx: WaiverPluginContext): Promise<{ allow: boolean; reason?: string }>
  canEditClaim(ctx: WaiverPluginContext): Promise<{ allow: boolean; reason?: string }>
  canProcessClaim(ctx: WaiverPluginContext): Promise<{ allow: boolean; reason?: string }>
  resolveClaimPriorityInput?(ctx: WaiverPluginContext): Promise<Record<string, unknown>>
  beforeSettleClaim?(ctx: WaiverPluginContext): Promise<{ allow: boolean; patch?: Partial<WaiverPluginContext['claim']> }>
  afterSettleClaim?(ctx: WaiverPluginContext & { result: 'awarded' | 'denied' }): Promise<void>
  releaseRosterToWaivers?(ctx: { leagueId: string; rosterId: string; scoringPeriod: number }): Promise<void>
}
```

### 3.2 Specialty → hook mapping

| Current direct import / guard | Wraps as hook method |
|---|---|
| `isRosterChopped` (Guillotine) | `canSubmitClaim` |
| `isRosterCurrentlyEliminated` (Survivor) | `canSubmitClaim` |
| `isWaiverFrozenForRoster` (Survivor idol power) | `canSubmitClaim` |
| `validateDevyWaiverClaim` (Devy) | `canSubmitClaim` |
| `getSpecialtySpecByVariant(...).rosterGuard` (Guillotine/Survivor/Zombie/Big Brother) | `canProcessClaim` |
| `finalizeRedraftWaiverClaimIdpCap` (Redraft IDP) | `afterSettleClaim` |
| Guillotine release logic | `releaseRosterToWaivers` |

All existing guards remain in place as the initial hook implementations. No behavior change at formalization time.

---

## 4. Test Plan for Failing Waiver Suites

### 4.1 `waiver-wire-player-route-pool-resolver.test.ts` (2 failing tests)

**Root cause:** `app/api/waiver-wire/leagues/[leagueId]/players/route.ts` calls `prisma.redraftRosterPlayer.findMany` (not mocked in test) and `prisma.sportsPlayer.findMany` (mock is `sportsPlayerRecord.findMany`). Both calls fail → caught by the route's catch block → 500. The sport-mismatch guard does not exist → 500 instead of expected 400.

**What the test requires from the route:**
1. `getRosterPlayerIds` from `@/lib/waiver-wire/roster-utils` (mocked).
2. `getPlayerPoolForLeague` from `@/lib/sport-teams/SportPlayerPoolResolver` (mocked).
3. Sport-mismatch guard: `?sport=SOCCER` on an NFL league returns `400 { error: "Sport mismatch: ..." }`.
4. Filter: players whose `external_source_id` is in the rostered IDs set are excluded.
5. Response shape: `{ players: [...], rosteredCount: N }`.

**Fix scope:** `app/api/waiver-wire/leagues/[leagueId]/players/route.ts` only. No schema change.

**Implementation steps (Phase R.0):**
1. Remove all `prisma.redraftRosterPlayer.findMany` calls from the route.
2. Remove the `prisma.sportsPlayer.findMany` + ADP-projection + rookie-detection inline logic.
3. Add sport-mismatch guard early: `if (querySport && querySport !== league.sport) return 400`.
4. Call `getRosterPlayerIds(leagueId)` from `lib/waiver-wire/roster-utils` to get all rostered IDs.
5. Call `getPlayerPoolForLeague(leagueId, league.sport, { limit: 800, position, teamId })`.
6. Filter pool: exclude entries where `external_source_id` is in the rostered set.
7. Map and return `{ players, rosteredCount }`.

**Guard flag:** `WAIVER_PLAYER_BROWSE_CANONICAL=true`. Default off until parity against legacy behavior is confirmed via manual spot check on staging.

**Estimated impact:** Fixes 2/2 failing tests in this suite with no risk to other passing suites (the shared pool resolver and roster-utils are already mocked cleanly).

### 4.2 `league-roster-validation-context.test.ts` (1 failing test)

**Root cause:** `lib/sport-defaults/SportDefaultsRegistry.ts` `getRosterDefaults` function builds the NFL IDP overlay with `starter_slots['IDP'] = 1` and `flex_definitions: [{ slotName: 'IDP', allowedPositions: [...] }]`. The test assigns players to slot name `IDP_FLEX`. The `RosterValidationEngine.validateRoster` calls `getRosterTemplateDefinition('NFL', 'DYNASTY_IDP')` → the knownSlots set contains `IDP` but not `IDP_FLEX` → "Unknown slot: IDP_FLEX" error → `valid: false` instead of expected `true`.

**Evidence from code:**
- `RosterDefaultsRegistry.ts` comment (line 8): *"NFL IDP: offensive slots ... + DE, DT, LB, CB, S, **DL, DB, IDP_FLEX**, BENCH, IR."*
- `RosterDefaultsRegistry.ts` line 23 and 35: `IDP_FLEX` listed in the flex slot name array (not `IDP`).
- `SportDefaultsRegistry.ts` lines 583–590: creates `starter_slots['IDP'] = 1` and `slotName: 'IDP'` in flex_definitions.

The documented slot name is `IDP_FLEX`. The code creates `IDP`. This is a naming bug in the registry, not in the test.

**Fix scope:** `lib/sport-defaults/SportDefaultsRegistry.ts` only — 2 lines changed. No route change, no schema change.

**Exact change:**
```typescript
// Before (lines 583–590 in SportDefaultsRegistry.ts):
starter_slots['IDP'] = 1
// ...
{ slotName: 'IDP', allowedPositions: ['DE', 'DT', 'DL', 'LB', 'ILB', 'OLB', 'CB', 'S', 'DB'] },

// After:
starter_slots['IDP_FLEX'] = 1
// ...
{ slotName: 'IDP_FLEX', allowedPositions: ['DE', 'DT', 'DL', 'LB', 'ILB', 'OLB', 'CB', 'S', 'DB'] },
```

**Regression check:** After this change, any call that assigns a player to `IDP` slot in a `DYNASTY_IDP`/`IDP`-format league will fail validation (because `IDP` slot no longer exists in the template). Affected paths:
- Any Prisma query that populates `Roster.playerData` with `slotName: 'IDP'` for IDP leagues → would produce a validation error on waiver eligibility check.
- Any UI that assigns to `IDP` slot name → would be rejected by eligibility.

**Required regression audit before implementing:** grep for `slotName.*IDP[^_]` and `'IDP'` in any roster mutation or draft pick creation code that operates under `DYNASTY_IDP` or `IDP` format leagues. If no callsites use `'IDP'` as a slot name (likely — this is a template definition, not a stored value), the rename is safe.

**Estimated impact:** Fixes 1/1 failing test in this suite; fixes waiver eligibility for Dynasty IDP leagues that reach the `evaluateLegalityForProjectedRoster` path.

### 4.3 Full focused suite after both fixes

Expected result:
```
Test Files  0 failed | 23 passed (23)
Tests       0 failed | 117 passed (117)
```

Run command:
```sh
npx vitest run \
  __tests__/waiver-settings-service.test.ts \
  __tests__/waiver-defaults-by-sport.test.ts \
  __tests__/waiver-automation.test.ts \
  __tests__/waiver-claims-route-scope.test.ts \
  __tests__/waiver-wire-player-route-pool-resolver.test.ts \
  __tests__/waiver-ai-engine-route-contract.test.ts \
  __tests__/waiver-ai-service.test.ts \
  __tests__/waiver-ai-gating.test.ts \
  __tests__/redraft/waiver-scoring.test.ts \
  __tests__/redraft/waiver-watchlist-service.test.ts \
  __tests__/redraft/waiver-add-drop-ux.test.tsx \
  __tests__/redraft/add-drop-errors.test.ts \
  __tests__/redraft/players-waivers-deep-build.test.tsx \
  __tests__/league-roster-validation-context.test.ts \
  __tests__/roster-engine-validation.test.ts \
  __tests__/roster-lineup-engine-validation.test.ts \
  __tests__/commissioner-settings-route.test.ts \
  __tests__/league-ai-settings-resolver.test.ts \
  __tests__/decision-os/waiver-loader.test.ts \
  __tests__/decision-os/waiver-shadow.test.ts \
  __tests__/decision-os/waiver-architecture.test.ts \
  __tests__/decision-os/waiver-decision.test.ts \
  __tests__/decision-os/waiver-rules.test.ts
```

---

## 5. Risk and Rollback Plan

### 5.1 Risk matrix

| Phase | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R.0 (player browse) | `getPlayerPoolForLeague` returns different player set than Redraft direct query — managers see missing or extra players | Medium | Low (browse only, no mutation) | Feature flag off by default; staging spot-check before enabling |
| R.1 (shadow write) | Dual-write failure leaves `WaiverClaim` shadow in stale state when `RedraftWaiverClaim` commit succeeds | Low | Low (shadow only, no settlement from canonical in this phase) | Wrap canonical shadow write in try/catch; log; never let it block the primary write |
| R.1 (shadow write) | Parity mismatch: canonical processor would award claim A but Redraft processor awards claim B (ordering differs) | Medium | High (reveals engine divergence before it matters) | This is the desired discovery signal; parity script flags it; investigation gate before R.2 |
| R.2 (canonical primary) | `processWaiverClaimsForLeague` applies different claim ordering than `processWaiverWindow` for a mixed FAAB+priority league | Low | High (affects real rosters) | 5-consecutive-run parity gate required before enabling flag; manual review of ordering logic delta |
| R.2 (canonical primary) | IDP cap hook (`afterSettleClaim`) not registered before flag enabled → IDP cap salary not assigned after Redraft waiver award | Medium | Medium (missing salary assignment, recoverable) | Formal pre-flight checklist: hook registration verified before `REDRAFT_WAIVER_CANONICAL` is enabled |
| R.3 (route convergence) | Redraft UI still posts to old routes after convergence; requests silently fail or double-write | Low | High | Route audit: enumerate all Redraft waiver UI components and confirm endpoint update |
| R.4 (table retirement) | A background job or report query still references `RedraftWaiverClaim` after table drop | Low | High | Full grep for `RedraftWaiverClaim` + `redraftWaiverClaim` across all routes, scripts, and report queries before retirement |
| G.2 (Guillotine bridge) | `emitGuillotineCanonicalAudit` throws synchronously and blocks Guillotine settlement | Very low | High (settlement blocked for entire Guillotine run) | Must be wrapped as best-effort post-commit; never throws; errors logged only |
| G.2 (Guillotine bridge) | Float → Int rounding of `winningBid` produces a FAAB delta that does not match the original Guillotine bid | Low | Low (audit only; roster mutation unchanged) | Document rounding rule (floor) in `GuillotineWaiverBridgeRecord`; display original Float in audit metadata |

### 5.2 Rollback procedures per phase

**Phase R.0 (player browse):**
- Disable `WAIVER_PLAYER_BROWSE_CANONICAL` env var in Vercel.
- Route returns to Redraft-table path immediately on next request.
- No DB state to undo.

**Phase R.1 (shadow write):**
- Disable `REDRAFT_WAIVER_SHADOW` env var.
- Orphaned `WaiverClaim` shadow rows (status='pending') are benign — they are not processed (canonical processor not yet running for Redraft leagues under this flag).
- Optionally: run a one-off script to delete shadow rows for affected Redraft seasons. Script template: `DELETE FROM waiver_claims WHERE source='redraft_shadow' AND processedAt IS NULL`.

**Phase R.2 (canonical primary):**
- Disable `REDRAFT_WAIVER_CANONICAL` env var.
- Processing immediately reverts to `processWaiverWindow` on next cron run.
- If a run already partially settled under the canonical processor: inspect `WaiverRun` for the run; compare `WaiverResult` records against expected Redraft outcomes; manually reconcile any roster divergence.
- `RedraftWaiverClaim` rows were kept as compatibility copies in R.1 → they remain available for the legacy processor to re-process.

**Phase R.3 (route convergence):**
- Re-enable legacy routes: remove 301 redirect.
- UI routes revert to `RedraftWaiverClaim` creation.
- Canonical `WaiverClaim` rows from Phase R.2 remain as the history record; a backfill script may sync these back to `RedraftWaiverClaim` if legacy history queries need them.

**Phase R.4 (table retirement):**
- Not reversible without a DB restore.
- Pre-condition: 30-day soak with zero regression incidents required.
- Backup snapshot of `RedraftWaiverClaim`, `RedraftRosterPlayer`, `RedraftLeagueTransaction` taken immediately before DROP.

**Phase G.2 (Guillotine bridge):**
- Disable `GUILLOTINE_WAIVER_AUDIT_BRIDGE` env var.
- Guillotine settlement reverts to self-contained path (current behavior).
- Orphaned `WaiverResult` bridge records are read-only and do not affect roster state.

### 5.3 Parity gate definition (R.1 → R.2 transition)

A processing run is considered **parity-green** when:
1. Every claim that `processWaiverWindow` awards is also awarded by `processWaiverClaimsForLeague` with the same FAAB delta and priority update.
2. Every claim that `processWaiverWindow` denies is also denied by `processWaiverClaimsForLeague`.
3. The processing order (which roster wins when two rosters bid the same FAAB amount) is identical.

The parity script (`scripts/redraft-waiver-parity.ts`, to be written in Phase R.1):
- Runs both processors in shadow mode against the same pending claim set.
- Produces a structured diff: `[{ claimId, redraftOutcome, canonicalOutcome, match: boolean }]`.
- Exits 0 (PARITY_OK) only when all entries match.
- Run on staging after each Redraft waiver window fires.

**Gate:** 5 consecutive `PARITY_OK` results with at least 1 real processing run (non-zero pending claims) required before `REDRAFT_WAIVER_CANONICAL` is enabled.

### 5.4 Decision OS Stage 1 preservation

The Commissioner Health Stage 1 enrichment (`DECISION_OS_COMMISSIONER_HEALTH_LIVE=true`) reads from `WaiverClaim`, `AfLeagueTrade`, `AfRosterMoveHistory`, and `Roster` — all canonical tables. None of the migration phases modify these tables' schema or access patterns. Stage 1 soak is unaffected.

The Phase 5.1 behavioral event port (`loadWaiverClaimRows`) reads `WaiverClaim`. After Phase R.2, Redraft leagues' waiver events become visible to the behavioral event layer automatically — this is an additive enrichment, not a breaking change.

---

## 6. Execution Order

```
Phase R.0 — canonical player browse (prerequisite fix, safe, isolated)
  │
  └─ Phase R.1 — Redraft shadow write
        │
        └─ [parity gate: 5× PARITY_OK] ──→ Phase R.2 — Redraft canonical primary
              │  (requires: plugin hooks formalized, IDP cap hook registered)
              │
              └─ Phase R.3 — route convergence
                    │
                    └─ [30-day soak] ──→ Phase R.4 — table retirement

Phase G.1 — Guillotine bridge spec (after R.2 stable)
  │
  └─ Phase G.2 — bridge implementation
        │
        └─ Phase G.3 — parity test
              │
              └─ Phase G.4 — route convergence
```

Phases R.0 and the plugin hook formalization (§3) can proceed in parallel with each other. All other phases are sequential within their track.

---

## 7. Out of Scope for G17

- IDP cap business logic changes (hook formalization only, no behavioral change)
- New waiver settings UI
- Dynasty keeper eligibility on waiver-acquired players (separate Dynasty lifecycle ticket)
- Notification deduplication between `run-hooks` and automation wrapper (separate G16 gap item)
- FAAB reset and waiver order reset policy enforcement (G16 gap items — future/cosmetic today)
- `lib/waiver-engine` AI/recommendation package rename (naming collision — separate refactor)
- Any cutover enabling canonical processing for live Redraft leagues (Phase R.2 requires parity gate first)
