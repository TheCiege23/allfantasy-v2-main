# Import Batch A.2 — closeout

**Nothing merged. Nothing deployed. Batch B not started. No Prisma schema change, no migration,
no production writes.**

| | |
|---|---|
| Branch | `integration/import-batch-a` |
| Batch A.1 tip | `337bf69e2` |
| **Final CODE SHA — every gate in §6 was measured here** | **`cfdc1b700`** |
| Baseline | `origin/main` `1a43ebbd8` |
| A.2 commits | `f214174cd`, `cd4c96b3d`, `0a8a16edf`, `799cf13ac`, `cfdc1b700` |

⚠ **Read the code SHA, not the branch tip.** Documentation-only commits sit on top of
`cfdc1b700`; `git diff --name-only cfdc1b700..HEAD` touches nothing outside `docs/`, so every
gate result below still describes the code at the branch tip. Where a result was measured at an
*earlier* SHA it says so beside the number, and results from runs that did not complete are not
reported at all (§6.2).

A.2 closes the remaining archival-reader risk inside Platform Import scope. Its headline is not
a new class of bug — it is that **the guard built in A.1 to police the class was still deciding
per FILE**, and per-file was wrong in three separate ways at once.

---

## 1. Protection is per call, not per file

The old test was one line:

```ts
if (FILTERED_MARKERS.some((m) => src.includes(m))) continue   // over the WHOLE FILE
```

Three ways to be silently wrong:

| | |
|---|---|
| another query in the file is filtered | exempts this one |
| an **unrelated** consumer calls `selectActiveTeams(other)` | exempts this one |
| a **comment** names `ACTIVE_TEAM_WHERE` | exempts every call in the file |

`app/api/leagues/join/route.ts` is that shape in production: line 302 filters, line 395 did not,
and the guard saw a clean file. **Eight files in the tree hold more than one reported call.**

Protection is now decided per call — a filter in *this* call's own `where`, or `selectActiveTeams`
receiving *this* call's binding. An undetermined binding counts as **unprotected**: a consumer
that cannot be read is one that cannot be checked. Comments are blanked to spaces (offsets and
line numbers preserved) before anything is matched, so prose can neither grant nor revoke an
exemption.

### Four further detection bugs, each found by measuring

- A **1200-character lookback window** put `BroadcastModeEngine`'s `Promise.all` destructure out
  of range — its explanatory comment is ~1800 characters — so a correctly filtered call was
  reported. That is the **third** fixed window this file has been bitten by. There is no window
  now.
- The binding regex anchored at `await\s*$`, but the match starts at `leagueTeam`, leaving
  `prisma.` in between. **Six correctly-filtered readers** were reported as leaks.
- A receiver segment can be parenthesised — `(prisma as any).leagueTeam` in
  `app/api/rankings/route.ts`.
- 🛑 `claimedByUserId:\s*[^{]` **did not fire**, because `\s*` backtracks to zero width and
  `[^{]` then matches the *space*. `[^{\s]` is the fix. Until then `claimedByUserId: { not: null }`
  — which selects *many* rows — read as a narrowing key, hiding **seven** league-wide reads.

### The registry is keyed by call-site identity

`file#ordinal`, not `file`. A file-keyed exemption reintroduces the bug above, and an ordinal
survives edits above it in a way a line number does not.

A new assertion refuses a **dead** exemption — an entry that no longer matches an unprotected
call stops describing anything but keeps matching, so a future call reusing that id is waved
through on a reason written about different code. It caught `dynasty-projections` the moment A.2
filtered it.

### 🛑 The predicate gap: a bare `isOrphan` mention is not protection

The per-call rule was right and its *predicate* was still wrong. It read:

```ts
/ACTIVE_TEAM_WHERE|ORPHAN_TEAM_WHERE|isOrphan\s*:/
```

So `isOrphan: true` — a query returning **only** archived teams — counted as "protected from
archived teams". So did `ORPHAN_TEAM_WHERE`, whose entire purpose is to select them. **A
wrong-polarity predicate silenced the guard exactly as effectively as a correct one**, and did it
on the two reads most likely to be about archived seats.

`orphanPolarity()` now returns one of four answers, and only one is protection:

| verdict | shapes | outcome |
|---|---|---|
| `active` | `ACTIVE_TEAM_WHERE`, `NOT: { isOrphan: true }`, `isOrphan: false` | protected |
| `archived-only` | `ORPHAN_TEAM_WHERE`, `isOrphan: true` | **reported** — classify it with a reason |
| `unknown` | an `OR:` anywhere, both polarities present, `isOrphan: <variable>` | **reported** — review decides |
| `none` | the field is absent | ordinary enumeration path |

⚠ **An `OR:` anywhere downgrades to `unknown`** rather than being reasoned about:
`where: { OR: [{ isOrphan: false }, { … }] }` matches rows through the other branch, so the
predicate constrains nothing. An unrecognised shape requires review, which is the safe direction.

⚠ **And the canonical active filter nearly classified itself as `unknown`.** `NOT: { isOrphan: true }`
*contains* the substring `isOrphan: true`, so testing both patterns against the raw clause found
"both polarities present". The negated form is consumed before the bare one is looked for —
caught by the control for that exact shape, which is why the controls run through the real scanner.

**What it revealed, and what it did not.** Two reads that were exempt for the wrong reason are now
classified explicitly, both genuinely archived-only and both correct as they stand:
`lib/commissioner-workspace/rosterReads.ts#2` (the orphan metric itself) and
`app/api/commissioner/leagues/[leagueId]/renew/route.ts#1` (counts orphans to set
`dispersalDraftEligible`). **No historical identity map was blanket-filtered** — the change adds
scrutiny, not filters.

**Mutation-controlled:** restoring the bare-mention predicate turns **seven** tests red — all five
polarity controls, the "bare mention never grants protection" assertion, and the dead-exemption
check (because both new entries stop matching).

---

## 2. The population, and its classification

The count moved four times, and every step is a real event rather than a restatement. Stated in
full because "88 → 16 fixed → 72 remaining" and the PR's "71" are both true of different moments:

| step | count | why it moved |
|---|---|---|
| Unprotected calls at the A.1 tip, per-call, **old predicate** | **88** | the population the per-call scanner first revealed |
| − 16 leaks fixed | **72** | §2 below |
| − 1 dynasty-projections | **71** | the separate dynasty commit filtered it, so it stopped being reported |
| + 2 revealed by the **polarity fix** | **73** | two archived-only reads had been exempt for the wrong reason (§4) |

**Final: 73 classified exceptions, `PENDING_CLASSIFICATION` empty, budget 0, zero dead entries.**

⚠ **The 88 is measured under the OLD predicate.** Re-measured with the corrected polarity rule,
the A.1 tip would have shown **90** — the same two archived-only reads were being silently
exempted there too. 88 is kept as the figure actually observed at the time rather than
retrofitted, and this note is the reconciliation.

Every one of the 73 carries a reason established by tracing its binding, not by inferring from
the file's name or directory.

### The 16 fixed — every one a count, a list, an eligibility decision, or a write

| surface | what an archived seat did |
|---|---|
| `app/api/leagues/join` (×2) | "N of M teams claimed" — **both halves**. A full league whose twelfth manager left reported 11 of 12 for ever; the bar could never reach the end |
| `lib/invite-engine/InviteEngine` | 🛑 the count **gates `leagueTeam.create`** — a manual league that lost a seat reported itself full, so a joining manager got a roster and **no team** |
| `app/api/cron/weekly-awards` | departed managers kept receiving the weekly award email |
| `lib/league-chat/leagueMemberIds` | a departed seat's claimer stayed in the chat room |
| `lib/survivor/notificationEngine` | same, for survivor notifications |
| `.../members/autocomplete` | @-mention autocomplete offered departed members |
| `lib/core-app/commissionerHub` | the "Claimed teams" tile could never reach 100% |
| `lib/core-app/scout` | scouted-manager list and the coverage denominator |
| `lib/core-app/trades` | league size feeds **trade grading** context |
| `lib/core-app/draftHq` (×2) | league size feeds pick-in-round maths — **every printed pick number shifted** |
| `lib/trade-intel/tradeContextNotes` (×3) | two league-size inputs and a current standings list |
| `lib/chimmy-context/StandingsContextProvider` | standings rows built straight from the array, model-facing |

