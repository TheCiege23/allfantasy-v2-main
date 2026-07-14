# Controlled Rollout Plan (Phase 39, Part 10)

This plan covers releasing this session's accumulated, currently-local-only changes (Phases 33-39) to production. Per the Deployment Reality Audit (Part 5), none of these changes are live today — `vercel list` confirms the current production deployment predates this work.

## 1. Scope of this release

Phases 33 (Game Day exposure fix), 34 (Matchup Center truthfulness fix), 35 (Decision OS schema recovery — non-prod DB only), 36 (Manager Hub retention-risk + navigation fixes), 37 (Dashboard nav-chip addition), 38 (provider `roster_positions` fix), 39 (`global-error.tsx` wiring + cron-drift regression guard).

## 2. What is explicitly NOT in scope for this release

Any change to `vercel.json`'s cron schedule (Part 5's Finding 1 — documented, not corrected, this phase). Any fix to the World Cup cron 500 errors (Part 5's Finding 2 — unrelated subsystem, third-party plan limitation, not owned by this effort). Any new alerting mechanism (Part 7's gap — documented, not built).

## 3. Pre-release verification already performed

All 7 phases' individual test suites pass (cumulative count not re-tallied in full this phase; each phase's own final report already recorded its pass count — e.g. Phase 38's 128/128 post-recovery). This phase's own two additions (28 lines of test assertions across 2 new files) pass cleanly and introduce zero new TypeScript errors against the clean 215-error baseline.

## 4. Production database parity check — REQUIRED BEFORE RELEASE, NOT YET DONE

Phase 35's 3 Decision OS table migrations were applied to `.env.test` only. **Whether production's database already has these tables (via a separate, already-scheduled migration deploy) or is missing them is unverified.** This is the single highest-risk open item in this plan. Before releasing any Phase 35/36-dependent code path (Manager OS, Decision OS real-execution), run `prisma migrate status` against production's real `DATABASE_URL`/`DIRECT_URL` (read-only status check, not an apply) to confirm parity. If production is missing the tables, the standard `prisma migrate deploy` pipeline should resolve it the same way Phase 35 diagnosed for `.env.test` (3 unrelated pre-existing failed migrations were the actual blocker there — production may or may not share that same blocker).

## 5. Rollout mechanism

None of the 7 phases' fixes are flag-gated (see Feature Flag and Rollout Audit, Part 6, for why — they are correctness fixes to already-live logic, not new features). Rollout is therefore a standard deploy, not a staged flag flip. The one exception requiring a pre-check is Item 4 above.

## 6. Staging order (if a staged deploy is preferred over one release)

1. Phase 38 (provider normalization fix) and Phase 34 (Matchup Center fix) — pure logic corrections, zero new dependencies, lowest risk.
2. Phase 33 (Game Day exposure fix) — same category.
3. Phase 39 (`global-error.tsx` wiring) — additive only, worst case is a no-op (Sentry DSN still absent in production, so `sentryCapture` stays unregistered; `logError`'s no-op-in-production behavior is unchanged by this fix).
4. Phase 36 + 37 (Manager Hub fixes, nav wiring) — **gate on Item 4's DB parity check** since these depend on the Decision OS tables.
5. Phase 35's schema state — verify before, not as part of, this release (it's a DB-state precondition, not a deployable code change).

## 7. Rollback plan

Standard Vercel deployment rollback (promote the previous production deployment) covers all 7 phases' code changes uniformly, since none require a corresponding DB rollback (Phase 35's migrations are additive-only — new tables, no altered/dropped columns — so rolling back the application code does not require rolling back the schema).

## 8. Success criteria post-release

- Matchup Center: no regression in bye-week vs. unavailable-data classification for the real 8-league validation account (Phase 34's fixture).
- Manager Hub: `atRiskLeagueCount` stays at the corrected ratio (not reverting to the pre-fix 8/8-uniform pattern) for the same real account (Phase 36's fixture).
- Provider imports: any new real ESPN/Yahoo/MFL import shows a non-degenerate bench-slot count (not the pre-fix always-0-or-wrong value).
- `app/global-error.tsx`: a deliberately-triggered client error (dev/staging only, per this phase's Part 2 guardrail against production outages) shows `captureException` being called via console/log inspection.

## 9. Monitoring during rollout

Given Part 7's confirmed absence of proactive alerting, monitoring during this release must be **manual and active**: `vercel logs` watched for a period after deploy, and `/admin/production-health` checked. This is a real, disclosed limitation of the current observability stack, not a gap specific to this release.

## 10. Owner / approval

Not assigned by this phase — this document is a plan, not an authorization. Per this phase's guardrails, no production deployment action was taken; release requires explicit user go-ahead.

## 11. Communication plan

No customer-facing announcement is warranted for Phases 33/34/36/38/39 (bug fixes to existing, already-live behavior). Phase 37's dashboard nav-chip addition is a minor, self-evident UI addition not requiring release notes.

## 12. Dependency check

No new third-party dependency was introduced in any of the 7 phases (Phase 39 uses the pre-existing `@sentry/nextjs`-backed `captureException` sink, already a project dependency).

## 13. Feature-flag cleanup

Not applicable — no flags were introduced.

## 14. Post-release regression suite

Re-run the full targeted test set listed in each phase's own final report, plus this phase's 2 new files, plus a fresh isolated `tsc --noEmit` compared against the 215-error baseline.

## 15. Explicit provider-support honesty carried into this release

Per Phase 38's Provider Truthfulness Report: this release does not claim ESPN/Yahoo/Fantrax/MFL/Fleaflicker are validated to the same standard as Sleeper. Any customer-facing copy describing "supported providers" should continue to reflect the precise picture from Phase 38 (Sleeper production-validated; ESPN/Yahoo/MFL real-but-unvalidated-on-real-data; Fantrax's ingestion mechanism unconfirmed; Fleaflicker self-disclosed as partial) — this release does not change that picture and should not be described as if it does.
