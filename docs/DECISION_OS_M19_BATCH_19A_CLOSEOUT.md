# Decision OS Milestone 19 — Batch 19A closeout (pure foundations)

**Milestone 19 progress: 34%. Unchanged.** Batch 19A adds pure, dependency-free modules; it
persists nothing, reads nothing, and changes no product behaviour.

## Branch

| | |
| --- | --- |
| Branch | `decision-os-m19-pure-foundations` |
| Base `origin/main` | `1a43ebbd8d338a59d297a0ec46fc3f8a0ec2a3a8` |
| Worktree | `C:/m19wt` — clean, created from `origin/main`, separate from the shared checkout |

**Overwrite safety.** No `lib/decision-os/value-v2` file is tracked on `origin/main`; the 22
files there exist only as another session's uncommitted work. Before writing, all three
target filenames were confirmed absent from both `origin/main` and that working tree, so
nothing of another session's could be shadowed. The shared checkout was verified untouched
after the batch: 218 modified paths before and after, and `prisma/schema.prisma` still
carrying only that session's 42 uncommitted insertions.

## Files created

| File | Purpose |
| --- | --- |
| `lib/decision-os/value-v2/periodCalendar.ts` | Scheduled period resolution and advancement |
| `lib/decision-os/value-v2/leaseToken.ts` | Per-claim lease tokens |
| `lib/decision-os/value-v2/lanePlanner.ts` | Live / historical lane specifications |
| `__tests__/decision-os/value-v2-period-calendar.test.ts` | 41 tests |
| `__tests__/decision-os/value-v2-lease-token.test.ts` | 21 tests |
| `__tests__/decision-os/value-v2-lane-planner.test.ts` | 19 tests |
| `docs/DECISION_OS_M19_BATCH_19A_CLOSEOUT.md` | This document |

Nothing else was created or changed. All three modules import **only** each other and
`node:crypto`.

## Behaviour

**`periodCalendar.ts`** resolves a consecutive schedule from playoff start, field size, weeks
per round, league size and the schema period bound, and advances by the **immediate scheduled
successor**.

- `bracketRounds` uses a **doubling loop, not `Math.ceil(Math.log2(n))`**. The float
  expression is unreliable at exact powers of two, and a bracket size is not a place to
  accept "usually right". Asserted exact at 2²⁹ and 2²⁹+1.
- Non-power-of-two fields are supported; byes are implicit. **Six teams → three rounds.**
- 0 or 1 playoff teams means no bracket: the season ends at `playoffStartPeriod - 1`.
- A provider limit is enforced **only when supplied**. Its absence substitutes nothing — a
  test asserts a 32-team field resolves with no provider limit, specifically so nobody later
  borrows `simulateApiCore.ts`'s `z.number().max(16)`, which bounds a *simulation request*
  and not a real league's playoff field.
- Every missing or malformed input returns a named refusal; nothing is guessed.

**`leaseToken.ts`** mints `<worker:≤8>-<epoch36>-<base64url:22>` — 128 bits of randomness per
**claim attempt**, comfortably inside `VARCHAR(64)`. Randomness and clock are injectable. A
stable worker id is never the lease identity: an expired-then-reacquired lease always carries
a different token, so a stalled worker's in-flight transition can never match. Illegal or
empty worker ids are refused rather than mangled. `redactLeaseToken` exists because a logged
token is a transferable claim on a checkpoint row.

**`lanePlanner.ts`** produces immutable lane specs with floor, ceiling, target and
`blocksLiveSettlement`, validating bounds and disjointness before anything could be persisted.

- **A historical lane starts at the first *scheduled* period, never the first with
  evidence.** Starting at the first period that happens to have matchups makes a missing
  week 1 vanish, and hysteresis then reads weeks 2–4 as three consecutive periods.
- Completed season → no live lane, one automatic historical lane spanning the whole schedule,
  targeting period 1 even with **no** matchup evidence at all. No operator trigger.
- Ongoing season → live lane from `liveFloor`; a seed lane below it when `liveFloor > 1`.

**Batch 19A seed decision:** the seed lane carries `blocksLiveSettlement: true`, and durable
live completion is blocked until it exhausts. Provisional durable completion followed by
re-evaluation was rejected here — it needs a durable work record and its own observation
correction type, and reusing finality's `revision_reason = 'source_refresh'` as observation
metadata would conflate two different things. A request-time surface may still show a clearly
labelled provisional answer; that is outside this batch.

## Validation