⚠ **`isOrphan` was added to every `select` feeding `selectActiveTeams`.** `isActiveTeam` reads
`isOrphan !== true`; an omitted column is `undefined`, which reads **active**. A consumer-side
filter without it is a silent no-op, and `TeamOrphanState` marks the field optional on purpose,
so nothing type-checks it.

### Two priorities that turned out NOT to be leaks

Both were named for prioritisation; the evidence says retain, and saying so is the finding.

- **`lib/waiver-wire/process-engine.ts` (the write path).** `rankByPlatformUserId` is read as
  `.get(claimant) ?? 999` to break ties **between claimants**. An archived seat adds an
  unreachable entry, shifts no live rank and awards nothing — and filtering it would **drop the
  rank of a seat archived between a claim and its processing**.
- **`lib/core-app/leagueStandings.ts` #1 and #3 (current vs historical).** Both are *name maps*.
  The rows come from `WeeklyMatchup` and `SeasonStandingFact`, not from the team array, so
  filtering would leave a played week unlabelled and remove nobody. The current/historical split
  lives in the fact tables, not in this read.

---

## 3. `TeamPerformance.opponent` — resolved by the producer's contract

The only production writer is `SleeperLeagueCreationBootstrapService`:

```ts
opponent: tid2 ?? undefined      // tid2 = teamIdByExternalId.get(mu.roster_id_2)
```

**It stores a `LeagueTeam.id`.** `prisma/seed.ts` writes the literal `"Opponent Team"` — a
fixture, and the likely source of the name-shaped reading both readers were built on.

1. **Dead.** `opponentMatchup` matched with a bidirectional substring test on `teamName`. A UUID
   contains no team name and no team name contains a UUID, so the matchup-difficulty note never
   fired on real imported data. `resolveMatchupOpponent` used a normalising `fuzzyTeamMatch` and
   fell through to its "pick the matching team" note on every imported league.
2. 🛑 **Worse.** `perf.opponent.includes((t.teamName ?? ''))` — every string contains the empty
   string. A seat with a **null or empty name matched every opponent**, and `Array.find` returned
   the first. An unnamed seat became the opponent of record for the whole league, and the screen
   printed a confident points-against ranking **about the wrong team**. Unclaimed seats are the
   least likely to be named, and A.1 newly *retains* them — so this branch grew the triggering
   population.

`lib/league-import/teamPerformanceOpponent.ts` is now the single resolver: team id → externalId →
an **exact**, case-insensitive legacy name, never a substring and never against a blank name. An
unresolved value resolves to **nothing**, and the caller says so. `fuzzyTeamMatch` and `normName`
are deleted rather than left dead.

Covered by 13 cases: id, externalId, exact legacy name, substring refused (both directions),
unknown id, empty/whitespace/null value, the empty-name seat, an archived opponent, and
self-exclusion.

---

## 4. `dynasty-projections` — the last MIXED read, in its own commit

`generateDynastyProjection(input, { persist: true })` writes a row per target, so an archived seat
**acquired a stored projection** later reads treat as real.

- **Filtered:** `targetTeams` in both branches (the explicit `teamIdFilter` too — asking for a
  departed seat by id should find nothing rather than mint a projection for it), and the
  `teamCount` valuation fallback.
- 🛑 **Not filtered, deliberately:** `buildFuturePicksByTeam` receives the unfiltered array. It
  seeds its ledger from every *original* team and resolves traded picks through an alias map keyed
  on ids a departed seat still owns — narrowing it would **silently delete a future pick a live
  team acquired from a manager who has since left.**

### Its testing — corrected, and now behavioural

⚠ **AN EARLIER VERSION OF THIS SECTION OVERCLAIMED, AND THE CORRECTION IS THE POINT.** It said
asserting on what `buildTeamInputsFromLeague` returns "proves no row can be written" for an
archived seat. It does not. That function returns *targets*; it never reaches
`prisma.dynastyProjection.upsert`, so it cannot show that an existing archived row is left
un-updated, and it cannot show that a live target produces a stored row at all. Proving a
persistence boundary requires executing the persistence.

It now does. `generateForInputs` — the function both `GET` and `POST` call, which invokes
`generateDynastyProjection(input, { persist: true })` — is exported and driven directly, and the
assertions are made on **stored rows**:

| | asserted against the database |
|---|---|
| a LIVE target really is persisted | a `dynasty_projections` row exists for it, and its score is not the sentinel |
| an ARCHIVED target gets no NEW row | exactly one row for it — the pre-seeded one |
| an ARCHIVED target gets no UPDATE | that row's values are still `-999`, which no generator produces |
| an explicit archived request cannot bypass | `teamIdFilter: '<archived>'` **rejects**, and the stored row is still `-999` |
| a LIVE team keeps a pick from an archived seat | its `futurePicks` length is **10**, not the base 9 — the traded 2027 first-rounder survives |

The pre-seeded sentinel row is what makes "no update" checkable: the upsert would have *updated*
that row rather than created one, so "no new row" alone would have missed a regression.

**Ran against an explicitly identified disposable database** — a local PostgreSQL 17.9 at
`127.0.0.1:5433`, database `af_a2_dynasty_test`, created for this and holding nothing else. Not
Neon, so neither production nor any shared branch. **7/7 pass.**

**Mutation-controlled.** Restoring archived targeting (`activeTeams` -> `teams`) turns **four**
tests red, including all three behavioural ones. Applied to the file and restored, with the
restore verified by `diff`.

**Cleanup is asserted, not swallowed.** `afterAll` deletes every fixture it created and then
*counts* what remains, failing the run if anything is left. Verified independently by querying the
database after both a passing run and a failing one: **0 rows** either way. The `allfantasy`
tenant row is upserted and deliberately **not** deleted — this suite may not have created it.

🛑 **The safeguards are intact and were not weakened to make this run.** `vitest.setup.db-guard.ts`
still pins an inherited `DATABASE_URL` to `127.0.0.1:1`; the block is still `describe.skipIf`-gated
so it **skips** when no database is named (verified: 4 passed, 3 skipped); and it carries its own
second refusal against a `neon.tech` host *and* against the guard's own sentinel, rather than
trusting a setup file it does not own.

---

## 5. Three claims corrected

Recorded in `BATCH_A_CORRECTIONS.md`; history was not rewritten.

1. **"Three of the four MIXED reads were not mixed."** Only **one** was. `userOsContext` had a
   single consumer, so "MIXED" never described it. `opponentMatchup` and `roster-context-loader`
   are **genuinely mixed and remain so** — each still holds a current consumer and a historical
   one that disagree, and each would break if its query were filtered. Filtering the current
   consumer is the correct treatment *of* a mixed read, not evidence it was never mixed.
2. **"70 call sites (263 vs 194)"** pairs a difference with the wrong operand.
   263 − **193** = **70** is what a same-line scan of the tree today cannot see.
   263 − **194** = **69** is how many rows the census table is short. They differ by one because
   the table still lists `lib/chimmy/tools/leagueByName.ts`.
3. **"The run was terminated before Vitest reported."** Not established. `DONE=4` with no summary
   block establishes that the run did not complete normally and that **no result may be read from
   it** — which is all the gate decision required. It does **not** identify a cause; an internal
   error, a killed child, a crashed worker pool and a wrapper losing the process are
   indistinguishable from what was kept. *An abnormal exit plus truncated output is sufficient to
   reject a result and insufficient to diagnose one.*

---

## 6. Gates — each result tied to the SHA it was measured at

Run **one at a time**. The box carries other sessions' `tsc` and `vitest` processes, and this repo
has a recorded incident of concurrent runs killing each other into output that reads exactly like
a clean pass. Each gate was started only after checking the box was clear.

| gate | measured at | result |
|---|---|---|
| **TypeScript ratchet** | `cfdc1b700` | ✅ `DONE=0` — **no file gained errors**; total 143 vs baseline 143 |
| Registry guard, incl. polarity + per-call controls | `cfdc1b700` | ✅ **27/27** |
| Dynasty persistence, against a disposable database | `cfdc1b700` | ✅ **7/7**, incl. 3 behavioural |
| `league-import` + `user-os` + `core-app` | `cfdc1b700` | ✅ **46 files / 460 tests**, 3 skipped (the gated DB block, run separately) |
| Secret scan | `cfdc1b700` | ✅ exit 0 |
| **Full-suite baseline comparison** | `cfdc1b700` | ⏳ **sharded run in progress — see §6.2** |

Documentation-only commits sit on top of `cfdc1b700`; `git diff --name-only cfdc1b700..HEAD`
touches nothing but `docs/`, so the gates above describe the code as it stands at the branch tip.

