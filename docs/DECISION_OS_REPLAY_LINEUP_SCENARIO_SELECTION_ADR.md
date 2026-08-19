# Decision OS Replay Framework Phase 12 — Selecting the First Non-Trade Replay Scenario

**Status:** Selection ADR + type-only scaffolding. No executor, normalizer, or ingest driver implemented. No staging data written. No Trade Learning code touched. No `acceptProbability`/trade-engine code touched. No calibration enabled.
**Update (Phase 13):** the full scenario was built — normalizer, executor, ingest driver, metrics module, 23 tests, and a real 360-row staging validation run — per `docs/DECISION_OS_LINEUP_REPLAY_VALIDATION_REPORT.md`. §3's audit of `optimizeLineupDeterministic()` held up exactly as described, with one real, load-bearing addition discovered during the real staging run: the engine's bitmask-DFS memoization makes it computationally infeasible for large dynasty rosters (35–40 players) — the validation report's §3 covers this in full; it does not change this ADR's original selection rationale, which remains correct for small/medium rosters.
**Branch:** `g15-event-foundation`
**Builds on:** `docs/DECISION_OS_REPLAY_FRAMEWORK_GENERALIZATION_ADR.md` (Phase 11 — defines the generic Replay Scenario abstraction and explicitly recommends against building a second scenario speculatively; this phase is the "pick one concrete candidate" follow-through that ADR called for).

---

## 1. Method

Five candidate decision types were audited against the same three questions the Phase 11 ADR's extension-point design depends on: (a) does `lib/sleeper-client.ts` already expose the real historical data this decision type needs, (b) does a real, exported, unmodified, network-independent production function exist to score/grade it (the executor's hard invariant, Phase 11 ADR §6 — replay must call the real engine, never a reimplementation), and (c) how much new adapter/glue work would be needed vs. trade's already-proven pattern. Findings below were verified directly against source (file paths and line numbers cited), not taken on faith from the initial audit pass.

---

## 2. Candidate comparison

| Candidate | Public API availability | Real deterministic engine to call | Historical completeness | Implementation complexity | Verdict |
|---|---|---|---|---|---|
| **Lineup decisions** | **HIGH** — `getLeagueMatchups(leagueId, week)` (`lib/sleeper-client.ts:196`) returns `SleeperMatchup { starters: string[], starters_points: number[], players: string[], players_points: Record<string,number> }` per roster per week — real actual points already shaped for an actual-vs-optimal comparison | **HIGH** — `optimizeLineupDeterministic()` (`lib/lineup-optimizer-engine/LineupOptimizerEngine.ts:216`), exported, pure DFS/bitmask optimal-lineup solver, zero network/DB imports (only `@/lib/sport-scope` + local types) | Per-week loop needed (weeks 1–18), directly mirrors `getAllLeagueTrades()`'s existing loop pattern (`lib/sleeper-client.ts:545`) — no new API surface, just a new weeks-loop wrapper | **LOW** — the engine already accepts plain `{ id, name, positions, projectedPoints, team }` player objects and `{ code, allowedPositions, required }` slot objects; feeding it real historical `players_points` (instead of a live projection) is a direct, valid reuse, not a workaround | **Recommended** |
| Waiver decisions | MEDIUM — `getLeagueTransactions(leagueId, week)` returns typed `SleeperTransaction[]` with `type: 'waiver'`, but no existing `getAllLeagueWaivers()` helper (would need a new per-week loop + type filter, same shape as trades) | MEDIUM-HIGH — `scoreWaiverCandidates()` (`lib/waiver-engine/waiver-scoring.ts:700`) is a real deterministic composite scorer, plus `computeFaabBid()` (`waiver-faab-engine.ts:81`) — both pure, but require assembling a `WaiverScoringContext`/`WaiverCandidate` (team needs, league facts) — real adapter work beyond trade's flatter `Asset[]` shape | Per-week loop required | MEDIUM | Viable second choice, not first |
| Draft decisions | HIGH — `getLeagueDrafts()` + `getDraftPicks(draftId)` (`lib/sleeper-client.ts:268,278`) return full pick history in one shot | **LOW — no grading engine exists.** `lib/draft-engine/` only has live-draft execution/validation (`DraftValidationEngine.ts`, `PickExecutionEngine.ts`, `generateFullPickOrder.ts`) — nothing scores "was this a good pick" | One-shot per draft (simplest data-fetch of all five) | HIGH — would require building a new value-vs-ADP grading model from scratch, violating the executor's hard invariant (must call a REAL, already-production function, never a new one built just for replay) | Not viable yet |
| Roster moves (non-waiver add/drop) | MEDIUM — same `getLeagueTransactions`, `type: 'free_agent'` | **LOW — no scoring function found anywhere in the repo** (`lib/roster-lineup-engine/rosterMoveHistory.ts` is a descriptive audit log, not a grader) | Per-week loop required | HIGH | Not viable yet |
| Commissioner actions | **LOW** — no dedicated Sleeper commissioner-action endpoint; `type: 'commissioner'` exists but is rare/manual-only, sparse historical data | LOW — `lib/commissioner-engine/` is a documentation-only stub; `lib/commissioner-assistant/commissioner-assistant-engine.ts:217`'s `analyzeCommissionerDashboard()` is a settings/dashboard analyzer, not a decision-grading function | Sparse, provider-dependent | HIGH | Not viable yet |

