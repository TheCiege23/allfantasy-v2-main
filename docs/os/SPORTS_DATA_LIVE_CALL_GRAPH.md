# Sports Data Live Call Graph + Wiring Status (Fantasy OS Phase 5E)

## Stop-gate 1 — real call graph (traced)
| Subsystem | Real entry point(s) | Deterministic authority | Injection point | Wired? |
|---|---|---|---|---|
| Lineup mutation/validation | `app/api/leagues/[leagueId]/roster/lineup/validate`, `.../lock-state` | `lib/roster-lineup-engine/lineupLockService.ts` | lineup validation service | **read-only context route wired** (below); mutation-path injection deferred |
| Auto-switch | `app/api/lineup/auto-sub/route.ts` | `lineupLockService` + eligibility | before-mutation precondition | deferred (safety contract built in 5D-c) |
| Start/Sit | `app/api/today/lineup-actions`, lineup-optimizer | league scoring | Start/Sit assembler | deferred |
| Waiver | `app/api/waiver-ai/engine`, `WaiverContextAssembler` | league ownership | context assembler | deferred |
| Trade | `app/api/trade-value/analyze`, `lib/trade-engine/*` | deterministic valuation | Trade context assembler | deferred |
| Draft | draft-room player pool services | Draft OS (order/clock) | draft analysis context | deferred |
| Matchup | `scoringEngine.ts`, `MatchupStateNormalizer.ts` | scoring engine | scoring context | deferred |
| League/Commissioner/Manager/Platform Intelligence | executive intelligence | deterministic derivations | read ports | deferred |
| Coach / Chimmy | AI context assembly | — | canonical context builder | deferred |

**Authority boundary (all subsystems):** the sports-data runtime supplies **facts + freshness + evidence**; it is never the authority for lineup legality, locks, ownership, valuation, scoring, draft order, roster construction, authorization, or commissioner permissions.

## Delivered this increment (Phase 5E-a)
The **safe foundation + first compile-graph wiring**:
- **Runtime feature gates** (`lib/fantasy-os/sports-runtime/gates.ts`) — 7 server-only gates, **disabled by default**, secret-safe diagnostics, no customer override.
- **Shared runtime context envelope** (`context.ts`) — one envelope; stale stays stale; `unavailable` never empty-but-current; provider fields never cross; identities visible.
- **First live route** `POST /api/fantasy-os/sports/lineup-context` — read-only, gated, session-guarded. Imports the Lineup runtime ports (`playerGameResolution`, `lineupSafety`, `scheduleRuntime`) → **the integration layer now enters the production compile graph via a real route**. Returns canonical game/lock **evidence**; decides nothing about roster mutation (lock authority stays final). Fails closed to `unavailable`; never fabricates.
- **Direct-provider-import guard** (test) — the wired route + consumer layer must not import a provider client or hit a provider URL directly (allowlist: gateway adapters + sync fetchers).

## Not wired (honest — the risky remainder)
The surgical injections into `lineupLockService` mutation path, auto-switch, `WaiverContextAssembler`, Trade evaluator, Draft OS, `scoringEngine`/`MatchupStateNormalizer`, intelligence, and Coach/Chimmy are **each their own careful, reversible increment** (they modify large existing production engines and each needs a dedicated call-graph test). They are **not** claimed as wired.

## Disable / rollback
Every integration is behind its `FANTASY_OS_SPORTS_DATA_*_ENABLED` gate (off by default → existing behavior). The lineup-context route returns `{ enabled: false }` when its gate is off.
