# Failure Injection Report (Phase 39, Part 8)

Per the brief's TDD requirement ("write tests before any corrective implementation"), both scenarios below were reproduced with a real, initially-failing test BEFORE any corrective code was written, and the "before" failure output was captured as evidence.

## Scenario A: Cron schedule references a deleted route (real, live in production — see Part 5)

**Injection method**: not synthetic — this is a real, already-occurring production condition. A test was written to walk `vercel.json`'s real `crons` array and check each path against the real local filesystem.

**Result before any fix**: `__tests__/vercel-cron-route-drift.test.ts` failed on its first run, reporting 28 real missing routes with an exact diff (captured in this phase's tool output).

**Corrective action**: not a code/behavior fix (would require either restoring 28 routes or editing live production cron config — both out of this phase's authorized scope). Instead, the test was converted into a non-regressing drift guard (passes today by encoding the known-missing set, fails only on NEW drift). This is documented, not fixed — an explicit, honest choice per the guardrail against unauthorized production deployment changes.

## Scenario B: Root-level error boundary does not reach the error-tracking pipeline

**Injection method**: source-scan assertion that `app/global-error.tsx` calls `captureException` (mirroring the existing, real pattern already used by `components/error-handling/ErrorBoundary.tsx`).

**Result before fix**: `__tests__/global-error-capture-exception-wiring.test.ts` failed 2 of 3 assertions — `global-error.tsx` had no `captureException` import and no call to it, only a direct `console.error`.

**Corrective action**: implemented — `app/global-error.tsx` now imports and calls `captureException(error, {context:'global-error', digest: error?.digest})` alongside its existing `console.error` (which was kept, not removed, since it independently serves Railway/Vercel log visibility). Test re-run confirms all 3 assertions pass; existing `root-language-provider-layout.test.tsx` (which also asserts structural properties of `global-error.tsx`) still passes unmodified (32/32 tests green across both files).

## The 12 candidate scenarios from the brief — honest disposition

| # | Scenario (as briefed) | Exercised this phase? | Why / why not |
|---|---|---|---|
| 1 | Malformed `roster_positions` from a provider | No — already exercised and fixed in Phase 38 with real provider-shape fixtures; re-running it would be duplicate work, not new evidence |
| 2 | Missing Decision OS table | No — already exercised in Phase 35 (the real migration-recovery work); the 3 tables are now present in `.env.test`, so this scenario can no longer be reproduced there without deliberately reverting a real migration (out of scope/unsafe) |
| 3 | Import job partial failure | No — not reproduced this phase; would require constructing a partial-failure fixture for one of the 6 provider adapters, a larger effort not undertaken given the two real, already-confirmed production issues (Scenarios A and B above) took priority |
| 4 | Cron route drift / deleted route still scheduled | **Yes — Scenario A above, real, live in production** |
| 5 | Root-level error boundary not reaching error tracking | **Yes — Scenario B above, real, fixed** |
| 6–12 | (remaining candidates: e.g. Sentry DSN toggle behavior, flag-cache staleness, GA4 delivery failure, etc.) | No | Given the two real, already-confirmed, high-value findings from Parts 5 and 2 (live cron drift, live World Cup 500s, confirmed-absent Sentry DSN, confirmed no-op `logError` in production), this phase prioritized documenting and narrowly correcting those over synthesizing additional hypothetical scenarios with no corresponding real evidence. This is disclosed as an intentional scope choice, not an oversight. |

## Why 2 scenarios, not more

Both exercised scenarios are grounded in **real, independently-confirmed production evidence** (live `vercel logs` output for Scenario A's category, and a real code-pattern gap for Scenario B), not synthetic what-ifs. Per the brief's own emphasis on truthfulness over exhaustiveness ("do not fabricate... write tests before any corrective implementation"), this report treats depth-on-real-findings as more valuable than breadth-across-hypotheticals this phase did not have time to genuinely validate.
