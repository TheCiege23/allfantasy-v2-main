# Live Trade & Draft Integration (Certified Sports Context) — Fantasy OS Phase 5E-f

Two independent workstreams inject certified sports context into the real Trade and Draft flows, each behind its own server-only gate (`FANTASY_OS_SPORTS_DATA_TRADE_ENABLED`, `FANTASY_OS_SPORTS_DATA_DRAFT_ENABLED`), **off by default**, additive and reject-only / informational. Certified data supplies **facts only**; it never grants permission and never overrides a deterministic authority. Both compose the existing `CertifiedLineupIntegrationService` schedule primitive — no duplicated schedule/identity/lock/trade/draft rules.

## Workstream A — Trade

### Exact call graph
- **Analysis** — `GET /api/leagues/[leagueId]/trades/[tradeId]` → `assertLeagueMember` → `getAfLeagueTrade` (trade + items). **Informational** `sportsContext` attached; the trade payload is passed through unchanged (valuation/fairness/reconstruction untouched).
- **Proposal** — `POST /api/leagues/[leagueId]/trades` → `assertLeagueMember` → governance-field guard → **reject-only guard** → `createAfLeagueTrade` (authoritative validate + persist).
- **Acceptance** — `POST /api/leagues/[leagueId]/trades/[tradeId]/accept` → `assertLeagueMember` → **reject-only guard (re-evaluated)** → `acceptAfLeagueTrade`.
- **Settlement** — `POST /api/leagues/[leagueId]/trades/[tradeId]/process` → `assertLeagueMember` → `isElevatedCommissioner` → **reject-only guard (re-evaluated)** → `finalizeAfLeagueTradeProcessing` (authoritative settlement + persistence).

Accept + settlement share `evaluateTradeSettlementGuard` (loads trade via `getAfLeagueTrade`, extracts player assets, runs the reject-only guard) so the logic lives in exactly one place.

### Authority preservation — the key discipline
`resolveLeagueTradeSettings` **declares** `playerLockPolicy: 'individual_game_time'`, but the trade engine has **no consumer that enforces it** (verified by grep). Per the Global Authority Rule — a player's game having started must not auto-invalidate a trade unless the existing rules already *use* that state — the guard is structurally **reject-capable** but only fires when `enforcePlayerLock` is true. **The product routes pass `enforcePlayerLock: false`** because the engine does not enforce it, so the guard **emits evidence and never invents a rejection**. Deterministic valuation, legality, ownership, deadline, recently-added, cap movement, roster reconstruction, and settlement all remain final and untouched.

### Certified context
Supported: canonical player identity + state, canonical team/game, scheduled start, game status, schedule freshness, snapshot version, evaluated timestamp. Explicitly **unsupported** (returned `unavailable`, never fabricated): injuries, projections, trade values, rankings, availability, manager intent, acceptance likelihood. Never inserted into deterministic valuation inputs.

### Decision evidence
`sportsDataDecision` emitted on proposal/accept/process (decision, reason, freshness, identity, snapshot version, started canonical player ids, `policyObserved`, timestamp, gate state). No provider payloads. Not persisted (no migration).

## Workstream B — Draft

### Exact call graph
- **Live pick** — `POST /api/leagues/[leagueId]/draft/pick` → `canAccessLeagueDraft` → payload validation → `buildSessionSnapshot` (current pick) → on-the-clock ownership (`DRAFT_PICK_NOT_ON_CLOCK`) → commissioner check → `canSubmitPickForRoster` → `assertLeagueActionGate('draft_pick')` → **`submitPick`** (authoritative: duplicate/slot/stale-overall validation + idempotent persist + `idempotentReplay`) → exactly-once side effects. **Certified evidence is computed AFTER `submitPick` and only attached to the response** — it never gates the pick or touches idempotency.
- **Room / board** — `GET /api/leagues/[leagueId]/draft/session` → `buildSessionSnapshot` → **informational** `sportsContext` describing the certified schedule for already-made board picks. Never affects order/pick/pool.

### Authority preservation
Certified sports facts (identity resolution, schedule freshness, a game having started, missing injury data) are **NOT Draft legality rules** — the Draft engine has no policy keyed to them. `evaluateDraftPickSafety` therefore **NEVER blocks** — it only emits identity/freshness/schedule evidence. Unresolved identity, stale schedule, or a started game do not falsely invalidate a legal manual pick. Draft order, current pick, clock, ownership, player pool, sport isolation, roster construction, duplicate protection, and idempotency/exactly-once all remain final and untouched. No new auto-pick recommendation logic was added, so nothing requires certified context for an automatic rule (no fail-closed path was introduced).

### Certified context
Supported: canonical player identity + state, canonical team, scheduled game, game status, schedule freshness, snapshot version. Explicitly **unsupported** (returned `unavailable`): injury, projection, ranking, ADP, recommendation score, depth-chart, provider-inferred availability. Certified data never decides whether a player is draftable.

## Import guard
All wired Trade + Draft routes and the new services reach providers only through gateway ports — no `sleeper-client`/`espn-client`/provider URL. Test-enforced (`__tests__/fantasy-os/sports-data-trade.test.ts`, `sports-data-draft.test.ts`).

## Proving runs (non-prod certified snapshots, `cool-lab-87438174`)
Against certified `nfl-games-2026-w1-2026-07-12` (16 games) + certified players snapshot:
- Trade `describeTradeSportsContext` + `evaluateTradeSettlementSafety(enforcePlayerLock:false)`: read the real snapshot; settlement `block=false`; `unsupported` fields `unavailable`; deterministic inputs untouched.
- Draft `describeDraftPlayerSportsContext` + `evaluateDraftPickSafety`: read the real snapshot; pick safety `block=false` (a legal manual pick is never blocked); `unsupported` fields `unavailable`.
- **No provider request occurs** (gateway ports only).

**Limitation (explicit):** the certified players snapshot is **teamless** (all `teamId=null`, canonical ids mostly `unresolved:*`), so player→game did not resolve — kickoff/gameStatus came back `null` and identity is `unresolved`. A live team-resolution / populated-game proof needs a re-persisted **rostered, team-linked** players snapshot. No live lock/team-resolution proof is claimed.

## Disable / rollback (independent)
Unset `FANTASY_OS_SPORTS_DATA_TRADE_ENABLED` and/or `FANTASY_OS_SPORTS_DATA_DRAFT_ENABLED` → the respective flow reverts to prior behavior instantly. Trade and Draft roll back independently. No production DB touched; no migration.

## Next
Phase 5E-g — Matchup & Scoring live wiring.
