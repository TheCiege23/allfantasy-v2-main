# Trade Value Console — Real-Data Validation (Phase 18)

**Status: real validation performed against `.env.test` (the same non-production Neon database used since Phase 13). No bug found. Readiness: B — continue shadow validation.**

**Phase 19 update:** the small (8-request) sample here never exercised `identity_unresolvable` with real data — Phase 19's larger (30-event), deliberately diverse sample did, finding and fixing a real bug (the canonical resolver's NFL-only coverage silently failed every non-NFL asset). See [`FANTASY_OS_TRADE_EXPANDED_REAL_VALIDATION.md`](FANTASY_OS_TRADE_EXPANDED_REAL_VALIDATION.md) for the full record, including a real, significant, out-of-scope performance finding in the authoritative engine (unrelated to this migration) that this migration's own shadow-seam isolation proved immune to.

## Environment

Same `.env.test` non-production Neon database re-verified this session's precedent (`.env`'s default production-adjacent database was never accessed). Unlike every Waiver validation phase, **no QA identity or dev-auth-bypass setup was needed** — `/api/trade-value/analyze` does not require authentication (`userId` is optional throughout `runTradeConsoleAnalysis`).

## Real request sample

8 real HTTP requests against a locally-running dev server pointed at `.env.test`, with `SHARED_SERVICES_TRADE_SHADOW_COMPARE=true`:

| # | Scenario | Strategy | Assets | Status | Shadow ran? |
|---|---|---|---|---|---|
| 1 | Real WR-for-RB | contender | 2 real players | 200 | Yes — equivalent |
| 2 | Real WR/TE-for-pick | rebuilder | 2 real players + 1 pick | 200 | Yes — equivalent (pick excluded from shadow) |
| 3 | Real QB-for-QB | win_now | 2 real players | 200 | Yes — equivalent |
| 4 | Real 2-for-1 | long_term | 3 real players | 200 | Yes — equivalent |
| 5 | Real WR-for-WR | neutral | 2 real players | 200 | Yes — equivalent |
| 6 | Pick-for-FAAB only | contender | 0 real players | 200 | No — correctly `no_player_assets` |
| 7 | Fake name + real player | neutral | 1 real player reached the shadow (the fake name was dropped by the authoritative engine itself before the shadow ever saw it) | 200 | Yes — equivalent |
| 8 | 2 fake names + 1 real player | rebuilder | 1 real player reached the shadow | 200 | Yes — equivalent |

**Honest sample-size note**: 8 real requests, not padded to a larger round number with duplicate conditions. Scenarios 7 and 8 were intended to exercise `identity_unresolvable`, but — a real, disclosed finding — the authoritative engine drops any name it cannot resolve *before* the response is built, so the shadow never receives those specific fake names at all. This is documented, not hidden: it means this validation run did not exercise the `identity_unresolvable`/`identity_ambiguous` paths with real data (they are covered by mocked unit tests instead — see `FANTASY_OS_TRADE_SHADOW_COMPARE.md`).

## Real telemetry results

| Metric | Value |
|---|---|
| Total telemetry events | 8 |
| `ran: true` | 7 |
| `ran: false` (`no_player_assets`) | 1 |
| `equivalent` | 7/7 (100%) |
| `partial_identity_unresolved` / `identity_unresolvable` | 0 / 0 |
| `shadow_execution_failure` | 0 |
| Total real player assets across all `ran:true` events | 13 |
| Assets resolved | 13/13 (100%) |
| Shared-service duration (p50 / p95) | 73ms / 533ms |
| Authoritative engine duration (p50 / p95) | 1,902ms / 7,012ms |

The authoritative engine's own latency (which this phase did not touch) is meaningfully higher than the shadow seam's — a real, disclosed, pre-existing characteristic of `runTradeConsoleAnalysis`'s pipeline (FantasyCalc + sports data + AI calls), unrelated to this migration.

## Rollback proof

Server restarted with `SHARED_SERVICES_TRADE_SHADOW_COMPARE` unset. The same request that previously produced shadow telemetry (`Nick Chubb` for `Josh Allen`) returned an identical `200` response with **zero** new telemetry.

## Scoping

Not deeply re-tested this phase beyond the flag-off/flag-on proof above — this route's `leagueId` is optional and most real requests won't carry one, so the `DECISION_OS_TEST_LEAGUE_IDS` league-scoping mechanism (proven repeatedly in every Waiver phase) applies identically here when a `leagueId` is present; no new scoping logic was written.

## Bugs found

**None.** No code was found broken by this validation; no fix was made beyond the implementation itself.

## Readiness classification

### B — Continue shadow validation.

**Why not A:** only one real, small sample (8 requests) from one non-production environment; `identity_unresolvable`/`identity_ambiguous` were never exercised with real data (only mocked tests); the full fairness-score comparison remains unimplemented by design (see the Shadow Compare doc's Scope section) — meaningful further validation is needed before any authoritative consideration.

**Why not C:** nothing is broken. 100% equivalence on every real request that reached the shadow, 0% failures/timeouts, rollback proven, no unauthorized data exposure.

## Distinguishing evidence types (explicit, per this effort's established discipline)

- **Real Phase 18 evidence**: the 8-request table above, and the unit/route-contract tests that mock only true external boundaries.
- **Inferred conclusion**: that the authoritative engine's own latency (not measured as a goal of this phase) is a pre-existing characteristic, inferred from the gap between total client-observed latency and the measured `authoritativeDurationMs` window, not independently isolated.
- **Remaining unknown**: whether `identity_unresolvable`/`identity_ambiguous` occur at a meaningful rate in real, larger-scale traffic — not measurable from this small sample.

## Phase 21 update

The severe authoritative-latency finding disclosed above (and expanded in Phase 19/20) is now mitigated behind a flag: see [`FANTASY_OS_PLAYER_RESOLUTION_LATENCY_MITIGATION.md`](FANTASY_OS_PLAYER_RESOLUTION_LATENCY_MITIGATION.md). `/api/trade-value/analyze` real requests with an unresolved `playerId` asset now return in ~9.8s instead of 170-189s when `PLAYER_LOOKUP_NON_BLOCKING_REFRESH=true`. The shadow seam's own latency was already proven unaffected by the authoritative engine's slowness (Phase 19); Phase 21 additionally fixes the authoritative side directly, narrowly, and behind a default-off rollback flag — this does not change the readiness classification above (still **B**), since Phase 21 did not add new real Trade shadow-compare evidence, only removed a real latency risk from the authoritative path it depends on.

## Phase 22 update

Extended Phase 21's guardrail soak with more real `/api/trade-value/analyze` requests (3 additional, including 2 real successfully-priced assets returning in 5.5s/7.0s, plus the previously-tested unresolved-id miss case) — no new bugs, no response-fidelity issue found. Readiness classification remains **B**: the guardrail work strengthens the authoritative dependency Trade relies on but does not itself add new Trade shadow-compare parity evidence. See [`FANTASY_OS_PLAYER_LOOKUP_SOAK_VALIDATION.md`](FANTASY_OS_PLAYER_LOOKUP_SOAK_VALIDATION.md) for the full soak record.
