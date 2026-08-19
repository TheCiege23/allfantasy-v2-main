# G16 Core Waiver Engine Audit

Readiness is held at NFL Engine 93% and Overall Platform 90%.

This is an audit of the waiver and free-agent system. No production behavior was changed.

## 1. Architecture Map

The current waiver system has two meanings of "waiver engine":

1. Claims, free agency, processing, history, and scheduling:
   - Core code today: `lib/waiver-wire/*`.
   - Main persistence: `LeagueWaiverSettings`, `WaiverClaim`, `WaiverRun`, `WaiverResult`, `WaiverTransaction`, `LeagueWaiverState`.
   - Main routes: `app/api/waiver-wire/leagues/[leagueId]/*`, `app/api/commissioner/leagues/[leagueId]/waivers/route.ts`, `app/api/cron/waivers/route.ts`.
   - This is the actual Core Waiver Engine candidate.

2. Waiver AI/recommendations:
   - Code: `lib/waiver-engine/*`, `lib/waiver-ai-engine/*`, `lib/ai/waivers/*`, `lib/ai-tools-waiver/*`.
   - Main routes: `app/api/waiver-ai/*`, `app/api/ai/waivers/*`, `app/api/ai-tools/waiver-intelligence/*`.
   - This is not the engine that mutates claims. It should remain a Decision OS / AI Recommendation consumer of the Core Waiver Engine.

3. Legacy Redraft waiver stack:
   - Code: `lib/redraft/waiverEngine.ts`.
   - Routes: `app/api/redraft/waivers/route.ts`, `app/api/redraft/waiver-process/route.ts`, plus legacy `app/waiver-wire/*` routes.
   - Persistence: `RedraftWaiverClaim`, `RedraftRoster`, `RedraftRosterPlayer`, `RedraftLeagueTransaction`.
   - This is the largest duplicate logic source.

4. Guillotine specialty waiver stack:
   - Persistence: `GuillotineWaiverRelease` (table `guillotine_waiver_release`).
   - Fields: `releaseStatus` ('pending' | 'available' | 'claimed'), `availableAt` (delayed release gate), `winningBid (Float?)`, `claimedByRosterId`, `claimedAt`.
   - Represents a third independent claiming mechanism: players released from eliminated Guillotine rosters are queued on a per-scoring-period schedule and can be bid on outside the canonical processor.
   - No GuillotineWaiverRelease claiming path currently routes through `processWaiverClaimsForLeague`, canonical `LeagueWaiverSettings`, `WaiverRun`, `WaiverResult`, or `WaiverTransaction`. Settlement is self-contained in the specialty concept.

Recommended Core boundary:

- Core Waiver Engine: settings resolution, claim creation/edit/cancel, immediate FA add/drop, processing order, settlement, history, state, idempotency, audit events.
- Commissioner Settings: save/validate waiver settings and expose enforcement status.
- Roster Engine: projected roster legality, IR/taxi/devy legality, lineup locks, roster move gates.
- League Lifecycle: season active/completed/archived gates and scheduled jobs.
- Plugin Extensions: concept-specific eligibility, roster guards, release timing, special powers.
- Decision OS / AI: read-only recommendations and shadow decisions; no claim mutation authority.

## 2. Current Waiver Lifecycle

Current canonical lifecycle:

```text
Commissioner creates/imports league
  -> LeagueWaiverSettings bootstrapped from sport/variant defaults
  -> managers browse waiver wire
  -> optional eligibility check
  -> create pending WaiverClaim
  -> edit/cancel pending claim
  -> scheduled/manual/FCFS processing starts
  -> processWaiverClaimsForLeague resolves order
  -> claim status updated to processed/failed
  -> roster playerData mutates
  -> FAAB/priority updates
  -> WaiverTransaction + WaiverResult + WaiverRun persist
  -> LeagueWaiverState updates next run and priority snapshot
  -> notifications, chat, activity, trend signals, commentary fire
```

Immediate free-agent lifecycle:

```text
Manager requests add/drop
  -> route checks league action gate and roster transaction gate
  -> settings allow FCFS or instant FA after clear
  -> assertWaiverClaimEligibility validates same roster/FAAB/lock/legal state rules
  -> executeImmediateAddDrop mutates one roster only
  -> WaiverTransaction persists with claimId=null and waiverRunId=null
```

Legacy Redraft lifecycle:

```text
Manager creates RedraftWaiverClaim
  -> processWaiverWindow sorts by bid/priority/submittedAt/id
  -> mutates RedraftRosterPlayer rows
  -> deducts RedraftRoster.faabBalance
  -> emits platform waiver events
```

Legacy Redraft is functional, but it does not inherit the full newer Core Waiver Engine path.

## 3. Enforcement Map

| Behavior / setting | UI location | Persistence path | API route | Engine consumer | Route enforcement | Scheduled enforcement | Browser behavior | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Waiver type: FAAB | `components/app/settings/WaiverSettingsPanel.tsx`, waiver settings routes | `LeagueWaiverSettings.waiverType`, `waiverEngineConfig` | commissioner waivers PUT; waiver-wire settings PUT | `settings-service`, `transaction-eligibility`, `process-engine` | Bid min/remaining checked on create/edit/eligibility | Bid order and FAAB deduction in processor | Claim drawer/settings display FAAB | Enforced |
| Waiver type: rolling | same | same | same | `process-engine` | create path accepts claim | winner priority moves to back | priority shown from state/roster | Enforced |
| Waiver type: reverse standings | same | same | same | `process-engine` uses `LeagueTeam.currentRank` | create path accepts claim | claim order uses rank map | visible as option | Enforced, dependent on rank freshness |
| Waiver type: FCFS | same plus add/drop | same | claims POST; add-drop POST | claim route immediate processing and add-drop service | immediate process/add-drop route gates | cron skips FCFS | UI can show immediate behavior | Partially enforced |
| Standard / free agent after clear | same | same | add-drop route | `instantFaAfterClear` and settings resolver | add/drop route allows immediate if `instantFaAfterClear=true` | batch processor still handles pending claims | visible setting | Partially enforced |
| Processing day/time | Waiver settings panel | `processingDayOfWeek`, `processingTimeUtc`, `processingDays` | settings PUT | `LeagueWaiverState.nextRunAt`, cron discovery | no create-time scheduling validation beyond window rules | cron uses `nextRunAt` when state exists; fallback processes pending claims | displayed in state/settings | Partially enforced |
| Continuous waivers / daily waivers | settings JSON/import defaults | `processingDays`, `freeAgentWindowRules`, `waiverEngineConfig` | settings PUT | submission-window gate and next-run computation | submission windows enforced when JSON configured | next-run depends on state backfill | not fully surfaced in simple panel | Partially enforced / beta |
| Claim limit per week/period | Waiver settings panel and engine config | `claimLimitPerWeek`, `claimLimitPerPeriod`, `waiverEngineConfig` | settings PUT | `waiver-validation` | enforced before create | n/a | visible in settings/state | Enforced |
| Claim limit per run | settings route | `claimLimitPerRun` | settings PUT | `waiver-validation` | enforced before create | n/a | limited UI | Enforced |
| Max drops per week | advanced engine config | `waiverEngineConfig.max_drops_per_week` | settings PUT | `transaction-eligibility` | enforced before create/edit unless commissioner override | processor receives only valid pending claims | not in simple UI | Enforced, advanced |
| FAAB min bid / zero bid | advanced engine config | `faab_min_bid`, `allow_zero_faab_bid` | settings PUT | `transaction-eligibility`, `process-engine` | enforced before create/edit | enforced again during processing | eligibility route returns values | Enforced |
| FAAB reset date/type | settings route | `faabResetDate`, `faabResetType` | settings PUT | not found in processor | not enforced | not enforced | mostly settings only | Future / cosmetic |
| Waiver order reset policy | settings route | `waiverOrderResetPolicy` | settings PUT | not found in processor except legacy Redraft reset helper | not enforced in canonical path | not enforced | settings only | Future |
| Tiebreakers | Waiver settings panel | `tiebreakRule`, `waiverEngineConfig.faab_tiebreaker` | settings PUT | `orderClaimsForProcessing` | accepted at save | enforced in sort | visible | Enforced for supported values |
| Commissioner processing lock | Commissioner waivers POST | `LeagueWaiverState.processingLocked` | commissioner waivers POST | claim service, update/cancel, processor, cron discovery | create/edit/cancel blocked | cron skips/processor returns empty | state route exposes lock | Enforced |
| Commissioner claim overrides | waiver claim route / commissioner claim patch | claim `metadata`, `commissionerOverrideRules` | claims POST, eligibility POST, commissioner waiver-claims PATCH | `commissioner-claim-override` | only commissioner/co-commissioner can merge override metadata | processor honors bypass insufficient FAAB/drop limit | limited UI | Partially enforced |
| Claim edits | claim drawer/routes | `WaiverClaim` | claims `[claimId]` PATCH | `updateClaim`, eligibility | validates pending/ownership/locks/eligibility | n/a | supported by route; UI coverage partial | Enforced, thin error mapping |
| Claim cancellations | claim drawer/routes | `WaiverClaim.status=cancelled` | claims `[claimId]` DELETE | `cancelClaim` | pending/ownership/processing lock enforced | cancelled claims ignored | supported | Enforced |
| Blind bidding | FAAB claim submission | `WaiverClaim.faabBid` | claims POST | processor | bid stored per claim; league scope GET can expose pending claims to commissioner | sorted by bid | managers see own claims by default | Partially enforced |
| Unsuccessful claims | processor | `WaiverClaim.status=failed`, `WaiverResult` | processing routes | `process-engine`, `run-hooks` | n/a | persisted, notification for key failure codes | history feed can read | Enforced |
| Roster full / drop required | claim/add-drop routes | roster `playerData`, `League.rosterSize` | claims, eligibility, add-drop | `transaction-eligibility`, processor fallback | enforced before create/edit | rechecked during processing | user-facing error codes | Enforced |
| IR/taxi/devy legality | roster engine | roster `playerData`, roster legality context | eligibility/create/add-drop | `evaluateLegalityForProjectedRoster` | enforced before create/edit/add-drop | pending claims should already be valid; processor has basic roster checks only | user-facing errors | Enforced at route, partially rechecked at process |
| Lineup locks / started players | roster-lineup engine | roster `playerData` game metadata | eligibility/create/add-drop | `computePerPlayerKickoffLocks` | enforced before create/edit/add-drop | processor only maps freeze/roster checks; does not recompute per-player lock | user-facing errors | Partially enforced |
| League lock / lifecycle completed | League row | `League.lockAllMoves`, `lifecycleState` | eligibility/create/add-drop | `transaction-eligibility`, action gates | enforced before create/add-drop | processor does not re-read lifecycle beyond pending claims | browser blocked by route | Partially enforced |
| Notifications | notification prefs/settings | `League.settings`, notification stores | processor/job hooks | `run-hooks`, automation notification helpers | n/a | fired after processing | visible via notification system | Enforced |
| Waiver history | history routes | `WaiverClaim`, `WaiverTransaction`, `WaiverRun`, `WaiverResult` | claims history, runs route, commissioner history | claim service/process engine | route access checks | written by processor/add-drop | feed components consume | Enforced |
| Audit logging | route/services | audit logs, activity, automation logs | claims/process/admin routes | `auditService`, automation audit, activity event | route-level logs on submits/manual runs | automation logs jobs | commissioner views partial | Partially enforced |
| AI waiver recommendations | Waiver AI panels/routes | none for claims | waiver AI routes | `waiver-ai-engine`, Decision OS waiver shadow | entitlement/token/user validation; no mutation | n/a | recommendations only | Enforced as read-only, not core |

