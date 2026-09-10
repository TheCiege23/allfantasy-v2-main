# Decision OS Milestone 19 — deployment-review handoff

**Milestone 19 progress: 34%. Unchanged.** This branch adds pure logic and a schedule-driven
correction. It ships no schema, no migration, no worker, no route, and flips no flag.

🛑 **Recommendation: DO NOT SHIP YET.** See §8. The blocking reason is not in this code.

**Revision 2 (review-fix batch).** Adds the two defects found in review of `a7b6b891` — see
§4a. External dependencies are documented separately in
`DECISION_OS_M19_EXTERNAL_DEPENDENCIES.md`; neither was implemented.

---

## 1. Repository, branch, commit, PR

| | |
| --- | --- |
| Repository | `TheCiege23/allfantasy-v2-main` |
| Branch | `feat/decision-os-milestone-19-window` |
| Base | `origin/main` @ `1a43ebbd8d338a59d297a0ec46fc3f8a0ec2a3a8` |
| Commit | `7cf881cd0abad6619cd8dc3b00556001d5196135` |
| PR | https://github.com/TheCiege23/allfantasy-v2-main/pull/694 |

The two divergent M19 branches were unified here: `decision-os-m19-pure-foundations`
(Batch 19A) was cherry-picked onto this branch so a reviewer reads **one** branch, not two.
`decision-os-m19-pure-foundations` remains at `6f1623e05` and can be deleted after this
merges — its content is contained here by patch-id.

---

## 2. Checklist against the approved contract

Sources: `DECISION_OS_M19_CHECKPOINT_CONTRACT_FINAL_V2.md` and
`DECISION_OS_M19_CHECKPOINT_CONTRACT_V2_1_CORRECTIONS.md`.

| Contract item | Status | Evidence |
| --- | --- | --- |
| Period calendar — schedule not evidence (V2 §3, V2.1 §1) | **Complete** | `periodCalendar.ts`; 55 tests |
| Non-power-of-two brackets, byes (V2.1 §1) | **Complete** | 6 teams → 3 rounds; 1/2/4/6/7/8/12/16/32 all tested |
| Provider limit enforced only when supplied (V2.1 §1) | **Complete** | Test asserts 32-team resolves with no limit; nothing substitutes `max(16)` |
| Lease tokens, per-claim identity (V2 §5) | **Complete** | `leaseToken.ts`; 21 tests incl. 5,000-token uniqueness and the ABA guarantee |
| Lane planner, both bounds, disjointness (V2.1 §2) | **Complete** | `lanePlanner.ts`; 19 tests |
| Historical lane starts at first **scheduled** period (V2.1 §3) | **Complete** | Asserted directly: targets 1 when first evidence is 3 |
| Seed barrier (V2.1 §4) | **Complete (planning only)** | `blocksLiveSettlement`; the worker that would honour it does not exist |
| **Resolver walks the schedule, not `week−1, week−2`** | **Complete — new here** | `windowDecision.ts` + `scheduledLookback`; 15 tests |
| Refusal, never a silent "competitive" | **Complete** | Asserted across window, facts and integration suites |
| **Scope validated before any evidence read** | **Complete — new here** | `invalidScopeReason`; 22 tests, port throws if touched |
| Prisma-backed window facts | **Complete** | `windowFactsPrismaPort.ts`; 30 unit + 5 real-DB tests |
| Consumer seam reaches the window | **Partial — implemented, uncommittable** | §5 |
| Durable weekly observations | **Blocked** | No `TeamWindowObservation` model exists anywhere |
| Checkpoint SQL / discovery / observation writer | **Blocked** | All require the schema |
| Cron routes | **Not started** | Out of scope for this batch |
| Reconciliation soft-delete (readiness row 17) | **Blocked** | `import-integrity-batch-a` not on main |