| Check | Command | Exit | Result |
| --- | --- | --- | --- |
| Unit tests | `npx vitest run __tests__/decision-os/value-v2-{period-calendar,lease-token,lane-planner}.test.ts` | **0** | **95 passed**, 3 files |
| Scoped typecheck | `node ./__tc19a.mjs` (TS API, explicit roots) | **0** | 6 files, all confirmed present in the compile set |
| Lint | `npx eslint <6 scoped files>` | **0** | clean |
| Hygiene | — | — | 0 NUL bytes, 0 trailing-whitespace lines |

⚠ `tsconfig.json` excludes `__tests__` repo-wide, so the suites are never typechecked by the
default configuration. The scoped checker adds them explicitly and **throws if any target is
absent from the program** — a typecheck that compiled nothing would otherwise report clean.
The checker itself is a scratch tool and is deliberately **not committed**.

⚠ The first typecheck attempt exited 1 with `ERR_MODULE_NOT_FOUND` because the script sat
outside the worktree and resolved `typescript` from its own location. It had compiled nothing.
Reading the output rather than the exit code is what separated that from a real failure.

**Typecheck positive control:** a planted `const __probe: number = "not a number"` was
reported at `lanePlanner.ts(174,7): error TS2322`, exit 1. Removed; file byte-identical.

## Mutation controls

Each mutation was applied, **proven to have changed the file**, run, then restored and
verified byte-identical.

| # | Mutation | Exit | Caught by |
| --- | --- | --- | --- |
| 1 | `ceil` → `floor` for six-team brackets (doubling loop stops a round early) | 1 | 4 failures |
| 2 | Advance over evidence periods instead of scheduled periods | 1 | 2 failures — `expected { periodOrdinal: 15 } to deeply equal { periodOrdinal: 17 }` |
| 3 | Initialize completed history at the first **evidence** period | 1 | 1 failure — `expected 3 to be 1` |
| 4 | Allow overlapping lane bounds | 1 | 1 failure |
| 5 | Reuse a lease token (drop the randomness) | 1 | 4 failures |
| 6 | Remove the schema period bound | 1 | 1 failure |

All three modules verified **byte-identical** afterwards; the suite returns to 95 passed,
exit 0.

🛑 **Mutation 3's first attempt was a no-op, and the batch runner reported it as caught.**
The `sed` pattern matched three spaces before the trailing comment, so it hit only the
completed-season branch — where the mutated expression evaluates to the same value as the
original, making the change textual but not behavioural. The batch's `exit=1` came from
elsewhere in that run, not from the guard it claimed to test. Re-running mutation 3 against
its own suite alone gave **exit 0, 19 passed**, which is what exposed it. The corrected
mutation targets both branches by line number and fails as intended.

The lesson is the one this repo already records: *a no-op mutation is indistinguishable from
a test that cannot fail*. Proving the file changed is necessary and **not sufficient** — the
change must also alter behaviour, and the failure must be read, not merely counted.

## Explicitly untouched

Prisma schema, migrations, databases (none reached — no connection was opened by this batch),
checkpoint SQL, discovery persistence, observation writing, cron routes, `windowDecision.ts`,
IMP-05, deployment, and `main`. No merge was performed.

## Recorded for the later schema / worker batch — NOT implemented here

1. V1 checkpoint discovery is **Sleeper-only** until another provider has an implemented
   finality adapter.
2. **Filtering only by `sport = 'NFL'` is insufficient** — an unsupported platform must not
   receive a permanently deferring row.
3. **Platform league identifiers must be scoped by platform**, or proven globally
   collision-safe, before they key any lookup.
4. Existing sibling checkpoint rows must be **loaded and locked** before idempotent discovery
   creation.
5. **`skipDuplicates` alone cannot prove existing lane bounds are compatible** — it hides a
   conflicting row rather than inspecting it.
6. Partial sibling state may be repaired **only after** validating the existing row against
   the newly calculated immutable plan.
7. **Incompatible existing bounds must raise an integrity alert**, never be ignored.
8. Lane bounds need **database immutability enforcement**, not merely a comment.
9. `SKIP` terminal-period deadlines need an explicit rule for when **no next-period
   settlement timestamp exists**.
10. Any future provisional-observation recomputation needs a **durable work record and a
    valid observation correction type**; finality `revision_reason = 'source_refresh'` cannot
    be reused as observation metadata.

## Remaining external gates

| Gate | Status |
| --- | --- |
| Import Integrity Batch A lands in the target branch | Open — `a3505ed2b`, not an ancestor of `origin/main` |
| Batch A reader census passes | Open |
| `prisma/schema.prisma` released by the other session | Open |
| Production PostgreSQL major confirmed | Open — validated on 18.3 and 17.9; test Neon reports 17.11 |
| IMP-05 period finality implemented | Open |
| Real concurrency and non-UTC tests | Open — require the schema and worker batches |

**Milestone 19 progress: 34%.**