## 4. Route Map

Canonical member routes:

- `app/api/waiver-wire/leagues/[leagueId]/claims/route.ts`
  - GET own/league pending claims and history.
  - POST creates `WaiverClaim` through `createClaim`.
  - FCFS claims immediately call `processWaiverClaimsForLeague`.
- `app/api/waiver-wire/leagues/[leagueId]/claims/[claimId]/route.ts`
  - PATCH updates pending claim through `updateClaim`.
  - DELETE cancels pending claim through `cancelClaim`.
- `app/api/waiver-wire/leagues/[leagueId]/add-drop/route.ts`
  - Immediate FA add/drop through `executeImmediateAddDrop`.
- `app/api/waiver-wire/leagues/[leagueId]/eligibility/route.ts`
  - Dry validation through `assertWaiverClaimEligibility`.
- `app/api/waiver-wire/leagues/[leagueId]/settings/route.ts`
  - Member read, owner write for waiver settings.
- `app/api/waiver-wire/leagues/[leagueId]/state/route.ts`
  - Waiver state, next run, lock, FAAB/priority snapshot.
- `app/api/waiver-wire/leagues/[leagueId]/runs/route.ts`
  - Recent `WaiverRun` audit feed.
- `app/api/waiver-wire/leagues/[leagueId]/process/route.ts`
  - Cron/manual process route through the canonical processor.