⚠ **A numbering collision worth naming.** "Checklist item #17" is ambiguous: it is row 17 of
the V2 readiness checklist (reconciliation soft-delete for `LeagueTeam`), **not** a section of
the V2.1 corrections, which number 1–8. Reviewers should cite the document as well as the
number.

---

## 3. Changed files and what each enables

| File | Change | Behaviour enabled |
| --- | --- | --- |
| `lib/decision-os/value-v2/periodCalendar.ts` | +`scheduledLookback` | A period plus its immediate **scheduled** predecessors; refuses a period the schedule does not contain; returns fewer than requested near a season start rather than padding |
| `lib/decision-os/value-v2/windowDecision.ts` | Schedule-driven lookback, `refusedDecision` helper, two new gap constants | The resolver stops choosing its hysteresis periods with `week−1, week−2` arithmetic |
| `__tests__/decision-os/value-v2-window-schedule-integration.test.ts` | New, 15 tests | Pins the above, including the case arithmetic gets wrong |
| `docs/DECISION_OS_M19_BATCH_19A_CLOSEOUT.md` | Test-count correction | 55, not 41 — see §4 |
| *(cherry-picked)* `periodCalendar.ts`, `leaseToken.ts`, `lanePlanner.ts` + 3 suites | Batch 19A | Pure foundations |
| **`lib/decision-os/value-v2/windowDecision.ts`** | *(rev 2)* `invalidScopeReason`, `INVALID_SCOPE_GAP`, `MAX_PERIOD_ORDINAL` | Scope is validated **before** any lookback is built and before the port is touched |
| **`__tests__/decision-os/value-v2-window-scope-validation.test.ts`** | *(rev 2)* New, 22 tests | Pins the refusal for 9 invalid weeks plus malformed identity, with a port that throws if read |
| **`__tests__/decision-os/value-v2-window-db.integration.test.ts`** | *(rev 2)* `requireAllPlay` runtime skip, `M19_DB_STRICT`, `seedTenant` | Success-path tests actually run; strict mode fails loudly instead of skipping |
| **`docs/DECISION_OS_M19_EXTERNAL_DEPENDENCIES.md`** | *(rev 2)* New | The `value-v2` foundation and Platform Import Batch A, documented not implemented |

### The defect this fixes

`windowDecision.ts` previously selected its lookback with:

```ts
for (let w = scope.week - (WINDOW_PERSISTENCE_WEEKS - 1); w <= scope.week; w += 1)
  if (w >= 1) weeks.push(w)
```

That assumes every integer below the current week is a period of this league's season. It is
not. A league whose schedule ends at 16, asked about week 17, would silently produce a window
over 15, 16 and a period that does not exist. Now:

- **Schedule supplied** → walks real scheduled predecessors; a period outside the schedule
  **refuses** with `period_not_in_schedule` and reads **no evidence at all**.
- **Schedule absent** → the arithmetic fallback still runs, so existing callers are
  unchanged, but it reports `schedule_unavailable_lookback_assumed_contiguous` so the
  assumption is visible instead of silent.

---

## 4. Tests — exact commands and results for this commit

### The reproducible CI command

The per-file list below was a workaround for a contention failure, not a real constraint. The
cause was file-level parallelism, and naming the workers settles it:

```bash
npx vitest run __tests__/decision-os/value-v2- --maxWorkers=1 --no-file-parallelism
```

```
CI_EXIT=0
Test Files  8 passed | 1 skipped (9)
     Tests  210 passed | 10 skipped (220)
  Duration  241.80s
```

The 1 skipped file and 10 skipped tests are `value-v2-window-db.integration` with no database
named — the guard working as designed. Production host `ep-curly-block` appears **0 times** in
the output.

⚠ Without those two flags the same command fails with `Failed to start forks worker / Timeout
waiting for worker to respond` on a contended box. That is a **false red**: every suite passes
alone. Do not read it as a code failure.

Individual suites, if a reviewer wants them separately:

```bash
npx vitest run __tests__/decision-os/value-v2-period-calendar.test.ts
npx vitest run __tests__/decision-os/value-v2-lease-token.test.ts
npx vitest run __tests__/decision-os/value-v2-lane-planner.test.ts
npx vitest run __tests__/decision-os/value-v2-window.test.ts
npx vitest run __tests__/decision-os/value-v2-window-facts.test.ts
npx vitest run __tests__/decision-os/value-v2-window-prisma-port.test.ts
npx vitest run __tests__/decision-os/value-v2-window-schedule-integration.test.ts
npx vitest run __tests__/decision-os/value-v2-window-scope-validation.test.ts
npx vitest run __tests__/decision-os/value-v2-window-db.integration.test.ts   # needs DATABASE_URL
```

| Suite | Exit | Result |
| --- | --- | --- |
| `value-v2-period-calendar` | 0 | **55 passed** |
| `value-v2-lease-token` | 0 | **21 passed** |
| `value-v2-lane-planner` | 0 | **19 passed** |
| `value-v2-window` | 0 | **32 passed** |
| `value-v2-window-facts` | 0 | **16 passed** |
| `value-v2-window-prisma-port` | 0 | **30 passed** |
| `value-v2-window-schedule-integration` | 0 | **15 passed** |
| `value-v2-window-scope-validation` *(rev 2)* | 0 | **22 passed** |
| `value-v2-window-db.integration` (no DB named) | 0 | **10 skipped** — the guard working |
| `value-v2-window-db.integration` (compatible DB, `M19_DB_STRICT=1`) | 0 | **10 passed** |
| **Total** | | **210 passed**, 10 skipped (220) |

**Scoped typecheck** — `tsconfig.json` excludes `__tests__` repo-wide, so the suites are never
typechecked by default. `tsconfig.m19scope.json` sets `"exclude": []` to defeat the inherited
exclusion, and the run is verified against `--listFiles` because a config that compiles nothing
exits 0 and reads clean.

```
node ./node_modules/typescript/lib/tsc.js -p tsconfig.m19scope.json --noEmit --listFiles
  →  297 files in the compile set; windowDecision.ts, the scope-validation suite and the
     DB integration suite each confirmed present

node ./node_modules/typescript/lib/tsc.js -p tsconfig.m19scope.json --noEmit
  →  TYPECHECK_EXIT=0, 0 `error TS` lines, 0 bytes of output
```

**Positive control**, because a green check that has never gone red is not evidence: planting
`const __planted: number = "not a number"` in the new suite produced
`value-v2-window-scope-validation.test.ts(98,7): error TS2322` at exit 2. File restored
byte-identical (`diff -q`).

**Lint** — `npx eslint` on the three changed files → exit 0, **0 bytes of output**.

⚠ **Read that result narrowly.** This repo's config resolves 47 enabled rules for a `.ts` file
and every one of them is React, Next, `jsx-a11y` or `import/*`; `@typescript-eslint` is loaded
as a plugin with **no rules enabled**. A clean lint on a plain non-JSX module is therefore weak
evidence — it is close to a no-op. Confirmed rather than assumed: `debugger` and an unused
`const` produced nothing, and only a genuinely-enabled rule fired —
`export default {}` → `98:1 warning import/no-anonymous-default-export`. Note also that eslint
exits **0 on warnings**, so the byte count is the signal here, not the exit code. Restored
byte-identical.

## 4a. The review-fix batch (revision 2)

Two defects were reported against `a7b6b891`. **Both were real**, and both were confirmed by
mutation before being fixed.

### Defect 1 — `resolveWindowDecision` accepted a scope it could not describe

`week` reached the lookback loop unvalidated. Two distinct failures, not one:

| Input | Before | Why |
| --- | --- | --- |
| `0`, `-1`, `NaN` | `TypeError: Cannot read properties of undefined (reading 'facts')` | The loop pushes nothing, so `assembled[assembled.length - 1]` is `undefined` |
| `Infinity` | **hangs forever** | `Infinity - 2 <= Infinity` is true and `w += 1` never advances |

