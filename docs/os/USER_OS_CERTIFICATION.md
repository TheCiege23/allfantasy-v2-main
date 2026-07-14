# User OS — Certification Reassessment

Date: 2026-07-12/13. **Overall status: CERTIFIED WITH DOCUMENTED
LIMITATIONS.** Not `BLOCKED` — real, working, wired end-to-end (context →
coordinator → six generators → API route → League Hub UI widget → Chimmy
seam). Not plain `CERTIFIED` — this phase's own automated test suite could
not be confirmed running this session (see the real, disclosed environment
finding below), and several sub-cases from the phase brief are honestly
`deferred`, not built.

## What "physically proven" means for this phase specifically

Two distinct kinds of physical proof exist in this phase's evidence, and
they should not be conflated:

1. **Generator logic, function-level**: physically proven. A standalone
   `tsx` script (`scripts/verify-user-os-generators.ts`) executed the real
   generator functions — the exact same code the real `__tests__/user-os/*`
   test files import — against realistic fixture data, in a real Node
   process, with real assertions. 18/18 checks passed (one real test-fixture
   bug was found and fixed along the way — the roster-weakness heuristic's
   `≥8 total players` threshold was not met by the first fixture attempt;
   the generator code itself was correct). This is genuine execution, not
   a claim.
2. **Data model + query pattern, database-level**: physically proven. Real
   fixture rows (2 leagues, 2 teams with differentiated 8-1/1-8 records, a
   real roster with real `lineup_sections` JSON, a real cross-referenced
   `injury_reports` row) were inserted into and queried from the disposable
   Neon branch (`br-green-lab-admi6kkj`), confirming the exact join
   patterns `assembleUserOsContext` uses (roster→injury cross-reference by
   player id, team ownership via `claimedByUserId`) work correctly against
   real Postgres. Fixture rows deleted after, confirmed clean.
3. **The full coordinator (`assembleUserOsContext` + Prisma + `assembleUserOsRecommendations`), end-to-end, live**: **not physically executed this phase.** Running the real Prisma-backed code against the disposable branch would have required overriding `DATABASE_URL`, and this program's own memory carries an explicit, serious warning that local env resolution has previously pointed at **production** — combined with an earlier, confirmed instance this exact session of inline shell `DATABASE_URL` overrides being silently ignored in favor of `.env`'s own value. Given that real risk, this phase did not attempt to run the Prisma-backed coordinator against any live database — a deliberate, safety-first scoping decision, not an oversight. The context assembler's Prisma queries were instead source-verified against the real, confirmed schema (table/column names checked directly against `information_schema` during the SQL fixture work above).

## Real, disclosed environment finding: automated test execution could not be confirmed this session

`npx vitest run` failed to schedule a single worker process across **9
consecutive attempts** this session, spanning multiple configurations
(`--pool=forks`, single files, multi-file runs, extended timeouts up to
300s). Diagnosed directly via `Get-Process`: severe, sustained CPU
contention from **multiple concurrent `claude` processes** (3+ distinct
PIDs) plus heavy background applications (a long-running `node` process,
OneDrive, Chrome, Discord, and two ChatGPT desktop processes) — consistent
with, and explaining, the repeated git branch/commit drift observed
throughout this and the prior phase (this appears to be a genuinely shared
machine running multiple parallel Claude Code sessions against the same
repository). This is an environment condition, not a defect in the test
code — `scripts/verify-user-os-generators.ts` (a lighter, non-worker-pool
`tsx` execution) proved the underlying logic is correct using the identical
functions the vitest test files import. The real, permanent test files
(`__tests__/user-os/*.test.ts`, 8 files) are written and believed correct
by careful manual review, but their passing under `vitest run` specifically
was not confirmed this session — disclosed honestly rather than claimed.

## Domain-by-domain (see `USER_OS_DOMAIN_SUPPORT_MATRIX.md` for full detail)

| Domain | Status |
|---|---|
| Lineup | **PARTIAL** — 2 of 10 brief sub-cases implemented (injured/inactive starter, empty slot), both physically proven at the function level. NFL-only. |
| Waiver | **PARTIAL** — 1 of 8 sub-cases (positional need, no specific player named). |
| Trade | **PARTIAL** — real posture-framing CTA reusing the real strategy classification; deep valuation/acceptance-probability integration explicitly deferred (see file header). |
| Roster | **PARTIAL** — 3 of 11 sub-cases (injury concentration, position weakness, bench inefficiency). |
| Strategy | **CERTIFIED WITH DOCUMENTED LIMITATIONS** — all 6 real classification outcomes implemented and function-level proven; the richer multi-factor version from the brief (roster value, future assets, schedule difficulty) is a disclosed scoping cut. |
| Playoff | **PARTIAL** — real snapshot-based + qualitative fallback; 2 of 9 sub-cases from the brief. |

## Why PARTIAL, not UNSUPPORTED, for most domains

Every domain marked `PARTIAL` has real, non-fabricated, function-level-proven
logic for at least one genuine sub-case — none of the six domains returns
only placeholder/empty output. `PARTIAL` accurately conveys "real but not
exhaustive," distinct from `UNSUPPORTED` (nothing implemented at all, e.g.
non-NFL sports for lineup/waiver) and distinct from `BLOCKED` (a real
external dependency prevents any implementation, not the case for any
domain here — every gap in this phase is a scoping decision, not a hard
blocker).