Commissioner routes:

- `app/api/commissioner/leagues/[leagueId]/waivers/route.ts`
  - Commissioner settings, pending/history, manual process, lock/unlock.
- `app/api/commissioner/leagues/[leagueId]/waiver-claims/[claimId]/route.ts`
  - Commissioner override metadata patch on pending claims.
- `app/api/commissioner/leagues/[leagueId]/idp/waiver-logs/route.ts`
  - IDP waiver log read surface.

Automation routes:

- `app/api/cron/waivers/route.ts`
  - Discovers due canonical waiver leagues and runs `processLeagueWaiversJob`.
- `app/api/admin/automation/waivers/run/route.ts`
  - Admin/commissioner automation trigger.

Legacy Redraft routes:

- `app/api/redraft/waivers/route.ts`
  - Creates/cancels `RedraftWaiverClaim`.
- `app/api/redraft/waiver-process/route.ts`
  - Runs `lib/redraft/waiverEngine.ts` over active Redraft seasons.
- `app/waiver-wire/claim/route.ts`, `app/waiver-wire/claims/route.ts`
  - Legacy routes still reference Redraft waiver tables.

AI / Decision OS routes:

- `app/api/waiver-ai/engine/route.ts`
- `app/api/waiver-ai/*`
- `app/api/ai/waivers/*`
- `app/api/ai-tools/waiver-intelligence/*`
- `app/api/app/leagues/[leagueId]/waivers/ai-advice/route.ts`

These should remain read-only recommendation routes unless explicitly routed through the same claim mutation services.

## 5. Scheduler Map

Canonical scheduler:

```text
GET /api/cron/waivers
  -> discoverDueWaiverLeagues
  -> processLeagueWaiversJob
  -> withAutomationLock("waiver:league:{leagueId}")
  -> processWaiverClaimsForLeague
  -> automation notifications / realtime / audit
```

Discovery behavior:

- Groups pending `WaiverClaim` rows.
- Skips `LeagueWaiverState.processingLocked`.
- Skips leagues with a running `WaiverRun`.
- Skips FCFS leagues.
- Uses `LeagueWaiverState.nextRunAt` when present.
- If `nextRunAt` is missing, includes leagues with pending claims as a conservative fallback.
- Uses an idempotency key derived from league and date bucket.

Canonical processor behavior:

- Detects duplicate recent idempotency key and returns no work.
- Creates `WaiverRun`.
- Resolves settings and pending claims.
- Orders claims by waiver type/tiebreaker.
- Mutates roster player data, FAAB, and priority.
- Writes `WaiverTransaction`, `WaiverResult`, and completes `WaiverRun`.
- Updates `LeagueWaiverState.nextRunAt`.
- Calls `onWaiverRunComplete`.

Legacy Redraft scheduler:

- `app/api/redraft/waiver-process/route.ts` loops active/drafting `RedraftSeason` rows and runs `processWaiverWindow`.
- This path is separate from canonical automation locks, settings, `LeagueWaiverState`, `WaiverRun`, `WaiverResult`, and plugin hooks.

## 6. Plugin Extension Points

Existing hook points:

- `getSpecialtySpecByVariant(...).rosterGuard`
  - Used during canonical processing.
  - Currently covers guillotine, survivor, zombie, big brother.
- Direct create-time guards:
  - `isRosterChopped` for Guillotine.
  - `isRosterCurrentlyEliminated` and `isWaiverFrozenForRoster` for Survivor.
  - `validateDevyWaiverClaim` for Devy.
- Settings JSON:
  - `specialtyConceptOverrides.waiverBlocked`.
  - `commissionerOverrideRules`.
  - `waiverEngineConfig`.

Recommended Core plugin interface:

```ts
type WaiverPluginHooks = {
  canSubmitClaim(context): Promise<AllowDeny>
  canEditClaim(context): Promise<AllowDeny>
  canProcessClaim(context): Promise<AllowDeny>
  resolveClaimPriorityInput?(context): Promise<Record<string, unknown>>
  beforeSettleClaim?(context): Promise<ClaimPatch | Deny>
  afterSettleClaim?(context): Promise<void>
  releaseRosterToWaivers?(context): Promise<void>
}
```

Suggested plugin ownership:

- Dynasty: keeper/carryover restrictions, offseason waivers, future asset rules.
- Keeper: whether waiver-acquired players are keeper-eligible and keeper cost rules.
- Guillotine: chopped roster release timing and blocked eliminated roster actions.
- Survivor: eliminated roster block, idol/power freezes, exile/return waiver powers.
- Tournament: eliminated/wrong-round competitive action guard and round transition resets.
- C2C: college/pro roster split, college-player eligibility, cross-layer lock windows.
- Devy: devy eligibility, dispersal devy FA rules, graduated-player transition.
- IDP: defensive roster/scoring compatibility and salary/cap assignment hooks.
- Zombie: zombie-status move restrictions and special status effects.
- Big Brother: eliminated roster block and Have-Not waiver penalties.

## 7. Duplicate Logic

1. Canonical vs legacy Redraft claims.
   - Canonical: `WaiverClaim`, `Roster.playerData`, `WaiverRun`, `WaiverResult`, `WaiverTransaction`.
   - Legacy Redraft: `RedraftWaiverClaim`, `RedraftRosterPlayer`, `RedraftRoster.faabBalance`, `RedraftLeagueTransaction`.
   - Impact: Redraft can bypass canonical settings, plugin hooks, automation locks, and history.

2. Canonical vs legacy processing order.
   - Canonical supports FAAB, rolling, reverse standings, FCFS, tiebreaker settings.
   - Legacy Redraft uses bid/priority/submittedAt/id hybrid only.
   - Impact: commissioner waiver type may not mean the same thing across surfaces.

3. Notification fan-out exists in both processor hooks and automation wrapper.
   - `onWaiverRunComplete` dispatches notifications/activity/chat/trends/commentary.
   - `processLeagueWaiversJob` also publishes realtime and enqueues notifications.
   - Impact: possible double notification in automation runs unless downstream systems dedupe.

4. Settings routes overlap.
   - Commissioner route and waiver-wire settings route both write `LeagueWaiverSettings`.
   - Broad commissioner settings can sync legacy waiver columns into the same row.
   - Impact: source of truth is mostly converged on `LeagueWaiverSettings`, but route ownership is still fragmented.

5. AI waiver surfaces use their own "waiver-engine" naming.
   - Impact: architecture readers may confuse recommendation scoring with claim processing.

6. Guillotine specialty stack vs. canonical claiming.
   - `GuillotineWaiverRelease` uses `Float` bid amounts and its own `releaseStatus` state machine, separate from `WaiverClaim.faabBid` (Int) and the canonical `status` field.
   - Impact: Guillotine bid settlement never writes `WaiverResult`, `WaiverTransaction`, or updates `LeagueWaiverState`. Audit history and FAAB tracking are incomplete for Guillotine claims.

## 8. Missing Abstractions

- No formal `WaiverPluginHooks` interface. Current plugin behavior is direct imports plus specialty registry hooks.
- No single Core Waiver Engine package name. The actual engine is `lib/waiver-wire`, while `lib/waiver-engine` is AI/recommendation code.
- No canonical adapter from legacy Redraft waiver claims into the core processor.
- No explicit waiver policy resolver that returns "enforced/cosmetic/future" for each setting.
- No durable scheduler guarantee when `LeagueWaiverState.nextRunAt` is missing; cron fallback may process pending claims earlier than commissioner schedule intent.
- No process-time revalidation of all route-time roster legality and lifecycle gates. Processor rechecks availability, roster size, drop ownership, FAAB, survivor freeze, and roster guard, but does not fully recompute projected roster legality or league lifecycle on each pending claim.
- No unified notification idempotency contract between processor hooks and automation wrapper.

## 9. Severity-Ranked Gap Table