Fixed by `invalidScopeReason(scope)`, called at the top of `resolveWindowDecision` **before any
lookback is constructed and before the port is touched** — it returns a `refusedDecision`
carrying `window_scope_invalid` plus a specific reason (`week_below_first_period`,
`week_not_an_integer`, `week_above_period_bound`, `season_not_an_integer`, …).

`Number.isSafeInteger` does the finiteness work: it is false for `NaN`, both infinities,
fractions, and anything past 2^53−1, so the arithmetic loop cannot be reached with a value that
would not terminate. The upper bound is `MAX_PERIOD_ORDINAL = 25`, matching `twobs_ordinal_chk`
in the observation schema.

**22 tests** cover 9 invalid weeks × 2 (schedule supplied and absent), plus malformed identity,
plus a legitimate week to prove the guard is not simply refusing everything. Every test runs
against a `forbiddenPort()` whose every method throws — so "zero evidence reads" is asserted,
not asserted-about.

**Mutation control — both failure modes reproduced:**

| Mutation | Result |
| --- | --- |
| Remove the validation call entirely | suite **hung**, killed at 180s, `exit=124` |
| Keep validation, delete the `Infinity`/`-Infinity` cases | `TypeError: … reading 'facts'`, **14 failed / 3 passed** |

`windowDecision.ts` restored **byte-identical** after each.

⚠ Worth recording: the `Promise.race` timeout inside the Infinity test **cannot interrupt a
synchronous infinite loop**. It is useful documentation of intent, not a working guard — which
is exactly why the mutation run had to be killed by `timeout` rather than failing cleanly. A
timer cannot preempt a loop that never yields to the event loop.

### Defect 2 — the DB suite's five success-path tests could never run

```ts
let allPlayReadable = false                       // module scope
beforeAll(async () => { allPlayReadable = await probe() })
it.skipIf(!allPlayReadable)('…', …)               // evaluated at REGISTRATION
```

`it.skipIf` is evaluated when the test is **registered**, which happens before `beforeAll` runs.
`allPlayReadable` is therefore always `false` at that moment. **All five success-path tests were
skipped unconditionally — on every database, compatible or not.** The suite reported
`5 passed, 5 skipped` and looked healthy; the five skips were guaranteed by the lifecycle bug,
and had nothing to do with schema drift.

Fixed by moving the decision to **run** time:

```ts
function requireAllPlay(ctx: { skip: () => void }): void {
  if (allPlayReadable) return
  if (STRICT_DB) throw new Error('M19_DB_STRICT=1 but … ')   // actionable, names the migration
  ctx.skip()
}
```

Six call sites; **zero** remaining `it.skipIf(!allPlayReadable)`.

🛑 **This had been masking a second, real defect.** With the success path finally executing, it
failed immediately on `PrismaClientKnownRequestError: Foreign key constraint violated:
leagues_tenantId_fkey` — the fixtures never seeded a `Tenant`. That defect had existed the whole
time and was invisible because the test that would have caught it never ran. Fixed with
`seedTenant()`, called first in `beforeAll`.

**The lesson is the transferable part: a skipped test is not a passing test, and a suite
reporting "5 passed, 5 skipped" was reporting a lifecycle bug as coverage.**

### Database validation

Run against an explicitly identified, **schema-compatible, disposable, non-production**
PostgreSQL instance built for this batch:

| | |
| --- | --- |
| Host | `127.0.0.1:55434`, database `m19compat`, role `m19` |
| Server | PostgreSQL **17.9**, `trust` auth, `listen_addresses=127.0.0.1` |
| Provenance | `initdb` into the session scratchpad — created for this run, destroyed after |
| Schema | `prisma migrate diff --from-empty --to-schema-datamodel` off committed `origin/main` → **717 tables**, then the pending `20260903222531_weekly_matchup_roster_id_text` migration |
| Credentials | none — `trust` auth on a loopback port. Nothing secret to redact |

