# Real Validation Report (Phase 36, Part 7)

Same real Sleeper manager/leagues used throughout Phases 33-35.

## `resolveUserOsSnapshot` — real single-league Sleeper manager

| | Phase 35 (before) | Phase 36 (after) |
|---|---|---|
| `retentionRisk` | `"critical"` | **`"insufficient_data"`** |

Correct: this real league has 0 recorded activity events for any manager.

## `resolveManagerCommandCenterSnapshot` — real 8-league user

| | Phase 35 (before) | Phase 36 (after) |
|---|---|---|
| `healthyLeagueCount` | 0 | 0 |
| `atRiskLeagueCount` | **8** | **1** |
| `insufficientDataLeagueCount` | (field didn't exist) | **7** |
| `attentionQueueLength` | 20 (Phase 34) → 17 (Phase 35 baseline) | 17 (unchanged — already correctly excluded insufficient_data via the safe lookup-map pattern) |

**7 of the 8 real leagues were previously misclassified as "at risk" purely from missing activity data.** Only 1 real league has genuine relative evidence (other managers in that league have real recorded activity; this manager does not) and correctly remains `at risk`. This is the exact real-world outcome Phase 36's success criteria specified: "no longer classified entirely from missing-data defaults" and "classifications remain severe where actual evidence supports them."

## Manager hub / NFL reachability

Reachability was validated structurally (static source-scan tests, matching this codebase's established convention for these large dashboard components) rather than via a live browser session, consistent with how `LeagueTab.tsx`'s own equivalent wiring was originally validated. `UserOsCardConnected` reuses the exact same real `/api/decision-os/user-os` route already exercised by the real executions above — no new route, no new authorization path, so the real-execution proof of `resolveUserOsSnapshot`'s correctness applies identically regardless of which dashboard component renders it.

## NCAAF

No representative real (provider-imported) NCAAF league exists in `.env.test` — the 3 real NCAAF `League` rows found are native test/smoke-seeded leagues, disclosed honestly rather than presented as organic real validation. The wiring contract itself was validated via the same sport-agnostic static-scan proof described in the NFL/NCAAF Integration Report.

## Authorization boundaries

Confirmed intact via existing, already-passing test coverage (not newly written this phase, since no code change was needed): `user-os-route-contract.test.ts`'s existing test asserts a `managerId=someone-else` URL parameter is ignored server-side in favor of the session user's own id. Real execution this phase used real session-equivalent calls (direct function invocation with the real target manager's own id) — consistent with, not a substitute for, that route-level guarantee.