| Severity | File / area | Issue | Reason | Future impact |
| --- | --- | --- | --- | --- |
| High | `app/api/redraft/waivers/route.ts`, `lib/redraft/waiverEngine.ts` | Legacy Redraft waiver stack duplicates canonical engine | Uses different tables, settings, processor, history, and plugin hooks | Redraft may diverge from future Core Waiver Engine behavior. |
| High | `app/api/redraft/waiver-process/route.ts` | Legacy Redraft cron bypasses canonical automation | No `LeagueWaiverState`, `WaiverRun`, canonical settings, or automation lock | Production jobs can produce different results by route. |
| High | `app/api/waiver-wire/leagues/[leagueId]/players/route.ts` | Waiver player browsing bypasses shared pool resolver and touches Redraft roster tables directly | Focused route tests fail because the route calls `prisma.redraftRosterPlayer.findMany` and `prisma.sportsPlayer.findMany` instead of the expected shared resolver path | Future formats can inherit Redraft-specific player availability behavior, cross-sport leakage risk, or hard failures when Redraft roster relations are absent. |
| High | `lib/automation/jobs/waivers/discoverDueWaiverLeagues.ts` | Missing `nextRunAt` fallback processes pending claims | Conservative fallback may ignore commissioner processing day/time when state is absent | Schedules can run early after import/bootstrap gaps. |
| Medium | `lib/waiver-wire/process-engine.ts` | Processor does not fully re-run route-time roster legality/lifecycle validation | Pending claims can age across roster/league state changes | A once-valid claim may settle after IR/taxi/lifecycle conditions changed. |
| Medium | `lib/waiver-wire/process-engine.ts` + automation wrapper | Notification/realtime fan-out split across two layers | Processor and job wrapper both notify outcomes | Duplicate or inconsistent notifications unless deduped. |
| Medium | `lib/waiver-wire/settings-service.ts` | Some persisted settings are not consumed | FAAB reset, order reset, playoff/offseason rules are stored but not enforced | Commissioner settings may be cosmetic/future without clear labeling. |
| Medium | `lib/waiver-wire/claim-service.ts` | Plugin guards are mixed direct imports and registry lookup | Devy/survivor/guillotine logic is hardwired into core claim creation | New plugins may copy code instead of extending hooks. |
| Medium | `app/api/waiver-wire/leagues/[leagueId]/claims/[claimId]/route.ts` | Claim edit route maps only lock errors; other validation throws bubble | Create route has richer user-facing errors | Edit UX can regress under invalid FAAB/drop/roster cases. |
| Medium | `lib/roster-defaults/RosterValidationEngine.ts` | Related roster validation rejects a valid Dynasty IDP waiver context | Focused related-roster test expects `DYNASTY_IDP` to allow a valid IDP lineup, but validation returns invalid | Waiver eligibility depends on roster legality, so Dynasty/IDP claims can be incorrectly blocked. |
| Medium | `GuillotineWaiverRelease` (schema model) | Guillotine player-release claiming bypasses the canonical waiver engine entirely | Uses own `releaseStatus` state machine, Float bid amounts, and self-contained settlement; no `WaiverRun`, `WaiverResult`, `WaiverTransaction`, or `LeagueWaiverSettings` consumed | Guillotine claim history, FAAB deductions, and audit trail are not recorded in the canonical tables; future Core Waiver Engine migration must account for this third sub-system. |
| Low | `app/api/waiver-wire/leagues/[leagueId]/state/route.ts` | State route reads `redraftRoster` for FAAB/priority in a canonical waiver route | Mixed canonical and Redraft roster models | UI snapshots can be wrong for non-Redraft/canonical roster leagues. |
| Low | `lib/waiver-engine/*` naming | AI recommendation package name collides with Core Waiver Engine concept | "Engine" means recommendation scorer here | Architecture confusion during migration. |

## 10. Minimal-Risk Migration Plan

1. Document Core Waiver Engine ownership.
   - Treat `lib/waiver-wire` as the current execution engine.
   - Treat `lib/waiver-engine` as AI/recommendation until renamed or namespaced.

2. Add a non-mutating `WaiverPluginHooks` adapter.
   - Wrap existing guillotine/survivor/zombie/big brother roster guards.
   - Wrap `validateDevyWaiverClaim`.
   - Add tournament competitive action guard.
   - Keep old direct checks in place until parity tests pass.

3. Add process-time revalidation before settlement.
   - Reuse `assertWaiverClaimEligibility` or a process-safe variant that excludes same-claim conflicts and respects current roster/lifecycle state.
   - Keep settlement transaction unchanged.

4. Create a Redraft compatibility adapter.
   - New Redraft claim creation should write canonical `WaiverClaim` or dual-write behind a feature flag.
   - Legacy `RedraftWaiverClaim` reads remain compatibility-only.
   - Do not delete legacy tables until Redraft UI and cron use canonical processing.

