# Decision OS Milestone 19 — deployment-review handoff

**Milestone 19 progress: 34%. Unchanged.** This branch adds pure logic and a schedule-driven
correction. It ships no schema, no migration, no worker, no route, and flips no flag.

🛑 **Recommendation: DO NOT SHIP YET.** See §8. The blocking reason is not in this code.

---

## 1. Repository, branch, commit, PR

| | |
| --- | --- |
| Repository | `TheCiege23/allfantasy-v2-main` |
| Branch | `feat/decision-os-milestone-19-window` |
| Base | `origin/main` @ `1a43ebbd8d338a59d297a0ec46fc3f8a0ec2a3a8` |
| Commit | *(filled in below at push time)* |
| PR | *(filled in below at push time)* |

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

Run from the branch worktree. **Run suites individually or in small batches**: eight files at
once fails with `Failed to start forks worker / Timeout waiting for worker to respond` on a
contended box — a false red, not a code failure. Every suite below passes alone.

```bash
npx vitest run __tests__/decision-os/value-v2-period-calendar.test.ts
npx vitest run __tests__/decision-os/value-v2-lease-token.test.ts
npx vitest run __tests__/decision-os/value-v2-lane-planner.test.ts
npx vitest run __tests__/decision-os/value-v2-window.test.ts
npx vitest run __tests__/decision-os/value-v2-window-facts.test.ts
npx vitest run __tests__/decision-os/value-v2-window-prisma-port.test.ts
npx vitest run __tests__/decision-os/value-v2-window-schedule-integration.test.ts
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
| `value-v2-window-db.integration` (no DB named) | 0 | **10 skipped** — the guard working |
| `value-v2-window-db.integration` (test DB named) | 0 | **5 passed, 5 skipped** |
| **Total** | | **193 passed**, 5 skipped |

**Scoped typecheck** — `tsconfig.json` excludes `__tests__` repo-wide, so the suites are never
typechecked by default; the checker adds them explicitly and **throws if a target is absent
from the compile set**, because a run that compiled nothing would otherwise read clean.

```
node ./__tc19b.mjs   →  exit 0
M19 scoped typecheck passed for 15 files (all present in the compile set).
```

**Lint** — `npx eslint <changed files>` → exit 0. No NUL bytes, no trailing whitespace.

**Database** — `ep-muddy-leaf-adigvvph-pooler…neon.tech`, the endpoint named in `.env.test`.
Verified **not** production (`ep-curly-block`) and the production host appears **0 times** in
output. No production migration was applied.

### Mutation controls

| Mutation | Exit | Caught by |
| --- | --- | --- |
| Ignore the supplied schedule, always use arithmetic | 1 | 3 failures |
| Stop refusing an out-of-schedule period; clamp instead | 1 | 2 failures |

`windowDecision.ts` restored byte-identical afterwards; suite returns to 15 passed, exit 0.

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
3. **Readiness row 17 is open.** `import-integrity-batch-a` (`55d388017`) has not landed on
   `main`, so reconciliation still hard-deletes unclaimed `LeagueTeam` rows.
4. **The full-suite command is not CI-safe as written.** Eight files at once fails on worker
   startup under load. CI must run these individually or in small batches, or it will produce
   a red that means nothing.
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
