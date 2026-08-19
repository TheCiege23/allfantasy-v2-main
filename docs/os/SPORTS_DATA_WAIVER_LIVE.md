# Live Waiver Integration (Certified Sports Context) — Fantasy OS Phase 5E-e

Injects certified sports context into the real Waiver decision flow behind `FANTASY_OS_SPORTS_DATA_WAIVER_ENABLED` (**off by default**), additive and reject-only / informational. The deterministic waiver engine, eligibility, and roster legality remain the final authorities. Follows the Lineup-family pattern (5E-b…5E-d).

## Shared service (no duplicated rules)
`lib/fantasy-os/sports-runtime/waiverIntegration.ts` — `CertifiedWaiverIntegrationService` **composes** the existing `CertifiedLineupIntegrationService` schedule primitive (`describeScheduleForPlayers`); it does not reimplement schedule/identity/lock logic (single source of truth). Two methods:
- `evaluateWaiverClaimSafety({season, week, addRefs, dropRefs})` — **reject-only**: blocks only on **current** certified evidence an add/drop player's game is locked/started/final/postponed; **fails open** on stale/unavailable. Never approves.
- `describeWaiverScheduleContext({season, week, players})` — **informational**: kickoff/status/lock/freshness/identity; injuries/projections/availability/rankings surfaced as explicitly `unavailable` (never fabricated).

## Submission — `POST /api/waiver-wire/leagues/[leagueId]/claims`
**Call graph:** auth → roster ownership → `validateAiActionExecution` → `assertLeagueActionGate('waiver_claim_submit')` → `assertRosterTransactionsAllowed({kind:'waiver_claim'})` (roster legality + locks) → duplicate-pending check → **`createClaim(...)`** (authoritative persist) → audit → realtime hint → FCFS immediate processing.

**Injection:** `evaluateWaiverClaimSafety` runs **after** the eligibility + roster-legality gates and **before** `createClaim`. Reject-only (409 `SPORTS_DATA_LOCK`) on current certified lock evidence; **fails open** on stale for this human-confirmed manual claim. Gated, try/catch-wrapped, `sportsDataDecision` emitted in the response (not persisted).

## Eligibility / preview — `POST /api/waiver-wire/leagues/[leagueId]/eligibility`
Read-only pre-submit validation (`assertWaiverClaimEligibility`) — no persistence. Adds informational `describeWaiverScheduleContext` for the add/drop players → `sportsSchedule` (schedule only). Eligibility authority unchanged; gated, wrapped.

## Assembler — `lib/shared-services/waiver/WaiverContextAssembler.ts`
Adds an **additive** `sportsContext` field (certified schedule description for the roster's players). It is computed **after** `engineInput` is assembled and **never feeds `engineInput`** — the deterministic recommender's output is unchanged. `null` unless the gate is on and snapshots resolve. Gated, wrapped.

## Recommendation route
`app/api/waiver-ai/engine/route.ts` runs `runWaiverAIService` (recommendation, no persistence). Certified context reaches the recommender's inputs through the assembler's additive `sportsContext` (evidence only). The authoritative persist path is the claims route above; automatic recommendation surfaces do not take side-effectful action, so the reject-only guard is applied at submission, not to advice.

## Certified sports context — supported vs unsupported
Supported: canonical player identity, schedule, game status, kickoff/start time, freshness, identity state. Explicitly **unsupported** (returned as `unavailable`, never fabricated): injuries, projections, availability, rankings.

## Decision evidence
`sportsDataDecision` emitted on the claims route: featureGateEnabled, leagueId, rosterId, finalDecision, reason, freshnessStatus, identityStatus, scheduleSnapshotVersion, blockedCanonicalPlayerIds, evaluatedAt. No provider payloads. Not persisted (no migration).

## Import guard
All wired waiver routes + the service + assembler reach providers only through gateway ports (no `sleeper-client`/`espn-client`/provider URL). Test-enforced (`__tests__/fantasy-os/sports-data-waiver.test.ts`).

## Fail-closed vs fail-open
Manual waiver submissions fail **open** on uncertain certified data (existing authority final), reject only when certified evidence proves the submission unsafe. Read-only surfaces (eligibility/preview, assembler) never block or mutate.

## Proving run (non-prod certified snapshots, `cool-lab-87438174`)
Against certified `nfl-games-2026-w1-2026-07-12` (16 games) + certified players snapshot:
- `evaluateWaiverClaimSafety` → `block=false`, freshness `delayed`, identity `unresolved`, snapshot `nfl-games-2026-w1-2026-07-12` → **fail-open verified** (real snapshot read, no false reject).
- `describeWaiverScheduleContext` → `available=true`, players enumerated, `unsupported` = injuries/projections/availability `unavailable`.

**Limitation (explicit):** the certified players snapshot is **teamless** (all `teamId=null`, canonical ids mostly `unresolved:*`), so player→game did not resolve — kickoff/gameStatus came back `null` and the write-path BLOCK path did not fire live. BLOCK + populated kickoff are **unit-proven** (`sports-data-waiver.test.ts`). A live block/kickoff demo needs a re-persisted **rostered, team-linked** players snapshot.

## Disable / rollback
Unset `FANTASY_OS_SPORTS_DATA_WAIVER_ENABLED` → all waiver surfaces revert to prior behavior instantly. No production DB touched; no migration.

## Status
Waiver flow now consumes certified sports context at submission (reject-only), eligibility/preview (informational), and assembly (additive) — the deterministic waiver engine stays authoritative. Next planned increment: **Phase 5E-f — Trade & Draft live wiring**.