4a. Audit GuillotineWaiverRelease claim settlement.
   - Map the Guillotine claiming path to determine whether `availableAt` gating and `winningBid` resolution can be routed through the canonical processor or emitted as canonical `WaiverRun` / `WaiverResult` records post-settlement.
   - Do not migrate until a non-breaking bridging route is confirmed; Guillotine specialty concept must remain self-contained until then.

5. Make scheduler state deterministic.
   - Ensure league bootstrap/import writes initial `LeagueWaiverState.nextRunAt`.
   - Change cron fallback from "pending claims means due" to "pending claims plus schedule resolvable and due" once state backfill is complete.

6. Clarify future settings.
   - Mark FAAB reset, waiver order reset, playoff/offseason waiver rules, and advanced continuous-waiver rules as beta/future unless tests prove enforcement.

7. Normalize notification ownership.
   - Processor should emit durable domain events/results.
   - Automation wrapper should handle job status.
   - Notification workers should consume events idempotently.

8. Add focused parity tests before any behavior cutover.
   - FAAB, rolling, reverse standings, FCFS, route create/edit/cancel, cron idempotency, plugin blocks, roster legality, legacy Redraft parity.

## 11. Test Coverage

Focused G16 test run:

```text
npx vitest run __tests__/waiver-settings-service.test.ts __tests__/waiver-defaults-by-sport.test.ts __tests__/waiver-automation.test.ts __tests__/waiver-claims-route-scope.test.ts __tests__/waiver-wire-player-route-pool-resolver.test.ts __tests__/waiver-ai-engine-route-contract.test.ts __tests__/waiver-ai-service.test.ts __tests__/waiver-ai-gating.test.ts __tests__/redraft/waiver-scoring.test.ts __tests__/redraft/waiver-watchlist-service.test.ts __tests__/redraft/waiver-add-drop-ux.test.tsx __tests__/redraft/add-drop-errors.test.ts __tests__/redraft/players-waivers-deep-build.test.tsx __tests__/league-roster-validation-context.test.ts __tests__/roster-engine-validation.test.ts __tests__/roster-lineup-engine-validation.test.ts __tests__/commissioner-settings-route.test.ts __tests__/league-ai-settings-resolver.test.ts __tests__/decision-os/waiver-loader.test.ts __tests__/decision-os/waiver-shadow.test.ts __tests__/decision-os/waiver-architecture.test.ts __tests__/decision-os/waiver-decision.test.ts __tests__/decision-os/waiver-rules.test.ts
```

Result:

```text
Test Files  2 failed | 21 passed (23)
Tests       3 failed | 114 passed (117)
```

The focused suite loaded and executed from the current checkout, so this is not the stale Vitest setup-path failure.

Failed suites:

- `__tests__/waiver-wire-player-route-pool-resolver.test.ts`
  - `uses shared league pool resolver and filters by rostered internal/external ids` expected `200`, received `500`.
  - `rejects cross-sport query overrides to prevent player pool leakage` expected `400`, received `500`.
  - Blocker: `app/api/waiver-wire/leagues/[leagueId]/players/route.ts` calls `prisma.redraftRosterPlayer.findMany` before the expected resolver/sport-guard path.
- `__tests__/league-roster-validation-context.test.ts`
  - `supports NFL DYNASTY_IDP slot eligibility in lineup/waiver validation` expected a valid IDP lineup, received `valid: false`.
  - Blocker: related roster validation can reject a Dynasty IDP waiver context.

Missing or thin coverage:

- Canonical processor process-time revalidation after roster/lifecycle changes between claim submission and settlement.
- Legacy Redraft waiver parity against canonical FAAB/rolling/reverse standings settings.
- `League.draft`/season lifecycle lock interaction with pending waiver processing.
- Commissioner override route end-to-end coverage.
- `LeagueWaiverState.nextRunAt` bootstrap/backfill coverage.
- Duplicate notification prevention across processor hooks and automation wrapper.
- Tournament eliminated-user waiver guard in canonical claim creation.
- FAAB reset and waiver order reset policy enforcement.

## 12. Readiness Assessment

Do not increase readiness from G16.

- NFL Engine remains 93%.
- Overall Platform remains 90%.

Reason: the canonical waiver path is substantially real and tested, but the legacy Redraft waiver stack and scheduler fallback prevent calling the Waiver Engine fully reusable across future league formats yet. A readiness increase should wait until Redraft uses the canonical processor, plugin hooks are formalized, and the scheduler/state fallback is deterministic.
