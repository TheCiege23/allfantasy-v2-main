# Live Lineup Mutation (Persisting Write Path) — Fantasy OS Phase 5E-c

Injects a gated, reject-only certified check into the **real persisting lineup-save path**, immediately before the write, preserving all existing authorities.

## Exact persist call graph (Stop-gate 2)
`POST app/api/leagues/[leagueId]/roster/ai-apply-lineup` → auth → `pro_autocoach` entitlement → league/roster lookup → ownership (`roster.platformUserId === userId`) → chopped/specialty guards → build `nextPlayerData` → **`evaluateLegalityForPersistedRoster`** (roster legality **incl. locks**; rejects `ROSTER_ILLEGAL`) → **`persistRosterLineupWithEngine({ …, skipLockCheck: false })`** (engine re-checks the lock + persists atomically). The validate/lock-state routes do **not** persist; this route (and the canonical `/api/leagues/roster/save`) is the write path.

## Injection point
Between legality-pass and `persistRosterLineupWithEngine`. Order preserved: authenticate → authorize → ownership → slot/roster legality → **certified sports evaluation** → freshness/identity → existing lock authority (engine, `skipLockCheck:false`) → persist → emit evidence.

## Behavior (`evaluateLineupPersistSafety`)
- **Reject-only**: can only ADD a rejection; never approves, never weakens the existing decision.
- **Blocks** only on **trustworthy (current)** certified evidence that a **started** player's game is `at_or_after_start` / `final` / `postponed` / `suspended` — a stricter catch the internal lock might miss. → HTTP 409 `SPORTS_DATA_LOCK`.
- **Manual save fail-OPEN**: on stale/unavailable/unresolved certified context it does **not** block this human-confirmed save — the engine's own `skipLockCheck:false` lock + roster legality remain final. (Automatic/unattended actions fail **closed** instead — see auto-sub, 5E-b.) This is deliberate: blocking every manual save whenever the sports snapshot is stale would be a severe regression, and the existing lock authority is always present.
- **Gated** by `FANTASY_OS_SPORTS_DATA_LINEUP_ENABLED` (off by default → existing behavior byte-for-byte unchanged; cannot be overridden by query/body/header/account). Wrapped in try/catch → an evidence failure never turns a safe save into an error.

## Decision evidence
Emitted in the response `sportsDataDecision` (+ a redacted `console.info` on block): decision, reason, freshness, identity, schedule snapshot version, blocked canonical player ids, timestamp, gate state. **Not persisted to a new production table** — persisting would require a production schema migration, which this increment does not perform (honest). No provider payloads/credentials.

## Direct-provider guard
The route + integration service reach providers only through the gateway ports (no `sleeper-client`/`espn-client` import, no provider URL) — enforced by test.

## Proving run
The guard ran against real certified snapshots (season 2026 wk1 games + the certified players snapshot): `block=false`, `freshness=delayed`, `identity=unresolved`, 0 false rejections → **fail-open verified** (existing authority remains final). **Limitation (explicit):** the 5B certified players sample is **teamless** (FA/practice players), so player→game did not resolve and the **BLOCK path was not exercised live** — it is unit-proven (9 tests covering current+locked/final/postponed/suspended → block, before-start → no block, stale → fail-open, unavailable → fail-open). A richer live block proof needs a re-persisted **rostered** players snapshot for the current week.

## Disable / rollback
Unset `FANTASY_OS_SPORTS_DATA_LINEUP_ENABLED` → route reverts to prior behavior instantly. No production DB touched; no migration.

## Remaining Lineup work
Wire the canonical `/api/leagues/roster/save` route (same pattern); persist decision evidence to a real audit table (needs an approved migration); Start/Sit + today-lineup-actions; a rostered players snapshot for a live block proof.