---

## 3. Selected scenario: Lineup Replay (Sleeper)

**Rationale.** Lineup Replay is the only candidate that satisfies all three criteria simultaneously and cleanly: real weekly historical data already in exactly the right shape, a real production engine that needs zero new business logic to reuse, and a validation question with obvious real value — **"how many points did each real manager leave on the bench, relative to their own achievable optimal lineup, using the real points that were actually scored that week?"** This is a well-understood, standard fantasy-analytics metric (commonly called "optimal points" or "lineup efficiency") — unlike trade replay's `acceptProbability` question, this one has an unambiguous, single correct answer per week per roster (the DFS solver finds the exact maximum), making it arguably an even cleaner validation target than trade replay was at Phase 4.

**Why not the others, briefly:** waiver replay is viable but requires real context-assembly work (team needs, league-wide demand) beyond a straightforward reuse — a legitimate second-or-third candidate, not first. Draft, roster-move, and commissioner-action replay all fail the executor's hard invariant today (Phase 11 ADR §6: must call a real, already-production, unmodified function) — building one from scratch to enable their replay would invert this workstream's entire discipline of validating existing engines against real data, not building new engines to have something to validate.

---

## 4. Scaffolding added this phase (type definitions only)

Per this phase's explicit permission ("if one candidate is clearly low-risk, optionally implement only the smallest scaffolding needed: type definitions, empty executor interface, no ingestion unless explicitly justified"): two new interfaces were added to `lib/replay-framework/types.ts`, following the exact `TradeReplayPayload`/`TradeBacktestOutput` precedent, for Phase 13 to build against. **No executor, normalizer, or ingest driver file was created** — a stub function body with no real logic would be a half-finished implementation, not scaffolding, so none was written. No Prisma migration (the schema's `Json` columns already accommodate any shape). No test file was added for these types (a pure, unused type addition has nothing to unit-test yet; the existing `isolation.test.ts`'s recursive scan will automatically cover any Phase 13 files with zero edits, exactly as designed in Phase 11).

```typescript
export interface LineupReplayPlayer {
  providerAssetId: string  // real, stable provider player ID — same convention as TradeReplayRosterAsset (Phase 9's providerAssetId fix)
  name: string
  pos: string[]            // multi-position eligibility, matching OptimizerPlayerInput's `positions: string[]`
  actualPoints: number      // the real, historical points scored that week (Sleeper's players_points) -- NOT a projection
}

export interface LineupReplayPayload {
  actualStarterIds: string[]        // the real historical providerAssetIds the manager actually started that week
  fullRoster: LineupReplayPlayer[]  // every rostered player that week, real actual points
  slotPositions: string[]           // league's roster_positions, same convention as TradeReplayPayload's roster context
}

export interface LineupBacktestOutput {
  actualPoints: number       // sum of starters_points for the real lineup the manager actually started
  optimalPoints: number      // optimizeLineupDeterministic()'s totalProjectedPoints when fed actualPoints as projectedPoints
  pointsLeftOnBench: number  // optimalPoints - actualPoints
  efficiencyPct: number      // actualPoints / optimalPoints, clamped [0,1] -- 1.0 means the manager started the exact optimal lineup
}
```

---

## 5. Phase 13 implementation prompt

The following is ready to hand to a future phase, following this workstream's established prompt style:

> Continue Decision OS Replay Framework from commit `<this phase's commit>`. Phase 12 selected **Lineup Replay (Sleeper)** as the second Replay Scenario, with type-only scaffolding (`LineupReplayPlayer`/`LineupReplayPayload`/`LineupBacktestOutput` in `lib/replay-framework/types.ts`) already in place. Phase 13: build the full scenario, mirroring trade replay's exact file layout:
> 1. `lib/replay-framework/normalize/sleeperLineupNormalizer.ts` — converts a real `SleeperMatchup` (+ league `roster_positions`, + the players directory for names/positions) into `LineupReplayPayload`/`ReplayImportInput` (`decisionType: 'lineup'`). Reuse `lib/sleeper-client.ts`'s existing `getLeagueMatchups()`/`getAllPlayers()` — do not duplicate a new Sleeper client.
> 2. `lib/replay-framework/backtest/lineupBacktestExecutor.ts` — calls the real, unmodified `optimizeLineupDeterministic()` (`lib/lineup-optimizer-engine/LineupOptimizerEngine.ts`), feeding each roster player's real historical `players_points` as `projectedPoints` (this is a deliberate, valid reuse — see §3's rationale — not a misuse of a projection-shaped input). Produces `LineupBacktestOutput`.
> 3. `lib/replay-framework/ingest/ingestSleeperLineupsForLeague.ts` — new per-week loop (mirroring `getAllLeagueTrades()`'s existing pattern) calling the normalizer → `upsertReplayImport` → executor → `upsertBacktestResult`, for `decisionType: 'lineup'`.
> 4. `lib/replay-framework/metrics/lineupReplayMetrics.ts` — reusing `metrics/shared.ts`'s `bucketize()`/`average()`/`bucketizeSignedMagnitude()` (Phase 11's extraction) — average efficiency%, points-left-on-bench distribution, per-league sensitivity.
> 5. Real ingestion against a small number of real Sleeper leagues, staging only, with the same explicit per-turn approval discipline this workstream has followed since Phase 4 (never write to staging/production without asking first, same turn).
> 6. Full verification: replay-framework tests, architecture tests, typecheck, isolation reconfirmed, no Trade Learning writes, no calibration writes (this remains a read-only validation subsystem — lineup replay has no `acceptProbability`-equivalent to accidentally touch, but the same isolation discipline still applies structurally).
> Deliverables: a validation report analogous to `docs/SLEEPER_TRADE_REPLAY_VALIDATION_REPORT.md`, real before/after (if applicable) metrics, and a recommendation for Phase 14.

---

## 6. What this phase deliberately did NOT do

- Did not write `sleeperLineupNormalizer.ts`, `lineupBacktestExecutor.ts`, `ingestSleeperLineupsForLeague.ts`, or `lineupReplayMetrics.ts` — all real implementation work, reserved for Phase 13 once explicitly scoped.
- Did not call `optimizeLineupDeterministic()` or any Sleeper API this phase — no real data was touched, fetched, or written.
- Did not write to staging or production — this phase's scope was selection and type scaffolding only.
- Did not build waiver, draft, roster-move, or commissioner-action scaffolding — only the selected candidate gets scaffolding, per this phase's explicit "clearly low-risk" gate.

---

## Files changed in this session

- `docs/DECISION_OS_REPLAY_LINEUP_SCENARIO_SELECTION_ADR.md` (this document, new)
- `lib/replay-framework/types.ts` (additive — `LineupReplayPlayer`, `LineupReplayPayload`, `LineupBacktestOutput` interfaces; unused until Phase 13, zero effect on any existing type or behavior)

No trade-engine file was modified. No calibration math, threshold, or weight was changed. No shadow calibration was enabled. No database (staging or production) was written to or read from this session — this phase's audit was entirely static source-code reading. `TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED` remains unset everywhere.