```bash
DATABASE_URL="postgresql://m19@127.0.0.1:55434/m19compat" DIRECT_URL="postgresql://m19@127.0.0.1:55434/m19compat" M19_DB_STRICT=1 npx vitest run __tests__/decision-os/value-v2-window-db.integration.test.ts   --maxWorkers=1 --no-file-parallelism
```

```
DB_STRICT_EXIT=0
Test Files  1 passed (1)
     Tests  10 passed (10)
```

**10 passed, 0 skipped** — against **5 passed / 5 skipped** before the fix. Production host
`ep-curly-block` appears **0 times** in the output.

**Fixture isolation and cleanup verified** after the run — every table the suite writes reads
zero rows:

```
leagues 0 · league_teams 0 · "WeeklyMatchup" 0 · season_forecast_snapshots 0
dynasty_projection_snapshots 0 · app_users 0
```

**Strict mode proven to fail actionably on an incompatible database.** The same command against
the shared Neon test endpoint (`ep-muddy-leaf…`, named in `.env.test`, non-production) exits
**1** with 5 success-path failures, each naming the unapplied migration and what to do:

> `M19_DB_STRICT=1 but the Prisma client cannot read WeeklyMatchup on this database. … Most
> likely cause: the pending migration 20260903222531_weekly_matchup_roster_id_text is unapplied
> here, so "rosterId" is still integer while the generated client expects text.`

That is the behaviour the review asked for: incompatible schema under explicit verification
produces an actionable failure, not a silent skip.

⚠ **No production migration was applied**, and `prisma/schema.prisma` was not edited — it
remains held by another session with uncommitted changes.

---

### Mutation controls carried over from revision 1 (the schedule fix)

Listed here for completeness; these are the controls for the *previous* commit's change, not
this batch's. Revision 2's own controls are in §4a above.

| Mutation | Exit | Caught by |
| --- | --- | --- |
| Ignore the supplied schedule, always use arithmetic | 1 | 3 failures |
| Stop refusing an out-of-schedule period; clamp instead | 1 | 2 failures |

`windowDecision.ts` restored byte-identical afterwards; suite returns to 15 passed, exit 0.

⚠ **One of Batch 19A's three mutations was a silent no-op**, and it is recorded because the
lesson generalises. A `sed` pattern matched only the completed-season branch, where the mutated
expression evaluates identically, so the mutation applied to the file and changed no behaviour;
an unrelated `exit=1` elsewhere in the batch made it look caught. Re-running that mutation
against its own suite alone returned exit 0, 19 passed. Retargeted by line number, it failed
correctly with `AssertionError: expected 3 to be 1`. **Proving a mutation applied is necessary
and not sufficient — prove it changed behaviour.**

### A correction to an earlier committed document

`DECISION_OS_M19_BATCH_19A_CLOSEOUT.md` recorded "41 tests" for the period calendar. The real
count is **55** — `it.each` tables expand to more cases than a declaration count reports, and
95 − 21 − 19 = 55 never reconciled with 41. The 95 total was always right; the split was not.
Corrected in this commit. **A correct total does not validate the parts it was assembled
from.**

---

## 5. Evidence the intended consumer reaches this implementation

**It does not yet, and the reason is ownership, not code.**

- `buildValueV2Shadow` lives in `lib/decision-os/value-v2/shadow.ts`, which is **untracked on
  every branch** — `git ls-tree -r origin/main -- lib/decision-os/value-v2` returns **0
  files**. Another session's uncommitted foundation still owns that directory.
- The wiring **is implemented and passing** in the shared working tree:
  `TradeValueContext.teamWindowV2`, `ValueV2Shadow.window`, and a 16-test consumer suite
  proving a contender and a rebuilder produce **byte-identical `assets` payloads** while
  `teamFit` differs. None of it is committable without sweeping that session's ~18 uncommitted
  files into this commit.