### 6.1 What the ratchet does and does not establish

⚠ **AN EARLIER VERSION OF THIS SECTION GOT THIS WRONG IN BOTH DIRECTIONS.** It said 143 == 143
proves no regressions, and that a *lower* total would be the tell for a starved run. Neither is
right.

- **Equal totals prove nothing on their own.** One file could gain two errors while another loses
  two. What actually carries the verdict is that `ts-error-ratchet.mjs` compares **per file, by
  identity** against `scripts/ts-error-baseline.json` and fails if *any* file gained errors or a
  new file appeared with them. `✓ no regressions` is that per-file result. The total is context.
- **A lower total is not automatically a starved run.** It is the ordinary shape of a genuine
  fix. The tool has a narrower sanity check for the case that matters — a baseline with known
  errors and a run finding *none* — and that is the reading to keep: **zero** against a non-zero
  baseline is the tell, not merely *fewer*.

**Compile coverage was verified rather than assumed.** `tsc --listFilesOnly` puts **12,727** files
in the compile set, and every changed **source** file is in it (sampled:
`teamPerformanceOpponent.ts`, `scout.ts`, `InviteEngine.ts`, the dynasty handler,
`tradeContextNotes.ts` — 1 each). 🛑 The changed **test** files are **not** (0 each): this repo
excludes `__tests__` repo-wide, so **the ratchet says nothing about the new tests' types.** That is
pre-existing and is stated rather than implied.

### 6.2 Why the suite is sharded, and what "usable" means

Two single-process full runs were attempted and **both died with no summary block and an exit of
4** — the second at `799cf13ac`, preserved as `suite-799cf13ac.PARTIAL.txt` (202 KB, 17 failing
files reported, no sentinel). Neither is a result, and neither is reported as one.

The suite now runs in **six sequential shards**. Each shard produces its own summary block and
exit status, so a shard that dies invalidates *that shard* and can be re-run, rather than
discarding the whole gate. A shard counts as **usable** only when it printed a summary block
**and** exited 0 or 1; anything else is recorded as UNRESOLVED and re-run.

The comparison is against the **complete** `origin/main` `1a43ebbd8` baseline — summary present,
`DONE=1`, **81 failed files / 145 failed tests** — and is reported by **failure identity**, which
files gained or lost failures, never as a net count.

**Known reference point:** `__tests__/user-os` was 7 of 7 failing at `origin/main` (a stale prisma
mock, repaired in A.1) and now passes 58, so the branch is already **−7** before A.2 is counted.

---

## 7. Open items

**Closed since the previous revision of this file:**

- ~~The dynasty persisted-write assertion has not executed.~~ **Now executed** against a disposable
  local database, behaviourally, with a mutation control and asserted cleanup (§4).
- ~~`QUERY_FILTER` accepts a bare `isOrphan:` anywhere in the `where`.~~ **Fixed** — `orphanPolarity`
  grants protection only to an `active` predicate, and the two archived-only reads it revealed are
  classified with reasons (§1).

**Still open:**

1. **The full-suite baseline comparison is not finished.** Six sequential shards are running at
   `cfdc1b700`; the result will be reported by failure identity against the complete `1a43ebbd8`
   baseline (81 failed files / 145 failed tests). Two earlier single-process attempts died with no
   summary and an exit of 4 and are **not** reported as results (§6.2). **This is the one gate
   still outstanding and it is a blocker for calling the branch validated.**
2. **The ratchet does not cover the new tests' types.** `tsc --listFilesOnly` confirms the changed
   source files are in the 12,727-file compile set and the changed test files are not — this repo
   excludes `__tests__` repo-wide. Pre-existing, stated rather than implied.
3. **A shorthand narrowing key is not recognised.** `where: { leagueId, externalId }` carries no
   colon, so it reports as an enumeration. A false positive in the safe direction — it gets
   inspected — and left as-is.
4. **16 behaviour changes to live surfaces.** Counts drop by the number of departed seats and
   departed managers stop receiving notifications. That is the intent; it is still visible to users.
5. **`InviteEngine` reverses a previously-reviewed decision** (from admin/monitoring exception to
   filtered). Counting seats to *report* is monitoring; counting them to *decide* is not.
6. **Batch B (Sleeper certification) is not started.**
