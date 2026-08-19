# Lineup Family — Complete Certified Wiring — Fantasy OS Phase 5E-d

Completes the Lineup family: the canonical save route, Start/Sit, and Today Lineup Actions now consume certified sports context where appropriate. All gated (`FANTASY_OS_SPORTS_DATA_LINEUP_ENABLED`, off by default), additive, and reject-only / informational — deterministic authorities remain final. Builds on 5E-c (`ai-apply-lineup`).

## Shared service (no duplicated rules)
One `CertifiedLineupIntegrationService` serves every wired path. 5E-d adds:
- `describeScheduleForPlayers(...)` — **informational, never-blocking** certified schedule description: kickoff, game status, lock evidence, freshness, identity. Injuries/projections/availability are **explicitly `unavailable`** (the certified schedule plane does not provide them — never fabricated). Fails to `available:false` on read/identity failure.
- `LOCKED_LINEUP_EVIDENCE` — the single shared classifier of "game already locked/started/final/postponed/suspended", reused by both the write-path guard and the informational description (evidence classification, **not** lock policy — `lineupLockService` / engine persist remain the lock authority).

## Canonical save — `POST /api/leagues/roster/save`
**Call graph:** auth → `validateAiActionExecution` → league lookup → membership/commissioner authz → target-roster resolution + ownership → chopped/specialty guards → build `nextPlayerData` → **`persistRosterLineupWithEngine({ skipLockCheck: false })`** (lock authority + atomic persist) → learning/trend signals.

**Injection:** `evaluateLineupPersistSafety` (reuses 5E-c) runs **after** `nextPlayerData`/`season` are resolved and **before** `persistRosterLineupWithEngine`. Reject-only (409 `SPORTS_DATA_LOCK`) only on **current** certified evidence a started player's game is locked/final/postponed; **fails open** on stale/unavailable for this human-confirmed manual save. Gated, try/catch-wrapped, evidence emitted in the response (not persisted).

**Deliberate:** this route uses the engine persist as its deterministic authority and has never run a separate full roster-legality gate (it is intentionally more permissive than the premium `ai-apply-lineup`). 5E-d does **not** add one — that would regress existing behavior. The certified check is purely additive/reject-only.

## Start/Sit — `POST /api/leagues/[leagueId]/ai/start-sit`
Read-only advice route (`runStartSitAiEngine`) — no persistence. Injects `describeScheduleForPlayers` for `playerA`/`playerB` and attaches `sportsSchedule` (schedule evidence only). Advice authority unchanged; injuries/projections/availability surfaced as `unavailable`. Gated, wrapped.

## Today Lineup Actions — `GET /api/today/lineup-actions/[leagueId]`
Informational only. `computeLineupActionsForUser` remains the action authority. Adds `sportsSchedule` urgency: next-kickoff countdown (`nextKickoffAt` / `minutesToNextKickoff`), `lockUrgency`, `scheduleDelayed`, `scheduleAvailable`, `lockedStarters`, `informationalOnly: true`. **Never mutates a lineup.** Gated, wrapped.

## Fail-closed vs fail-open
Automatic/unattended actions (auto-sub, 5E-b) fail **closed**. Human-confirmed manual saves (canonical save, ai-apply) fail **open** (existing lock final). Read-only surfaces (Start/Sit, Today Actions) never block or mutate.

## Import guard
All three routes reach providers only through gateway ports — no `sleeper-client`/`espn-client`/provider URL. Test-enforced (`sports-data-lineup-family.test.ts`) alongside 5E-c coverage.

## Proving run (non-prod certified snapshots, `cool-lab-87438174`)
Against certified `nfl-games-2026-w1-2026-07-12` (16 games) + certified players snapshot:
- `evaluateLineupPersistSafety` → `block=false`, freshness `delayed`, identity `unresolved`, snapshot `nfl-games-2026-w1-2026-07-12` → **fail-open verified** (read real snapshot, no false reject).
- `describeScheduleForPlayers` → `available=true`, players enumerated, `unsupported` = injuries/projections/availability `unavailable` → **schedule read + unsupported fields honest**.

**Limitation (explicit):** the certified players snapshot is **teamless** (all `teamId=null`, canonical ids mostly `unresolved:*`), so player→game did not resolve — kickoff/gameStatus came back `null` and the write-path BLOCK path did not fire live. BLOCK + populated kickoff are **unit-proven** (`sports-data-lineup-family.test.ts`). A live block/kickoff demo needs a re-persisted **rostered, team-linked** players snapshot.

## Disable / rollback
Unset `FANTASY_OS_SPORTS_DATA_LINEUP_ENABLED` → all three routes revert to prior behavior instantly. No production DB touched; no migration.

## Lineup family status
Complete: lock-state, auto-sub, ai-apply-lineup (5E-b/5E-c), **canonical save, Start/Sit, Today Actions (5E-d)**. Remaining across Phase 5: persisting decision evidence to a real audit table (needs approved migration); a rostered players snapshot for live block/kickoff proof; then Waiver live wiring (Phase 5E-e).