- Consequently **no production request path constructs a `WindowDecision` today**. The
  resolver is reachable by test, not by traffic.

**What a reviewer should check after the foundation lands:** that
`lib/trade-value/snapshot.ts` and `runTradeConsoleAnalysis.ts` pass `teamWindowV2` into the
context, and that `buildValueV2Shadow` emits `window` with `team_competitive_window_missing`
when it does not.

---

## 6. Migrations, configuration, compatibility, rollback

**Migrations: none.** This branch adds no Prisma model and no migration file.
`prisma/schema.prisma` is untouched.

**Configuration: none required.** No new environment variable. `DECISION_OS_VALUE_V2_SHADOW_ENABLED`
remains **default-off** and is not changed here.

**Compatibility.** `scheduledPeriods` is an **optional** option. Every existing caller keeps
its previous behaviour and simply gains the `schedule_unavailable_lookback_assumed_contiguous`
gap. No signature is broken; no existing test changed.

**Rollback.** `git revert <sha>` — pure code, no state. Nothing to un-migrate, no data to
repair. Consumers fall back to neutral team fit, the documented refusal behaviour.

---

## 7. Railway target

| | |
| --- | --- |
| Project | `AllFantasy` |
| Services | `allfantasy-v2-main` (web) and `allfantasy-v2-worker` |
| Deployment branch | `main` for the web service; the worker deploys `worker-release` |
| Environment | production |

⚠ **This branch is not the deployment branch.** Nothing deploys until it merges to `main`,
and merging is out of scope here. ⚠ Note the worker tracks a **different** branch — a change
needed by both services has to reach both. No credentials appear in this document.

---

## 8. Why this should not ship yet

1. **No consumer reaches it.** §5 — the window is reachable by test, not by traffic. Shipping
   now adds dead code to production.
2. **Durable observations do not exist.** `windowDecision` still reconstructs prior periods
   from current facts and says so via
   `hysteresis_history_reconstructed_not_stored`. Until `TeamWindowObservation` exists, a
   projection landing today can still influence what W-1 and W-2 are computed to have been —
   the defect the contract exists to close. This branch narrows *which periods* are consulted;
   it does not make them durable.
3. **Readiness row 17 is open.** `import-integrity-batch-a` (`55d388017`, 5 commits) has not
   landed on `main`, so reconciliation still hard-deletes unclaimed `LeagueTeam` rows. Both
   this and item 1 are documented in full in `DECISION_OS_M19_EXTERNAL_DEPENDENCIES.md`,
   including the exact six-file `value-v2` import closure the consumer seam needs. **Neither
   was implemented — both belong to other sessions.**
4. ~~**The full-suite command is not CI-safe as written.**~~ **Resolved in revision 2.**
   `npx vitest run __tests__/decision-os/value-v2- --maxWorkers=1 --no-file-parallelism` runs
   all nine files in one command at exit 0. The failure was file-level parallelism on a
   contended box, not the suites.
5. **Production PostgreSQL major is still unconfirmed** — validated on 18.3 and 17.9; the test
   endpoint reports 17.11. Immaterial for this commit (no migration), material before any
   schema batch.

**What this branch is safe for:** review and merge-readiness assessment of pure logic. It
changes no runtime behaviour that any user can observe, because nothing calls it.

---

## 9. Audit provenance

A five-dimension parallel audit verified each claimed gap against actual code. Its **adversarial
verification pass did not run** — all 60 verifier agents failed on a session limit — so its
findings are **single-source and unverified**, and are labelled as such. Two load-bearing
claims were therefore re-checked by hand and both held: the 55/21/19 test split (by running
each suite alone) and the `week−1, week−2` arithmetic in `windowDecision` (by reading the
code). Everything asserted in §§2–6 above rests on a command I ran, not on the audit.
